import type { MessageSink } from "../gateway/types";

import { chatStream } from "../../agents/conversation_agent";
import { inferAvatarIntentFromReply } from "../../agents/avatar_intent_agent";
import type { RemiSessionContext } from "../../brains/remi_session_context";
import { decayEmotion } from "../../emotion/decay_emotion";
import { updateEmotion } from "../../emotion/emotion_engine";
import { synthesize, synthesizeResult, isTtsEnabled } from "../../voice/tts_stream";
import {
  canStreamTextToSpeech,
  streamTextToSpeech,
  type TtsLipSyncChunk,
} from "../../voice/tts";
import { SentenceChunker, type SentenceChunkBoundaryType } from "../../utils/sentence_chunker";
import { EmotionTagParser } from "../../utils/emotion_tag_parser";
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
import { getOutputGuardHooks } from "../../plugin/registry";
import { getConfig } from "../config";
import { isNsfwEnabled } from "../../brains/nsfw_mode";
import {
  containsImageMarkdown,
  prepareTextForTtsChunking,
  resolveTtsQueueText,
  stripImageMarkdownForTts,
} from "../../voice/tts_helpers";
import { isSessionTtsEnabled } from "../../voice/tts_runtime_overrides";

const logger = createLogger("pipeline");

function thinkingFillerDelayMs(): number {
  return getConfig().REMI_THINKING_FILLER_DELAY_MS;
}

function avatarIntentEnabled(): boolean {
  return getConfig().REMI_AVATAR_INTENT_ENABLED;
}

function ttsSegmentPreview(text: string): string {
  return text.length > 48 ? `${text.slice(0, 48)}…` : text;
}

function sendTtsLipSync(
  sink: MessageSink,
  generationId: number,
  chunk: TtsLipSyncChunk,
): void {
  send(sink, {
    type: "tts_lip_sync",
    generationId,
    source: chunk.source,
    mode: chunk.mode,
    complete: chunk.complete,
    cues: chunk.cues,
  });
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
  /** 世界情境（RW-P1-4）：RemiWorld 对话时描述她所处场景，作为 ground truth 进 prompt。 */
  situationalContext?: string;
  interruptionType?: InterruptionType;
  inputSource?: "text" | "voice";
  ttsTransport?: SessionTtsTransport;
  /** Lazy DB session creator — called once before first message persist. */
  ensureSessionId?: () => Promise<string | null>;
  /** User-attached image (data:image/...;base64,...) for vision sidecar. */
  imageBase64?: string;
  /**
   * 用户此刻的语气/情绪 (SenseVoice 提供)。
   * 例如 "happy"、"sad/laughter"（同时带笑声事件）。
   * 作为「对方此刻的语气」进 prompt，让 Remi 接住用户的口气。
   */
  userVocalTone?: string;
};

export async function runPipeline(
  sink: MessageSink,
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
    let finalReplyEmotion = replyEmotion;
    send(sink, { type: "emotion", emotion: replyEmotion });

    const avatarFrames = avatar.setEmotion(replyEmotion as any);
    for (const frame of avatarFrames) {
      send(sink, { type: "avatar_frame", frame });
    }

    // ── Lazy session: create DB row only when we actually persist a message ──
    let effectiveSessionId = sessionId;
    if (isDbReady() && !effectiveSessionId && options?.ensureSessionId && !options?.silenceNudge) {
      try {
        effectiveSessionId = await options.ensureSessionId();
      } catch (err) {
        logger.warn("[Storage] Lazy session creation failed", { error: err });
      }
    }

    if (isDbReady() && effectiveSessionId && !options?.silenceNudge) {
      try {
        await saveMessage(effectiveSessionId, "user", text);
      } catch (err) {
        logger.warn("[Storage] Failed to save user message", { error: err, sessionId: effectiveSessionId });
      }
    }

    const thinkingFiller =
      !options?.silenceNudge &&
      getConfig().REMI_THINKING_FILLER;

    // ── Producer-consumer TTS: synthesize sentences as they stream in ──

    const sentenceQueue: string[] = [];
    let sentenceIdx = 0;
    let producerDone = false;
    let waitResolve: (() => void) | null = null;

    let enqueuedSegmentCount = 0;
    let ttsSuppressed =
      ctx.skipTtsThisTurn || !isSessionTtsEnabled(ctx.connId);
    let firstAudioSent = false;
    let thinkingFillerTimer: ReturnType<typeof setTimeout> | null = null;
    const clearThinkingFillerTimer = () => {
      if (thinkingFillerTimer) {
        clearTimeout(thinkingFillerTimer);
        thinkingFillerTimer = null;
      }
    };

    function suppressTts(reason: string): void {
      if (ttsSuppressed) return;
      ttsSuppressed = true;
      sentenceQueue.length = 0;
      sentenceIdx = 0;
      clearThinkingFillerTimer();
      logger.info("[TTS suppressed]", { connId, generationId, reason });
      if (waitResolve) {
        const r = waitResolve;
        waitResolve = null;
        r();
      }
    }

    function pushSentence(s: string, boundaryType: SentenceChunkBoundaryType) {
      if (ctx.skipTtsThisTurn) {
        suppressTts("image_turn");
      }
      if (ttsSuppressed || containsImageMarkdown(s)) {
        if (containsImageMarkdown(s)) {
          suppressTts("image_markdown_segment");
        }
        return;
      }
      const speakablePunct = getConfig().REMI_TTS_SPEAKABLE_PUNCT;
      const ttsText = resolveTtsQueueText(s, {
        nsfw: isNsfwEnabled(connId),
        speakablePunct,
      });
      if (!ttsText) {
        if (isNsfwEnabled(connId)) {
          logger.debug("[TTS segment skipped]", {
            connId,
            generationId,
            reason: "nsfw_narration",
            preview: ttsSegmentPreview(s),
          });
        }
        return;
      }
      sentenceQueue.push(ttsText);
      enqueuedSegmentCount += 1;
      logger.debug("[TTS segment queued]", {
        connId,
        generationId,
        segmentIndex: enqueuedSegmentCount,
        boundaryType,
        chars: s.length,
        ttsChars: ttsText.length,
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

    if (thinkingFiller && isTtsEnabled() && !signal.aborted && !ttsSuppressed) {
        thinkingFillerTimer = setTimeout(() => {
          thinkingFillerTimer = null;
          if (signal.aborted || firstAudioSent) return;
          void synthesize("嗯", signal, replyEmotion as any, {
            connId,
            generationId,
            usage: "thinking_filler",
            relationalStance: ctx.persona.liveState.relationalStance,
            responsePolicy: ctx.lastResponsePolicy,
          })
            .then((buf) => {
              if (!signal.aborted && !firstAudioSent) {
                send(sink, { type: "voice", audio: buf.toString("base64"), generationId });
            }
          })
          .catch(() => {});
      }, thinkingFillerDelayMs());
    }
    let ttsError: Error | null = null;

    const ttsTask = (async () => {
      while (true) {
        if (signal.aborted || ttsSuppressed) break;

        if (sentenceIdx < sentenceQueue.length) {
          const rawSentence = sentenceQueue[sentenceIdx++];
          if (signal.aborted) break;

          if (sentenceIdx === 1) latencyTracer.mark("tts_start", traceId);
          const sentence = rawSentence;

          try {
            ic.markSpeaking();
            await ttsSend(
              sink,
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

    const nsfwActive = isNsfwEnabled(connId);
    // In NSFW mode, use shorter max chunk so moaning/speech segments stay under
    // ~3-4s of audio each — the NSFW instruct speaks slower (with breathing),
    // and long segments cause perceptible gaps between TTS synthesis calls.
    const chunker = new SentenceChunker(
      nsfwActive ? { maxChunkChars: 50 } : undefined,
    );
    chunker.setEager(true);
    let full = "";
    let firstTokenReceived = false;
    let firstSentenceSent = false;

    const baseRouteOptions = options?.silenceNudge
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
    // 世界情境、用户图片、语音情绪与上述各分支正交，统一附加
    const routeOptions: Record<string, unknown> = {
      ...baseRouteOptions,
      ...(options?.situationalContext && !options?.silenceNudge
        ? { situationalContext: options.situationalContext }
        : {}),
      ...(options?.imageBase64 ? { imageBase64: options.imageBase64 } : {}),
      ...(options?.userVocalTone ? { userVocalTone: options.userVocalTone } : {}),
    };

    const emotionParser = new EmotionTagParser();

    for await (const token of chatStream(
      ctx,
      text,
      replyEmotion,
      signal,
      routeOptions,
    )) {
      if (signal.aborted) break;

      if (!token) continue;

      if (!firstTokenReceived) {
        firstTokenReceived = true;
        const now = Date.now();
        latencyTracer.set("llm_first_visible_content", now, traceId);
        latencyTracer.set("llm_first_token", now, traceId);
        clearThinkingFillerTimer();
      }

      const parsed = emotionParser.feed(token);
      if (parsed.cleanText) {
        full += parsed.cleanText;
        ctx.currentAssistantDraft = full;
        if (ctx.skipTtsThisTurn) {
          suppressTts("image_turn");
        }
        if (containsImageMarkdown(full)) {
          suppressTts("image_markdown_full");
        }
        send(sink, { type: "chat_chunk", content: parsed.cleanText, generationId });

        const chunkToken = prepareTextForTtsChunking(
          parsed.cleanText,
          getConfig().REMI_TTS_SPEAKABLE_PUNCT,
        );
        for (const sentence of chunker.pushDetailed(chunkToken)) {
          pushSentence(sentence.text, sentence.boundaryType);
          if (!firstSentenceSent) {
            firstSentenceSent = true;
            if (sentence.boundaryType === "hard_end") {
              chunker.setEager(false);
            }
          }
        }
      }
    }

    latencyTracer.mark("llm_end", traceId);

    if (!signal.aborted) {
      const flushed = emotionParser.flush();
      if (flushed.cleanText) {
        full += flushed.cleanText;
        ctx.currentAssistantDraft = full;
        send(sink, { type: "chat_chunk", content: flushed.cleanText, generationId });
        const flushedChunkToken = prepareTextForTtsChunking(
          flushed.cleanText,
          getConfig().REMI_TTS_SPEAKABLE_PUNCT,
        );
        for (const sentence of chunker.pushDetailed(flushedChunkToken)) {
          pushSentence(sentence.text, sentence.boundaryType);
        }
      }

      const last = chunker.flushDetailed();
      if (last) pushSentence(last.text, last.boundaryType);

      const llmEmotion = emotionParser.getDetectedEmotion();
      if (llmEmotion) {
        finalReplyEmotion = llmEmotion;
        send(sink, { type: "emotion", emotion: finalReplyEmotion });
        const newFrames = avatar.setEmotion(finalReplyEmotion as any);
        for (const frame of newFrames) {
          send(sink, { type: "avatar_frame", frame });
        }
      }
    } else {
      chunker.reset();
    }

    const shouldInferAvatarIntent =
      Boolean(full) && !signal.aborted && avatarIntentEnabled();
    const avatarIntentTask = shouldInferAvatarIntent
      ? inferAvatarIntentFromReply(full, finalReplyEmotion as any, signal)
          .then((result) => (signal.aborted ? null : result))
          .catch(() => null)
      : Promise.resolve(null);

    endProducer();
    signal.removeEventListener("abort", onAbort);

    // ── Post-LLM steps (run while TTS processes in parallel) ──

    send(sink, {
      type: "chat_end",
      emotion: finalReplyEmotion,
      content: signal.aborted ? "[interrupted]" : undefined,
      generationId,
      ttsPending: isTtsEnabled() && !ttsSuppressed && enqueuedSegmentCount > 0,
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

    for (const guard of getOutputGuardHooks()) {
      const result = guard.review(full, {
        userMessage: text,
        persona: ctx.persona,
        connId,
        nsfwEnabled: isNsfwEnabled(connId),
      });
      if (result.action === "modify") {
        full = result.modified;
      } else if (result.action === "block") {
        full = result.replacement;
        break;
      }
    }

    if (isDbReady() && effectiveSessionId && full && !signal.aborted && shouldPersistAssistantReply) {
      try {
        await saveMessage(effectiveSessionId, "assistant", full);
      } catch (err) {
        logger.warn("[Storage] Failed to save assistant message", { error: err, sessionId: effectiveSessionId });
      }
    }

    if (full && !signal.aborted && shouldPersistAssistantReply) {
      const actionFrames = avatar.processReply(full);
      for (const frame of actionFrames) {
        send(sink, { type: "avatar_frame", frame });
      }
    }

    if (!signal.aborted) {
      const avatarIntentEnvelope = await waitForAbortable(
        avatarIntentTask,
        signal,
        null,
      );
      if (avatarIntentEnvelope) {
        send(sink, {
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
        emotion: finalReplyEmotion,
        connId,
      });
    }

    if (signal.aborted) {
      clearThinkingFillerTimer();
      send(sink, { type: "emotion", emotion: "neutral" });
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
      send(sink, { type: "emotion", emotion: "neutral" });
      latencyTracer.mark("tts_end", traceId);
      latencyTracer.log(traceId);
      return;
    }

    send(sink, { type: "tts_end", generationId });

    decayEmotion(ctx.emotion);

    latencyTracer.mark("tts_end", traceId);
    latencyTracer.log(traceId);
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      logger.error("[错误]", { error: err, connId });
      send(sink, { type: "error", content: "AI 回复生成失败" });
    }
  } finally {
    if (ctx.currentAssistantDraft !== null) {
      ctx.currentAssistantDraft = null;
    }
    ctx.skipTtsThisTurn = false;
    ic.finish(interruptRunToken);
  }
}

async function ttsSend(
  sink: MessageSink,
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
      let streamedLipSource: TtsLipSyncChunk["source"] = "provider_word_boundary_derived";
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
            send(sink, {
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
          (chunk) => {
            if (signal?.aborted) return;
            streamedLipSource = chunk.source;
            if (chunk.cues.length > 0 || chunk.complete) {
              sendTtsLipSync(sink, generationId, chunk);
            }
          },
          {
            connId: ctx.connId,
            generationId,
            usage: "reply",
          },
        );
        if (!signal?.aborted) {
          sendTtsLipSync(sink, generationId, {
            source: streamedLipSource,
            mode: "append",
            complete: true,
            cues: [],
          });
        }
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

    const result =
      typeof synthesizeResult === "function"
        ? await synthesizeResult(sentence, signal, emotion as any, {
            connId: ctx.connId,
            generationId,
            usage: "reply",
            relationalStance: ctx.persona.liveState.relationalStance,
            responsePolicy: ctx.lastResponsePolicy ?? null,
          })
        : {
            audio: await synthesize(sentence, signal, emotion as any, {
              connId: ctx.connId,
              generationId,
              usage: "reply",
              relationalStance: ctx.persona.liveState.relationalStance,
              responsePolicy: ctx.lastResponsePolicy ?? null,
            }),
            lipSync: null,
          };
    const audio = result.audio;
    if (result.lipSync) {
      sendTtsLipSync(sink, generationId, result.lipSync);
    }
    if (signal?.aborted) return;
    if (!audio || audio.length === 0) return;
    if (isFirstSentence && latencyTracer) {
      latencyTracer.mark("tts_first_audio", traceId);
    }
    send(sink, { type: "voice", audio: audio.toString("base64"), generationId });
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      logger.warn("[TTS]", { error: (err as Error).message });
    }
  }
}
