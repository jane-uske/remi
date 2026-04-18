import { WebSocket } from "ws";

import { chatStream } from "../../agents/conversation_agent";
import { inferAvatarIntentFromReply } from "../../agents/avatar_intent_agent";
import {
  AdultPersonaStreamGuard,
  sanitizeAdultPersonaReply,
} from "../../brain/adult_persona_guard";
import type { RemiSessionContext } from "../../brains/remi_session_context";
import { decayEmotion } from "../../emotion/decay_emotion";
import { updateEmotion } from "../../emotion/emotion_engine";
import { synthesize, isTtsEnabled } from "../../voice/tts_stream";
import { canStreamTextToSpeech, streamTextToSpeech } from "../../voice/tts";
import { SentenceChunker, type SentenceChunkBoundaryType } from "../../utils/sentence_chunker";
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
import type { SessionTtsTransport } from "../session/tts_transport";

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

function ttsSegmentPreview(text: string): string {
  return text.length > 48 ? `${text.slice(0, 48)}…` : text;
}

async function waitForAbortable<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  abortedValue: T,
): Promise<T> {
  if (signal.aborted) return abortedValue;
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      resolve(abortedValue);
    };
    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (err) => {
        cleanup();
        reject(err);
      },
    );
  });
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
  ttsTransport?: SessionTtsTransport;
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
  const { signal, token: interruptRunToken } = ic.beginRun();
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

    let enqueuedSegmentCount = 0;

    function pushSentence(s: string, boundaryType: SentenceChunkBoundaryType) {
      sentenceQueue.push(s);
      enqueuedSegmentCount += 1;
      logger.debug("[TTS segment queued]", {
        connId,
        generationId,
        segmentIndex: enqueuedSegmentCount,
        boundaryType,
        chars: s.length,
        preview: ttsSegmentPreview(s),
      });
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
    const adultSceneState = ctx.persona.liveState.adultSceneState;
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
          void synthesize("嗯", signal, replyEmotion as any, {
            connId,
            generationId,
            usage: "thinking_filler",
            adultSceneState,
            relationalStance: ctx.persona.liveState.relationalStance,
            responsePolicy: ctx.lastResponsePolicy,
          })
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
          const rawSentence = sentenceQueue[sentenceIdx++];
          if (signal.aborted) break;

          if (sentenceIdx === 1) latencyTracer.mark("tts_start", traceId);
          const ttsReview = sanitizeAdultPersonaReply(rawSentence, adultSceneState);
          if (ttsReview.flagged) {
            logger.warn("[AdultPersonaGuard] sanitized tts sentence", {
              connId,
              generationId,
              reasons: ttsReview.reasons,
              preview: ttsReview.output.slice(0, 80),
            });
          }
          const sentence = ttsReview.output;

          try {
            ic.markSpeaking();
            await ttsSend(
              ws,
              sentence,
              generationId,
              traceId,
              ctx,
              signal,
              replyEmotion,
              latencyTracer,
              !firstAudioSent,
              options?.ttsTransport ?? "auto",
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
    const adultPersonaGuard = new AdultPersonaStreamGuard(adultSceneState);
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

      const guardedChunk = adultPersonaGuard.push(token);
      if (guardedChunk.flagged) {
        logger.warn("[AdultPersonaGuard] sanitized streaming chunk", {
          connId,
          generationId,
          reasons: guardedChunk.reasons,
          preview: guardedChunk.output.slice(0, 80),
        });
      }
      if (!guardedChunk.output) continue;

      if (!firstTokenReceived) {
        firstTokenReceived = true;
        const now = Date.now();
        latencyTracer.set("llm_first_visible_content", now, traceId);
        latencyTracer.set("llm_first_token", now, traceId);
        clearThinkingFillerTimer();
      }

      full += guardedChunk.output;
      ctx.currentAssistantDraft = full;
      send(ws, { type: "chat_chunk", content: guardedChunk.output, generationId });

      for (const sentence of chunker.pushDetailed(guardedChunk.output)) {
        pushSentence(sentence.text, sentence.boundaryType);
        if (!firstSentenceSent) {
          firstSentenceSent = true;
          chunker.setEager(false);
        }
      }
    }

    latencyTracer.mark("llm_end", traceId);

    if (!signal.aborted) {
      const finalGuardedChunk = adultPersonaGuard.flush();
      if (finalGuardedChunk.flagged) {
        logger.warn("[AdultPersonaGuard] sanitized final chunk", {
          connId,
          generationId,
          reasons: finalGuardedChunk.reasons,
          preview: finalGuardedChunk.output.slice(0, 80),
        });
      }
      if (finalGuardedChunk.output) {
        if (!firstTokenReceived) {
          firstTokenReceived = true;
          const now = Date.now();
          latencyTracer.set("llm_first_visible_content", now, traceId);
          latencyTracer.set("llm_first_token", now, traceId);
          clearThinkingFillerTimer();
        }
        full += finalGuardedChunk.output;
        ctx.currentAssistantDraft = full;
        send(ws, { type: "chat_chunk", content: finalGuardedChunk.output, generationId });
        for (const sentence of chunker.pushDetailed(finalGuardedChunk.output)) {
          pushSentence(sentence.text, sentence.boundaryType);
          if (!firstSentenceSent) {
            firstSentenceSent = true;
            chunker.setEager(false);
          }
        }
      }

      const finalReview = sanitizeAdultPersonaReply(full, adultSceneState);
      if (finalReview.flagged) {
        logger.warn("[AdultPersonaGuard] sanitized completed reply", {
          connId,
          generationId,
          reasons: finalReview.reasons,
          preview: finalReview.output.slice(0, 120),
        });
        full = finalReview.output;
        ctx.currentAssistantDraft = full;
      }
      const last = chunker.flushDetailed();
      if (last) pushSentence(last.text, last.boundaryType);
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

    if (!signal.aborted) {
      const avatarIntentEnvelope = await waitForAbortable(
        avatarIntentTask,
        signal,
        null,
      );
      if (avatarIntentEnvelope) {
        send(ws, {
          type: "avatar_intent",
          intent: avatarIntentEnvelope.intent,
          beats: avatarIntentEnvelope.beats,
        });
      } else if (full && !shouldInferAvatarIntent) {
        logger.debug("[AvatarIntent] skipped by budget gate", {
          connId,
          generationId,
        });
      }
    }

    if (full) {
      logger.info(`[Remi] ${full}${signal.aborted ? " (interrupted)" : ""}`, {
        emotion: replyEmotion,
        connId,
      });
    }

    if (signal.aborted) {
      clearThinkingFillerTimer();
      latencyTracer.mark("tts_end", traceId);
      latencyTracer.log(traceId);
      return;
    }

    const abortWhileWaitingForTts = new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => resolve(), { once: true });
    });

    // Wait for TTS to finish, but do not keep the pipeline chain blocked once
    // the run has already been interrupted.
    await Promise.race([ttsTask, abortWhileWaitingForTts]);
    clearThinkingFillerTimer();

    if (signal.aborted) {
      latencyTracer.mark("tts_end", traceId);
      latencyTracer.log(traceId);
      return;
    }

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
    ic.finish(interruptRunToken);
  }
}

async function ttsSend(
  ws: WebSocket,
  sentence: string,
  generationId: number,
  traceId: string,
  ctx: RemiSessionContext,
  signal?: AbortSignal,
  emotion?: string,
  latencyTracer?: ReturnType<typeof getLatencyTracer>,
  isFirstSentence: boolean = false,
  ttsTransport: SessionTtsTransport = "auto",
): Promise<void> {
  if (!isTtsEnabled()) return;
  if (signal?.aborted) return;
  try {
    const allowStreamingTransport =
      ttsTransport !== "buffered_voice" && canStreamTextToSpeech();
    if (allowStreamingTransport) {
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
          ttsTransport,
        });
      }
    }

    const audio = await synthesize(sentence, signal, emotion as any, {
      connId: ctx.connId,
      generationId,
      usage: "reply",
      adultSceneState: ctx.persona.liveState.adultSceneState,
      relationalStance: ctx.persona.liveState.relationalStance,
      responsePolicy: ctx.lastResponsePolicy ?? null,
    });
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
