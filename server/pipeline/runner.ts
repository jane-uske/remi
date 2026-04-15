import { WebSocket } from "ws";

import { chatStream } from "../../agents/conversation_agent";
import { inferAvatarIntentFromReply } from "../../agents/avatar_intent_agent";
import type { RemiSessionContext } from "../../brains/remi_session_context";
import { decayEmotion } from "../../emotion/decay_emotion";
import { updateEmotion } from "../../emotion/emotion_engine";
import { synthesize, isTtsEnabled } from "../../voice/tts_stream";
import { canStreamTextToSpeech, streamTextToSpeech } from "../../voice/tts";
import { SentenceChunker } from "../../utils/sentence_chunker";
import { InterruptController } from "../../voice/interrupt_controller";
import { AvatarController } from "../../avatar/avatar_controller";
import { createLogger } from "../../infra/logger";
import { isDbReady } from "../../infra/app_state";
import { getLatencyTracer } from "../../infra/latency_tracer";
import { saveMessage } from "../../storage/repositories/message_repository";
import { isFallbackAssistantReply } from "../../brains/assistant_reply_guard";
import { send } from "../gateway";
import type { InterruptionType } from "../../avatar/types";
import type { TurnAnalysisBundle } from "../../brain/turn_interpreter";

const logger = createLogger("pipeline");

function parseNonNegativeMs(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function thinkingFillerDelayMs(): number {
  return parseNonNegativeMs(process.env.REMI_THINKING_FILLER_DELAY_MS, 520);
}

function avatarIntentEnabled(): boolean {
  const raw = (process.env.REMI_AVATAR_INTENT_ENABLED ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false";
}

export type RunPipelineOptions = {
  /** 用户久未说话时的主动搭话：不写入 user 消息、不跑慢脑/记忆 */
  silenceNudge?: boolean;
  /** partial transcript 预判命中时复用提前生成的回复，未命中则留空走正常路径。 */
  pregeneratedReply?: string;
  /** 与预生成回复配套的结构化解释结果。 */
  structuredAnalysis?: TurnAnalysisBundle | null;
  /** 打断承接提示，帮助本轮回复接住上一轮被打断的语义。 */
  carryForwardHint?: string;
  interruptionType?: InterruptionType;
  inputSource?: "text" | "voice";
};

export async function runPipeline(
  ws: WebSocket,
  text: string,
  ic: InterruptController,
  avatar: AvatarController,
  sessionId: string | null,
  ctx: RemiSessionContext,
  generationId: number,
  traceId: string,
  options?: RunPipelineOptions,
): Promise<void> {
  const connId = ctx.connId;
  const signal = ic.begin();
  ctx.currentAssistantDraft = "";
  const latencyTracer = getLatencyTracer(connId);
  const traceContext = options?.silenceNudge
    ? { generationId, source: "silence_nudge" as const }
    : { generationId };
  latencyTracer.startTrace(traceId, traceContext);

  try {
    const replyEmotion = options?.silenceNudge
      ? ctx.emotion.getEmotion()
      : updateEmotion(text, ctx.emotion);
    send(ws, { type: "emotion", emotion: replyEmotion });

    const avatarFrames = avatar.setEmotion(replyEmotion as any);
    for (const frame of avatarFrames) {
      send(ws, { type: "avatar_frame", frame });
    }

    if (isDbReady() && sessionId && !options?.silenceNudge) {
      try {
        await saveMessage(sessionId, "user", text);
      } catch (err) {
        logger.warn("[Storage] Failed to save user message", { error: err, sessionId });
      }
    }

    const thinkingFiller =
      !options?.silenceNudge &&
      (process.env.rem_thinking_filler === "1" ||
        process.env.REMI_THINKING_FILLER === "1");

    // ── Producer-consumer TTS: synthesize sentences as they stream in ──

    const sentenceQueue: string[] = [];
    let sentenceIdx = 0;
    let producerDone = false;
    let waitResolve: (() => void) | null = null;

    function pushSentence(s: string) {
      sentenceQueue.push(s);
      if (waitResolve) {
        const r = waitResolve;
        waitResolve = null;
        r();
      }
    }

    function endProducer() {
      producerDone = true;
      if (waitResolve) {
        const r = waitResolve;
        waitResolve = null;
        r();
      }
    }

    const onAbort = () => endProducer();
    signal.addEventListener("abort", onAbort, { once: true });

    let firstAudioSent = false;
    let thinkingFillerTimer: ReturnType<typeof setTimeout> | null = null;
    const clearThinkingFillerTimer = () => {
      if (thinkingFillerTimer) {
        clearTimeout(thinkingFillerTimer);
        thinkingFillerTimer = null;
      }
    };
    if (thinkingFiller && isTtsEnabled() && !signal.aborted) {
      thinkingFillerTimer = setTimeout(() => {
        thinkingFillerTimer = null;
        if (signal.aborted || firstAudioSent) return;
        void synthesize("嗯", signal, replyEmotion as any)
          .then((buf) => {
            if (!signal.aborted && !firstAudioSent) {
              send(ws, { type: "voice", audio: buf.toString("base64"), generationId });
            }
          })
          .catch(() => {});
      }, thinkingFillerDelayMs());
    }
    let ttsError: Error | null = null;

    const ttsTask = (async () => {
      while (true) {
        if (signal.aborted) break;

        if (sentenceIdx < sentenceQueue.length) {
          const sentence = sentenceQueue[sentenceIdx++];
          if (signal.aborted) break;

          if (sentenceIdx === 1) latencyTracer.mark("tts_start", traceId);

          try {
            ic.markSpeaking();
            await ttsSend(
              ws,
              sentence,
              generationId,
              traceId,
              signal,
              replyEmotion,
              latencyTracer,
              !firstAudioSent,
            );
            if (!firstAudioSent) {
              firstAudioSent = true;
              clearThinkingFillerTimer();
            }
          } catch (err) {
            if ((err as Error).name === "AbortError") break;
            logger.warn("[TTS]", { error: (err as Error).message, connId });
            ttsError = err as Error;
          }
        } else if (producerDone) {
          break;
        } else {
          await new Promise<void>((r) => { waitResolve = r; });
        }
      }
    })();

    // ── LLM streaming (producer) ──

    const chunker = new SentenceChunker();
    chunker.setEager(true);
    let full = "";
    let firstTokenReceived = false;
    let firstSentenceSent = false;

    const routeOptions = options?.silenceNudge
      ? { systemTriggered: true, traceId }
      : options?.pregeneratedReply
        ? {
            pregeneratedReply: options.pregeneratedReply,
            structuredAnalysis: options.structuredAnalysis,
            carryForwardHint: options.carryForwardHint,
            inputSource: options.inputSource,
            traceId,
          }
        : options?.carryForwardHint
          ? {
              carryForwardHint: options.carryForwardHint,
              inputSource: options.inputSource,
              traceId,
            }
          : options?.inputSource
            ? {
                inputSource: options.inputSource,
                traceId,
              }
            : {
                traceId,
              };

    for await (const token of chatStream(
      ctx,
      text,
      replyEmotion,
      signal,
      routeOptions,
    )) {
      if (signal.aborted) break;

      if (!firstTokenReceived) {
        firstTokenReceived = true;
        latencyTracer.mark("llm_first_token", traceId);
        clearThinkingFillerTimer();
      }

      full += token;
      ctx.currentAssistantDraft = full;
      send(ws, { type: "chat_chunk", content: token, generationId });

      for (const sentence of chunker.push(token)) {
        pushSentence(sentence);
        if (!firstSentenceSent) {
          firstSentenceSent = true;
          chunker.setEager(false);
        }
      }
    }

    latencyTracer.mark("llm_end", traceId);

    if (!signal.aborted) {
      const last = chunker.flush();
      if (last) pushSentence(last);
    } else {
      chunker.reset();
    }

    const shouldInferAvatarIntent =
      Boolean(full) && !signal.aborted && avatarIntentEnabled();
    const avatarIntentTask = shouldInferAvatarIntent
      ? inferAvatarIntentFromReply(full, replyEmotion as any, signal)
          .then((result) => (signal.aborted ? null : result))
          .catch(() => null)
      : Promise.resolve(null);

    endProducer();
    signal.removeEventListener("abort", onAbort);

    // ── Post-LLM steps (run while TTS processes in parallel) ──

    send(ws, {
      type: "chat_end",
      emotion: replyEmotion,
      content: signal.aborted ? "[interrupted]" : undefined,
      generationId,
    });

    // 保存被打断的回复内容，用于后续查询「刚才说到哪了」
    if (signal.aborted && full) {
      ctx.lastInterruptedReply = full;
    } else if (!signal.aborted) {
      // 正常完成的话清空上次被打断的内容
      ctx.lastInterruptedReply = null;
    }
    ctx.currentAssistantDraft = null;
    const shouldPersistAssistantReply = !isFallbackAssistantReply(full);

    if (isDbReady() && sessionId && full && !signal.aborted && shouldPersistAssistantReply) {
      try {
        await saveMessage(sessionId, "assistant", full);
      } catch (err) {
        logger.warn("[Storage] Failed to save assistant message", { error: err, sessionId });
      }
    }

    if (full && !signal.aborted && shouldPersistAssistantReply) {
      const actionFrames = avatar.processReply(full);
      for (const frame of actionFrames) {
        send(ws, { type: "avatar_frame", frame });
      }
    }

    const avatarIntentEnvelope = await avatarIntentTask;
    if (avatarIntentEnvelope && !signal.aborted) {
      send(ws, {
        type: "avatar_intent",
        intent: avatarIntentEnvelope.intent,
        beats: avatarIntentEnvelope.beats,
      });
    } else if (full && !signal.aborted && !shouldInferAvatarIntent) {
      logger.debug("[AvatarIntent] skipped by budget gate", {
        connId,
        generationId,
      });
    }

    if (full) {
      logger.info(`[Remi] ${full}${signal.aborted ? " (interrupted)" : ""}`, {
        emotion: replyEmotion,
        connId,
      });
    }

    // Wait for TTS consumer to finish
    await ttsTask;
    clearThinkingFillerTimer();

    decayEmotion(ctx.emotion);

    latencyTracer.mark("tts_end", traceId);
    latencyTracer.log(traceId);
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      logger.error("[错误]", { error: err, connId });
      send(ws, { type: "error", content: "AI 回复生成失败" });
    }
  } finally {
    if (ctx.currentAssistantDraft !== null) {
      ctx.currentAssistantDraft = null;
    }
    ic.finish();
  }
}

async function ttsSend(
  ws: WebSocket,
  sentence: string,
  generationId: number,
  traceId: string,
  signal?: AbortSignal,
  emotion?: string,
  latencyTracer?: ReturnType<typeof getLatencyTracer>,
  isFirstSentence: boolean = false,
): Promise<void> {
  if (!isTtsEnabled()) return;
  if (signal?.aborted) return;
  try {
    if (canStreamTextToSpeech()) {
      let firstChunkSent = false;
      try {
        await streamTextToSpeech(
          sentence,
          ({ pcm, sampleRate, channels, bitsPerSample }) => {
            if (signal?.aborted) return;
            if (!firstChunkSent) {
              firstChunkSent = true;
              if (isFirstSentence && latencyTracer) {
                latencyTracer.mark("tts_first_audio", traceId);
              }
            }
            send(ws, {
              type: "voice_pcm_chunk",
              audio: pcm.toString("base64"),
              sampleRate,
              channels,
              bitsPerSample,
              generationId,
            });
          },
          signal,
          emotion as any,
        );
        return;
      } catch (err) {
        if ((err as Error).name === "AbortError") throw err;
        if (firstChunkSent) {
          throw err;
        }
        logger.warn("[TTS] stream failed, fallback to buffered synth", {
          error: (err as Error).message,
        });
      }
    }

    const audio = await synthesize(sentence, signal, emotion as any);
    if (signal?.aborted) return;
    if (isFirstSentence && latencyTracer) {
      latencyTracer.mark("tts_first_audio", traceId);
    }
    send(ws, { type: "voice", audio: audio.toString("base64"), generationId });
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      logger.warn("[TTS]", { error: (err as Error).message });
    }
  }
}
