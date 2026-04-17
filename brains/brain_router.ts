import { fastBrainStream } from "./fast_brain";
import { trimHistoryToTokenBudget } from "./history_budget";
import { runSlowBrain } from "./slow_brain";
import { isFallbackAssistantReply } from "./assistant_reply_guard";
import {
  extractMemory,
  retrievePromptMemory,
} from "../memory/memory_agent";
import type { PromptMessage } from "../brain/prompt_builder";
import type { Emotion } from "../emotion/emotion_state";
import type { RemiSessionContext } from "./remi_session_context";
import { createLogger } from "../infra/logger";
import { getLatencyTracer } from "../infra/latency_tracer";
import {
  relationshipStateEnabled,
  savePersistentRelationshipState,
} from "../memory/relationship_state";
import { reviewReplyTone } from "../brain/tone_policy";
import { tryHandleDirectCapabilities } from "../brain/direct_capabilities";
import {
  analyzeTurn,
  shouldAnalyzeTurn,
  type TurnAnalysisBundle,
} from "../brain/turn_interpreter";
import type { WorkingMemory } from "./slow_brain_store";

const MAX_HISTORY = 10;
const logger = createLogger("brain_router");
const DEFAULT_FAST_PATH_HISTORY_TOKENS = 1000;
const DEFAULT_ANALYSIS_PATH_HISTORY_TOKENS = 1200;
const DEFAULT_FAST_PATH_PROMPT_MEMORY_ENTRIES = 4;
const DEFAULT_ANALYSIS_PATH_PROMPT_MEMORY_ENTRIES = 5;
const COMPACT_PRIORITY_BLOCK_LIMIT = 3;
const ANALYSIS_PRIORITY_BLOCK_LIMIT = 6;

function configuredPositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function resolvePromptMemoryMaxEntries(
  inputSource: "text" | "voice",
  _analysisCandidate: boolean,
): number {
  if (inputSource === "text") {
    return configuredPositiveInt(
      process.env.REMI_FAST_PATH_PROMPT_MEMORY_ENTRIES,
      DEFAULT_FAST_PATH_PROMPT_MEMORY_ENTRIES,
    );
  }
  return configuredPositiveInt(
    process.env.REMI_ANALYSIS_PATH_PROMPT_MEMORY_ENTRIES,
    DEFAULT_ANALYSIS_PATH_PROMPT_MEMORY_ENTRIES,
  );
}

function resolveHistoryTokenBudget(
  inputSource: "text" | "voice",
  analysisCandidate: boolean,
): number {
  if (inputSource === "text" && !analysisCandidate) {
    return configuredPositiveInt(
      process.env.REMI_FAST_PATH_HISTORY_TOKENS,
      DEFAULT_FAST_PATH_HISTORY_TOKENS,
    );
  }
  return configuredPositiveInt(
    process.env.REMI_ANALYSIS_PATH_HISTORY_TOKENS,
    DEFAULT_ANALYSIS_PATH_HISTORY_TOKENS,
  );
}

function readPriorityBlock(text: string | undefined, heading: string): string | undefined {
  if (!text?.trim()) return undefined;
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`【${escaped}】\\s*([\\s\\S]*?)(?=\\n\\s*【|$)`, "m");
  const match = text.match(pattern);
  const content = match?.[1]?.trim();
  return content ? `【${heading}】${content}` : undefined;
}

function trimTextByChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function compactPriorityBlock(block: string, heading: string, maxChars: number): string {
  const content = block.replace(/^【[^】]+】/, "").trim();
  let normalized = content.replace(/\n+/g, " ").replace(/\s{2,}/g, " ").trim();

  if (heading === "关系阶段") {
    const firstLine = content.split("\n")[0]?.trim() ?? "";
    normalized = firstLine.replace(/^当前阶段[:：]\s*/, "").trim() || normalized;
  } else if (heading === "长期关系主线") {
    normalized = content
      .split("\n")
      .map((line) => line.replace(/^-+\s*/, "").trim())
      .filter(Boolean)[0] ?? normalized;
  }

  return `【${heading}】${trimTextByChars(normalized, maxChars)}`;
}

function buildCompactPriorityContext(
  strategyHints: string | undefined,
  slowBrainContext: string | undefined,
): string | undefined {
  const selectors: Array<{ source: string | undefined; heading: string }> = [
    { source: strategyHints, heading: "话题边界" },
    { source: slowBrainContext, heading: "话题边界" },
    { source: strategyHints, heading: "场景承接" },
    { source: strategyHints, heading: "响应策略" },
    { source: strategyHints, heading: "本轮回复合同" },
    { source: strategyHints, heading: "实时连续性" },
    { source: strategyHints, heading: "语气合同" },
    { source: strategyHints, heading: "主动提起候选" },
    { source: strategyHints, heading: "共同经历提醒" },
    { source: slowBrainContext, heading: "当前未完主线" },
    { source: slowBrainContext, heading: "长期关系主线" },
    { source: slowBrainContext, heading: "对话摘要" },
    { source: strategyHints, heading: "关系表达风格" },
    { source: slowBrainContext, heading: "关系阶段" },
  ];
  const selected: string[] = [];
  const seenHeadings = new Set<string>();

  for (const selector of selectors) {
    if (selected.length >= COMPACT_PRIORITY_BLOCK_LIMIT) break;
    if (seenHeadings.has(selector.heading)) continue;
    const block = readPriorityBlock(selector.source, selector.heading);
    if (!block) continue;
    selected.push(block);
    seenHeadings.add(selector.heading);
  }

  return selected.length > 0 ? selected.join("\n") : undefined;
}

function buildAnalysisPriorityContext(
  analysis: TurnAnalysisBundle,
  strategyHints: string | undefined,
  slowBrainContext: string | undefined,
): string | undefined {
  const act = analysis.interpretation.userAct;
  const decisionLike = (
    act === "decision_seek" ||
    act === "answer_now" ||
    act === "direct_question" ||
    analysis.policy.shouldUpdateDecisionContext
  );
  const sceneLike = act === "scene_continue";
  const boundaryLike = act === "topic_veto";

  const selectors: Array<{ source: string | undefined; heading: string; maxChars: number }> = decisionLike
    ? [
        { source: strategyHints, heading: "话题边界", maxChars: 84 },
        { source: strategyHints, heading: "响应策略", maxChars: 180 },
        { source: strategyHints, heading: "本轮回复合同", maxChars: 150 },
        { source: strategyHints, heading: "语气合同", maxChars: 180 },
        { source: slowBrainContext, heading: "当前未完主线", maxChars: 120 },
        { source: slowBrainContext, heading: "对话摘要", maxChars: 110 },
        { source: slowBrainContext, heading: "关系阶段", maxChars: 36 },
      ]
    : sceneLike
      ? [
          { source: strategyHints, heading: "话题边界", maxChars: 84 },
          { source: strategyHints, heading: "场景承接", maxChars: 96 },
          { source: strategyHints, heading: "本轮回复合同", maxChars: 150 },
          { source: strategyHints, heading: "语气合同", maxChars: 180 },
          { source: slowBrainContext, heading: "关系阶段", maxChars: 36 },
        ]
      : boundaryLike
        ? [
            { source: strategyHints, heading: "话题边界", maxChars: 84 },
            { source: strategyHints, heading: "响应策略", maxChars: 160 },
            { source: strategyHints, heading: "本轮回复合同", maxChars: 120 },
            { source: strategyHints, heading: "语气合同", maxChars: 160 },
            { source: slowBrainContext, heading: "关系阶段", maxChars: 36 },
          ]
        : [
            { source: strategyHints, heading: "话题边界", maxChars: 84 },
            { source: strategyHints, heading: "响应策略", maxChars: 160 },
            { source: strategyHints, heading: "本轮回复合同", maxChars: 140 },
            { source: strategyHints, heading: "语气合同", maxChars: 170 },
            { source: strategyHints, heading: "实时连续性", maxChars: 110 },
            { source: slowBrainContext, heading: "当前未完主线", maxChars: 110 },
            { source: slowBrainContext, heading: "对话摘要", maxChars: 100 },
            { source: slowBrainContext, heading: "关系阶段", maxChars: 36 },
          ];

  const selected: string[] = [];
  const seenHeadings = new Set<string>();

  for (const selector of selectors) {
    if (selected.length >= ANALYSIS_PRIORITY_BLOCK_LIMIT) break;
    if (seenHeadings.has(selector.heading)) continue;
    const block = readPriorityBlock(selector.source, selector.heading);
    if (!block) continue;
    selected.push(compactPriorityBlock(block, selector.heading, selector.maxChars));
    seenHeadings.add(selector.heading);
  }

  return selected.length > 0 ? selected.join("\n") : undefined;
}

function slowBrainEnabled(): boolean {
  const raw = (process.env.REMI_SLOW_BRAIN_ENABLED ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false";
}

export interface RouteMessageOptions {
  /** 服务端触发的陪伴搭话：不跑记忆提取与慢脑，历史中 user 用短占位 */
  systemTriggered?: boolean;
  /** 阶段1增量输入命中预判时，复用已生成回复，避免再次触发LLM。 */
  pregeneratedReply?: string;
  /** 预判阶段已完成的结构化解释，可随预生成回复一起复用。 */
  structuredAnalysis?: TurnAnalysisBundle | null;
  /** 打断承接提示，帮助快脑把新一轮回复接在正确的会话分支上。 */
  carryForwardHint?: string;
  /** 仅文本主链路启用语气 review，先不影响语音链路。 */
  inputSource?: "text" | "voice";
  /** 延迟追踪 trace id，用于把 memory/analysis 开销记到同一轮。 */
  traceId?: string;
}

async function persistContinuityCueState(ctx: RemiSessionContext): Promise<void> {
  if (!relationshipStateEnabled()) return;
  const relationshipRepo =
    ctx.persistentRelationshipRepo ??
    ctx.memory.getPersistentBackend() ??
    ctx.memory;
  if (!relationshipRepo) return;

  try {
    await savePersistentRelationshipState(
      relationshipRepo,
      ctx.slowBrain.exportPersistentState(),
    );
  } catch (err) {
    logger.warn("连续性提示持久化失败", {
      connId: ctx.connId,
      error: (err as Error).message,
    });
  }
}

function finalizeDirectReply(input: {
  ctx: RemiSessionContext;
  userMessage: string;
  reply: string;
  emotion: Emotion;
  workingMemoryDraft?: WorkingMemory | null;
  signal?: AbortSignal;
  systemTriggered?: boolean;
}): "handled" | "aborted" {
  const { ctx, userMessage, reply, emotion, signal } = input;
  if (signal?.aborted) {
    if (!input.systemTriggered && reply.trim()) {
      ctx.lastInterruptedReply = reply;
    }
    ctx.updateLiveState(emotion);
    if (!input.systemTriggered) {
      ctx.markInterrupted();
    }
    return "aborted";
  }

  const historyUserContent = input.systemTriggered
    ? "［你主动开口陪对方聊天］"
    : userMessage;
  ctx.history.push({ role: "user", content: historyUserContent });
  ctx.history.push({ role: "assistant", content: reply });
  while (ctx.history.length > MAX_HISTORY) {
    ctx.history.shift();
  }

  ctx.updateLiveState(emotion, userMessage, reply);
  ctx.slowBrain.recordUserTurnActivity(userMessage);
  ctx.slowBrain.applyWorkingMemoryDraft(input.workingMemoryDraft);
  ctx.slowBrain.setLastEmotion(emotion);
  return "handled";
}

/**
 * Brain Router: dispatches user input to both brains.
 *
 *  ┌─────────┐   stream tokens   ┌──────────┐
 *  │  Router  │ ────────────────► │Fast Brain│ ──► caller
 *  └────┬────┘                    └──────────┘
 *       │  fire-and-forget
 *       └───────────────────────► ┌──────────┐
 *                                 │Slow Brain│ (background)
 *                                 └──────────┘
 *
 * Slow brain NEVER blocks the token stream.
 */
export async function* routeMessage(
  ctx: RemiSessionContext,
  userMessage: string,
  emotion: Emotion,
  signal?: AbortSignal,
  opts?: RouteMessageOptions,
): AsyncGenerator<string> {
  ctx.cancelSlowBrain();
  ctx.lastInterpretation = null;
  ctx.lastResponsePolicy = null;
  ctx.analysisSource = null;
  ctx.analysisLatencyMs = null;

  // 处理「刚才说到哪了」查询
  const interruptedQueryRegex = /^(刚才|刚刚|刚刚|刚才)(说到哪|说什么|在说啥|讲到哪)/i;
  if (interruptedQueryRegex.test(userMessage.trim()) && ctx.lastInterruptedReply) {
    yield `我刚才说到：${ctx.lastInterruptedReply}`;
    return;
  }

  const inputSource = opts?.inputSource ?? "text";
  const directCapabilityResult = await tryHandleDirectCapabilities({
    userMessage,
    emotion,
    ctx,
    signal,
    systemTriggered: Boolean(opts?.systemTriggered),
    inputSource,
  });
  if (directCapabilityResult.handled) {
    const directWorkingMemoryDraft = ctx.slowBrain.buildWorkingMemoryDraft({
      userMessage,
      directCapabilityId: directCapabilityResult.capabilityId,
    });
    yield directCapabilityResult.reply;
    const result = finalizeDirectReply({
      ctx,
      userMessage,
      reply: directCapabilityResult.reply,
      emotion,
      workingMemoryDraft: directWorkingMemoryDraft,
      signal,
      systemTriggered: opts?.systemTriggered,
    });
    if (result === "handled" && !opts?.systemTriggered) {
      await persistContinuityCueState(ctx);
    }
    return;
  }

  if (!opts?.systemTriggered) {
    extractMemory(userMessage, ctx.memory);
  }
  const pregeneratedReply = opts?.pregeneratedReply?.trim();
  const precomputedAnalysis = opts?.structuredAnalysis?.used ? opts.structuredAnalysis : null;
  const carryForwardHint = opts?.carryForwardHint?.trim();
  const slowBrainSnapshot = ctx.slowBrain.getSnapshot();
  const analysisInput = {
    userMessage,
    history: ctx.history,
    slowBrainSnapshot,
    inputSource,
    signal,
  } as const;
  const analysisCandidate =
    Boolean(precomputedAnalysis) ||
    (!opts?.systemTriggered && shouldAnalyzeTurn(analysisInput));
  const promptMemoryMaxEntries = resolvePromptMemoryMaxEntries(inputSource, analysisCandidate);
  const historyTokenBudget = resolveHistoryTokenBudget(inputSource, analysisCandidate);
  const latencyTracer = opts?.traceId ? getLatencyTracer(ctx.connId) : null;
  const traceId = opts?.traceId;
  let analysis = precomputedAnalysis;
  let memory = [] as Awaited<ReturnType<typeof retrievePromptMemory>>;
  if (!pregeneratedReply) {
    const analysisPromise =
      opts?.systemTriggered || precomputedAnalysis || !analysisCandidate
        ? Promise.resolve(precomputedAnalysis)
        : (async () => {
            if (latencyTracer && traceId) {
              latencyTracer.mark("turn_analysis_start", traceId);
            }
            try {
              return await analyzeTurn(analysisInput);
            } finally {
              if (latencyTracer && traceId) {
                latencyTracer.mark("turn_analysis_end", traceId);
              }
            }
          })();
    const memoryPromise = (async () => {
      if (latencyTracer && traceId) {
        latencyTracer.mark("memory_recall_start", traceId);
      }
      try {
        return await retrievePromptMemory(ctx.memory, {
          userId: ctx.userId,
          userMessage,
          slowBrainSnapshot,
          maxEntries: promptMemoryMaxEntries,
          diagnostics: (meta) => {
            if (latencyTracer && traceId) {
              latencyTracer.annotateTrace(traceId, {
                episodeRecallSource: meta.episodeRecallSource,
                episodeRecallIds: meta.episodeRecallIds,
                episodeReferenceApplied: meta.episodeReferenceApplied,
                episodeRecallFallback: meta.episodeRecallFallback,
              });
            }
          },
        });
      } finally {
        if (latencyTracer && traceId) {
          latencyTracer.mark("memory_recall_end", traceId);
        }
      }
    })();
    [memory, analysis] = await Promise.all([memoryPromise, analysisPromise]);
  }
  if (analysis) {
    ctx.lastInterpretation = analysis.interpretation;
    ctx.lastResponsePolicy = analysis.policy;
    ctx.analysisSource = analysis.source;
    ctx.analysisLatencyMs = analysis.latencyMs;
  }
  const guidance = ctx.slowBrain.buildConversationGuidance(
    userMessage,
    analysis?.used ? analysis : null,
  );
  const slowBrainContext = ctx.slowBrain.synthesizeContext();
  const workingMemoryDraft = analysis?.used
    ? ctx.slowBrain.buildWorkingMemoryDraft({
        userMessage,
        interpretation: analysis.interpretation,
        responsePolicy: analysis.policy,
      })
    : null;
  const currentContext = ctx.slowBrain.buildWorkingMemoryPromptBlock(workingMemoryDraft);
  const analysisPriorityContext =
    inputSource === "text" && analysis?.used
      ? buildAnalysisPriorityContext(analysis, guidance.hints, slowBrainContext)
      : undefined;
  const compactPriorityContext =
    inputSource === "text" && !analysisCandidate
      ? buildCompactPriorityContext(guidance.hints, slowBrainContext)
      : undefined;
  const historyForPrompt = trimHistoryToTokenBudget([...ctx.history], historyTokenBudget);
  const strategyHintsForPrompt = [
    analysisPriorityContext ?? compactPriorityContext ?? guidance.hints,
    carryForwardHint,
  ]
    .filter((part): part is string => Boolean(part?.trim()))
    .join("\n\n");
  const slowBrainContextForPrompt =
    (analysisPriorityContext && inputSource === "text") ||
    (compactPriorityContext && inputSource === "text" && !analysisCandidate)
      ? undefined
      : slowBrainContext;

  let fullReply = "";
  const onFirstLlmChunk =
    latencyTracer && traceId
      ? () => {
          const now = Date.now();
          latencyTracer.set("llm_first_raw_chunk", now, traceId);
          latencyTracer.set("llm_stream_first_chunk", now, traceId);
        }
      : undefined;
  const onFirstLlmReasoningChunk =
    latencyTracer && traceId
      ? () => latencyTracer.set("llm_first_reasoning_chunk", Date.now(), traceId)
      : undefined;
  const onFirstLlmVisibleContent =
    latencyTracer && traceId
      ? () => latencyTracer.set("llm_first_visible_content", Date.now(), traceId)
      : undefined;

  if (pregeneratedReply) {
    if (latencyTracer && traceId) {
      latencyTracer.mark("llm_request_start", traceId);
    }
    logger.info("复用 partial transcript 预判回复", {
      replyChars: pregeneratedReply.length,
      userChars: userMessage.length,
    });
    fullReply = pregeneratedReply;
    yield pregeneratedReply;
  } else {
    if (latencyTracer && traceId) {
      latencyTracer.mark("llm_request_start", traceId);
    }
    for await (const token of fastBrainStream({
      userMessage,
      emotion,
      memory,
      history: historyForPrompt,
      currentContext,
      slowBrainContext: slowBrainContextForPrompt,
      strategyHints: strategyHintsForPrompt,
      signal,
      onFirstLlmChunk,
      onFirstLlmReasoningChunk,
      onFirstLlmVisibleContent,
      persona: ctx.persona,
    })) {
      fullReply += token;
      yield token;
    }
  }

  if (signal?.aborted) {
    if (!opts?.systemTriggered && fullReply.trim()) {
      ctx.lastInterruptedReply = fullReply;
    }
    ctx.updateLiveState(emotion);
    if (!opts?.systemTriggered) {
      ctx.markInterrupted();
    }
    return;
  }

  if (opts?.inputSource === "text") {
    const toneReview = reviewReplyTone(fullReply);
    if (toneReview.assistanty) {
      logger.warn("tone guard flagged assistanty reply", {
        connId: ctx.connId,
        score: toneReview.score,
        reasons: toneReview.reasons,
        preview: fullReply.slice(0, 120),
        analysisSource: ctx.analysisSource ?? undefined,
        analysisLatencyMs: ctx.analysisLatencyMs ?? undefined,
      });
    }
  }

  const historyUserContent = opts?.systemTriggered
    ? "［你主动开口陪对方聊天］"
    : userMessage;
  const shouldPersistAssistantReply = !isFallbackAssistantReply(fullReply);
  // Update history
  ctx.history.push({ role: "user", content: historyUserContent });
  if (shouldPersistAssistantReply) {
    ctx.history.push({ role: "assistant", content: fullReply });
  }
  while (ctx.history.length > MAX_HISTORY) {
    ctx.history.shift();
  }

  // Update live persona state after interaction
  ctx.updateLiveState(
    emotion,
    userMessage,
    fullReply
  );
  ctx.slowBrain.recordUserTurnActivity(userMessage);
  if (shouldPersistAssistantReply) {
    ctx.slowBrain.applyWorkingMemoryDraft(workingMemoryDraft);
  }
  ctx.slowBrain.setLastEmotion(emotion);

  ctx.slowBrain.markContinuityCueUsed({
    proactiveCandidate: guidance.proactiveCandidate,
    sharedMomentCandidate: guidance.sharedMomentCandidate,
  });

  if (!opts?.systemTriggered && shouldPersistAssistantReply && slowBrainEnabled()) {
    const slowBrainSignal = ctx.beginSlowBrain();
    runSlowBrain({
      userId: ctx.userId,
      userMessage,
      assistantReply: fullReply,
      history: [...ctx.history],
      slowBrain: ctx.slowBrain,
      memoryRepo: ctx.memory,
      relationshipRepo:
        ctx.persistentRelationshipRepo ??
        ctx.memory.getPersistentBackend() ??
        ctx.memory,
      signal: slowBrainSignal,
    }).catch((err) =>
      logger.warn("后台分析失败", { error: (err as Error).message }),
    ).finally(() => {
      ctx.endSlowBrain(slowBrainSignal);
    });
  } else if (!opts?.systemTriggered && !shouldPersistAssistantReply) {
    logger.info("skip history persistence for fallback assistant reply", {
      connId: ctx.connId,
      preview: fullReply.slice(0, 40),
    });
  } else if (!opts?.systemTriggered) {
    logger.debug("slow brain skipped by budget gate", {
      connId: ctx.connId,
    });
    await persistContinuityCueState(ctx);
  }
}
