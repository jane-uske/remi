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
import {
  checkReplyTimeGuard,
  checkReplyTimeGuardForFullText,
  stripSentenceLoose,
  type ReplyTimeGuardViolation,
} from "../../utils/reply_time_guard";
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

// ── 回复出口时间守卫（2026-07 生产实锤止血）─────────────────────────────
//
// 纯规则、纯同步：句子发出前校验星期/时段断言是否与"当下"矛盾（原理见
// utils/reply_time_guard.ts 顶部注释）。off=不校验；detect=只记 WARN 不拦截；
// drop=违规句从 TTS 队列和持久化文本里一并丢弃（兜底：整条回复全被丢时放行
// 原文，只记日志，绝不能让她哑巴）。默认 drop。
// 判定粒度是"真句"（硬标点边界），不是 TTS chunk——见 pushSentence 内
// GUARD-03 注释。

type ReplyTimeGuardMode = "off" | "detect" | "drop";

function replyTimeGuardMode(): ReplyTimeGuardMode {
  return getConfig().REMI_REPLY_TIME_GUARD;
}

/** 用户时区取不到时的兜底：env REMI_TZ（默认 Asia/Shanghai）。 */
function resolveGuardTimeZone(ctx: RemiSessionContext): string {
  return ctx.getClientTimeZone() ?? getConfig().REMI_TZ;
}

function logReplyTimeGuardHit(
  connId: string,
  generationId: number,
  mode: ReplyTimeGuardMode,
  sentence: string,
  violations: ReplyTimeGuardViolation[],
): void {
  logger.warn("[ReplyTimeGuard]", {
    connId,
    generationId,
    mode,
    sentence: ttsSegmentPreview(sentence),
    violations: violations.map((v) => ({
      kind: v.kind,
      token: v.token,
      expected: v.expected,
    })),
  });
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

    // 回复出口时间守卫：drop 模式下被丢弃的原句，供 chat_end 前从 `full`
    // 持久化文本里剔除（详见 pushSentence 内部与函数末尾的剔除逻辑）。
    // totalSentencesSeen 以"真句"（硬标点边界）为单位计数——一个 TTS chunk
    // 可能由多个真句合并而成（SentenceChunker 会把 <minTtsChars 的短句 hold
    // 进下一块），守卫判定与计数都在真句粒度上做（GUARD-03），用来判断
    // "这条回复的全部句子是不是都被时间守卫丢了"：只有 totalSentencesSeen > 0
    // 且 droppedByTimeGuard.length >= totalSentencesSeen 时才触发兜底（放行
    // 原文只记日志，不能让她哑巴）。
    const droppedByTimeGuard: string[] = [];
    let totalSentencesSeen = 0;

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

      // ── 回复出口时间守卫：句子发出前的最小切口 ──────────────────────
      // 注意：主动搭话（silenceNudge）也要过守卫——生产案例②本身就是一次
      // 凌晨 01:42 的沉默搭话说错了时段，不能把这条路径排除在外。
      //
      // GUARD-03（2026-07-04 实测误杀）：这里收到的 `s` 是 TTS chunk，不是
      // 真句——SentenceChunker 会把 <minTtsChars 的短句 hold 进下一块，坏短句
      // 与无辜邻句合并后整块陪葬。所以判定按真句边界逐句做，drop 只丢违规
      // 子句，存活子句继续走 TTS。顺带修掉旧整块判定的跨句污染误杀：A 句的
      // "现在"会激活对 B 句时段词的审判（NOW_INDICATOR 本应是句内条件）。
      const guardMode = replyTimeGuardMode();
      if (guardMode !== "off") {
        const guardCtx = {
          now: new Date(),
          timeZone: resolveGuardTimeZone(ctx),
        };
        const perSentence = checkReplyTimeGuardForFullText(s, guardCtx);
        totalSentencesSeen += perSentence.length;
        let violating = perSentence.filter((p) => !p.result.ok);
        if (violating.length > 0 && perSentence.length > 1) {
          // 整块视角复核：真句切分会截断跨句豁免窗口（引号对、"明天/昨天"
          // 线索在邻句），子句视角单独判罚会造出旧整块判定没有的新误杀。
          // 只有"子句视角与整块视角都认定违规"的才 drop（宁可漏杀不误杀）。
          const whole = checkReplyTimeGuard(s, guardCtx);
          const wholeKeys = new Set(
            whole.violations.map((v) => `${v.kind}:${v.token}`),
          );
          violating = violating.filter((p) =>
            p.result.violations.some((v) => wholeKeys.has(`${v.kind}:${v.token}`)),
          );
        }
        if (violating.length > 0) {
          for (const v of violating) {
            logReplyTimeGuardHit(connId, generationId, guardMode, v.sentence, v.result.violations);
          }
          if (guardMode === "drop") {
            const dropSet = new Set(violating);
            for (const v of violating) droppedByTimeGuard.push(v.sentence);
            const keptText = perSentence
              .filter((p) => !dropSet.has(p)) // 注意不能按 result.ok 过滤：被整块视角豁免的句子 ok=false 但必须保留
              .map((p) => p.sentence)
              .join("")
              .trim();
            if (!keptText) return; // 整块全违规，照旧丢弃
            s = keptText; // 只丢违规子句，无辜邻句保留
          }
        }
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

    // ── 回复出口时间守卫：终稿预计算（chat_end 携带 + 持久化共用）─────
    // 违规句在 pushSentence 已拦掉 TTS，但 chat_chunk 流式文本早就到了客户
    // 端屏幕上（2026-07-04 生产两连案："反正周一还远着呢"闪现后留在界面）。
    // 这里在 chat_end 之前先算好剔除后的终稿：有 drop 时随 chat_end 带给
    // 前端（finalContent），让界面定稿时用终稿覆盖流式累积文本；真正给
    // `full` 赋值仍在下方原位置，保证 lastInterruptedReply /
    // shouldPersistAssistantReply 读到的值与改动前一致。
    const guardStripApplied =
      replyTimeGuardMode() === "drop" &&
      droppedByTimeGuard.length > 0 &&
      droppedByTimeGuard.length < totalSentencesSeen;
    let guardFinalContent = full;
    if (guardStripApplied) {
      for (const dropped of droppedByTimeGuard) {
        guardFinalContent = stripSentenceLoose(guardFinalContent, dropped);
      }
      guardFinalContent = guardFinalContent.trim();
    }

    send(sink, {
      type: "chat_end",
      emotion: finalReplyEmotion,
      content: signal.aborted ? "[interrupted]" : undefined,
      generationId,
      ttsPending: isTtsEnabled() && !ttsSuppressed && enqueuedSegmentCount > 0,
      // 无 drop / 被打断 / 剔除后为空 → 不带 finalContent，前端行为不变
      ...(guardStripApplied && !signal.aborted && guardFinalContent
        ? { finalContent: guardFinalContent }
        : {}),
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

    // ── 回复出口时间守卫：持久化前把 drop 掉的句子从 `full` 里剔除 ──────
    // "存储侧：丢弃的句子不进 messages 持久化"——终稿已在 chat_end 前算好
    // （guardFinalContent，同一份文本随 chat_end 带给了前端），这里生效到
    // `full`。兜底：如果这条回复的句子被守卫判定为"全部丢弃"
    // （totalSentencesSeen > 0 且两者相等），说明整条回复都在断言错误的
    // 时间，宁可放行原文也不能让她哑巴——只记日志，不剔除。
    if (guardStripApplied) {
      full = guardFinalContent;
    } else if (
      replyTimeGuardMode() === "drop" &&
      droppedByTimeGuard.length > 0 &&
      droppedByTimeGuard.length >= totalSentencesSeen
    ) {
      logger.warn("[ReplyTimeGuard] all sentences flagged, falling back to full reply", {
        connId,
        generationId,
        droppedCount: droppedByTimeGuard.length,
      });
    }

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
      // 首音看门狗（VOICE_BEST_PRACTICES 杠杆2）：仅作用于首句。若流式在超时内吐不出
      // 第一个 PCM chunk（Edge MP3→PCM 首包 stall 等），abort 流式尝试并回退 buffered，
      // 给 llm_first→tts_first 的 p95 设上界。需把"watchdog 触发"与"真实用户打断"区分：
      // 前者落 buffered 兜底，后者继续抛出走中断语义。0 = 关闭，happy path 完全不变。
      const firstAudioTimeoutMs = isFirstSentence
        ? getConfig().REMI_TTS_FIRST_AUDIO_TIMEOUT_MS
        : 0;
      const watchdogAc = firstAudioTimeoutMs > 0 ? new AbortController() : null;
      let watchdogFired = false;
      let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
      let forwardParentAbort: (() => void) | null = null;
      let streamSignal = signal;
      if (watchdogAc) {
        if (signal?.aborted) {
          watchdogAc.abort();
        } else if (signal) {
          forwardParentAbort = () => watchdogAc.abort();
          signal.addEventListener("abort", forwardParentAbort, { once: true });
        }
        streamSignal = watchdogAc.signal;
        watchdogTimer = setTimeout(() => {
          if (!firstChunkSent) {
            watchdogFired = true;
            watchdogAc.abort();
          }
        }, firstAudioTimeoutMs);
      }
      const clearWatchdog = () => {
        if (watchdogTimer) {
          clearTimeout(watchdogTimer);
          watchdogTimer = null;
        }
        if (signal && forwardParentAbort) {
          signal.removeEventListener("abort", forwardParentAbort);
          forwardParentAbort = null;
        }
      };
      try {
        await streamTextToSpeech(
          sentence,
          ({ pcm, sampleRate, channels, bitsPerSample }) => {
            if (streamSignal?.aborted) return;
            if (!firstChunkSent) {
              firstChunkSent = true;
              clearWatchdog();
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
          streamSignal,
          emotion as any,
          (chunk) => {
            if (streamSignal?.aborted) return;
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
        clearWatchdog();
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
        clearWatchdog();
        if ((err as Error).name === "AbortError") {
          // watchdog 触发（首句首包超时，且非真实用户打断）→ 落 buffered 兜底；
          // 其余 AbortError（真打断）→ 继续抛出。
          if (!(watchdogFired && !firstChunkSent && !signal?.aborted)) {
            throw err;
          }
          logger.warn("[TTS] first-audio watchdog fired, fallback to buffered synth", {
            connId: ctx.connId,
            generationId,
            timeoutMs: firstAudioTimeoutMs,
          });
        } else if (firstChunkSent) {
          throw err;
        } else {
          logger.warn("[TTS] stream failed, fallback to buffered synth", {
            error: (err as Error).message,
            ttsTransport,
          });
        }
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
