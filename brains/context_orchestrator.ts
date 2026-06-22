import { fastBrainStream } from "./reply_stream";
import { recallTimelineFacts } from "./timeline_facts";
import { trimHistoryToTokenBudget } from "./history_budget";
import { runSlowBrain } from './background_analysis';
import { isFallbackAssistantReply } from "./assistant_reply_guard";
import { visionEnabled, describeImage, USER_IMAGE_PROMPT } from "../llm/vision_client";
import { fetchImageAsBase64, extractFirstImageUrl } from "../utils/image_fetch";
import { completeWithOptions } from "../llm/qwen_client";
import { getFastBrainModel } from "./fast_brain_model";
import {
  executeTool,
  type ToolExecutionContext,
} from "../brain/tool_registry";
import { routeMessageTools, toolRouterPrefilter } from "./tool_router";
import {
  retrievePromptMemory,
} from "../memory/memory_agent";
import { recordTextArchiveEntry } from "../cold_layer/text_archive_ledger";
import type { PromptMessage } from "../brain/prompt_builder";
import type { Emotion } from "../emotion/emotion_state";
import type { RemiSessionContext } from "./remi_session_context";
import { createLogger } from "../infra/logger";
import { classifyContextualIntent, registerImage, getRegistry, deriveStyleFromImageDescription } from "./contextual_intent";
import type { ShadowContextualIntent } from "./contextual_intent";

/**
 * Strip `![alt](url)` image markdown from a reply before storing it in
 * conversation history.  This prevents the LLM from seeing (and imitating)
 * the image format in subsequent turns — only the DirectCapability layer
 * should produce image tags.
 *
 * When `imageContext` is provided (e.g. subject of a generated image), the
 * markdown is replaced with a bracketed text description so the LLM knows
 * what was drawn without seeing the raw URL.
 */
function stripImageMarkdownForHistory(
  text: string,
  imageContext?: string,
): string {
  if (imageContext) {
    return text
      .replace(/!\[[^\]]*\]\([^)]+\)/g, `[我画了一张图：${imageContext}]`)
      .trim();
  }
  // Remove image markdown entirely from history. If we leave any trace
  // (URL or placeholder), the LLM either fabricates fake URLs by mimicking
  // the pattern, or echoes the placeholder instead of calling the
  // generate_image tool. With no trace, the LLM has no choice but to
  // call the tool when the user asks for an image.
  return text.replace(/!\[[^\]]*\]\([^)]+\)/g, "").replace(/\n{3,}/g, "\n\n").trim();
}
import { getConfig } from "../server/config";
import { getLatencyTracer } from "../infra/latency_tracer";
import {
  relationshipStateEnabled,
  savePersistentRelationshipState,
} from "../memory/relationship_state";
import { reviewReplyTone } from "../brain/tone_policy";
import { tryHandleDirectCapabilities } from "../brain/direct_capabilities";
import { resolveImageIntent } from "../capabilities/image_generation/resolve_image_intent";
import {
  getSessionLastImage,
  sessionHasImage,
} from "../capabilities/image_generation/image_generation_capability";
import { containsImageMarkdown } from "../voice/tts_helpers";
import {
  analyzeTurn,
  shouldAnalyzeTurn,
  type TurnAnalysisBundle,
} from "../brain/turn_interpreter";
import type { RepairState, WorkingMemoryV2 } from "./background_analysis_store";
import { resolvePersonaStyleDirective, hasPersistentKeyword } from "../persona/style_override";

function maxHistoryEntries(): number {
  return getConfig().REMI_MAX_HISTORY;
}
const logger = createLogger("context_orchestrator");

const COMPACT_PRIORITY_BLOCK_LIMIT = 3;
const ANALYSIS_PRIORITY_BLOCK_LIMIT = 6;
const GREETING_LIKE_TURN_PATTERN =
  /^(?:你好呀?|您好|哈喽|hello|hi|嗨|嘿|在吗|在不在|晚安(?:啦|呀)?|早安|早上好|晚上好)[!！?？~～。\s]*$/iu;

function isGreetingLikeTurn(userMessage: string): boolean {
  const trimmed = userMessage.trim();
  if (!trimmed || trimmed.length > 12) return false;
  return GREETING_LIKE_TURN_PATTERN.test(trimmed);
}

function resolvePromptMemoryMaxEntries(
  inputSource: "text" | "voice",
  _analysisCandidate: boolean,
  deliberationBudget?: "text_normal" | "text_deliberate",
): number {
  const cfg = getConfig();
  if (inputSource === "text" && deliberationBudget === "text_deliberate") {
    return cfg.REMI_TEXT_DELIBERATE_PROMPT_MEMORY_ENTRIES;
  }
  if (inputSource === "text") {
    return cfg.REMI_FAST_PATH_PROMPT_MEMORY_ENTRIES;
  }
  return cfg.REMI_ANALYSIS_PATH_PROMPT_MEMORY_ENTRIES;
}

function resolveHistoryTokenBudget(
  inputSource: "text" | "voice",
  analysisCandidate: boolean,
  deliberationBudget?: "text_normal" | "text_deliberate",
): number {
  const cfg = getConfig();
  if (inputSource === "text" && deliberationBudget === "text_deliberate") {
    return cfg.REMI_TEXT_DELIBERATE_HISTORY_TOKENS;
  }
  if (inputSource === "text" && !analysisCandidate) {
    return cfg.REMI_FAST_PATH_HISTORY_TOKENS;
  }
  return cfg.REMI_ANALYSIS_PATH_HISTORY_TOKENS;
}

function resolveTextDeliberationBudget(args: {
  inputSource: "text" | "voice";
  userMessage: string;
  analysis?: TurnAnalysisBundle | null;
  repairLevel?: string | null;
}): "text_normal" | "text_deliberate" | undefined {
  if (args.inputSource !== "text") return undefined;
  const trimmed = args.userMessage.trim();
  if (
    /认真想|想一下|捋一下|别急着答|你想想|认真回答/u.test(trimmed)
  ) {
    return "text_deliberate";
  }
  if (args.repairLevel === "trust_drop" || args.repairLevel === "rupture") {
    return "text_deliberate";
  }
  if (args.analysis?.used) {
    const sceneType = args.analysis.interpretation.sceneType;
    if (
      sceneType === "practical_judgment" ||
      sceneType === "relational_recall" ||
      sceneType === "high_risk_distress"
    ) {
      return "text_deliberate";
    }
  }
  if (
    /怎么办|要不要|值不值得|帮我算|还到啥时候|还到什么时候|该不该|怎么选|你还记得|你忘了|我们之前聊了什么|再想想/u.test(
      trimmed,
    )
  ) {
    return "text_deliberate";
  }
  return "text_normal";
}

function resolveTextDeliberateReasoningEffort(
  deliberationBudget?: "text_normal" | "text_deliberate",
): string | undefined {
  if (deliberationBudget !== "text_deliberate") return undefined;
  const configured = getConfig().REMI_TEXT_DELIBERATE_REASONING_EFFORT;
  if (!configured || configured === "provider_default" || configured === "default" || configured === "off") {
    return undefined;
  }
  return configured;
}

function buildArchiveTurnId(connId: string, traceId?: string): string {
  if (traceId?.trim()) return traceId.trim();
  return `text:${connId}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
}

function cloneWorkingMemory(
  value: WorkingMemoryV2 | null | undefined,
): WorkingMemoryV2 | null {
  if (!value) return null;
  return {
    activeThread: value.activeThread,
    currentNeed: value.currentNeed,
    currentConstraints: [...value.currentConstraints],
    openLoop: value.openLoop,
    doNotTouch: [...value.doNotTouch],
    sceneState: value.sceneState,
    lastUpdatedTurn: value.lastUpdatedTurn,
  };
}

function cloneRepairState(
  value: RepairState | null | undefined,
): RepairState | null {
  if (!value) return null;
  return {
    level: value.level,
    reason: value.reason,
    lastUpdatedTurn: value.lastUpdatedTurn,
  };
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
  /**
   * 世界情境（RW-P1-4）：用户在 RemiWorld 里和她对话时，描述她此刻所处的场景、
   * 正在做的事、用户在身边、世界状态（花/灯/天数）。作为 ground truth 进 prompt，
   * 让她"知道自己在世界里"，而不是凭空对话。
   */
  situationalContext?: string;
  /** 仅文本主链路启用语气 review，先不影响语音链路。 */
  inputSource?: "text" | "voice";
  /** 延迟追踪 trace id，用于把 memory/analysis 开销记到同一轮。 */
  traceId?: string;
  /** 用户附带的图片 (data:image/...;base64,...) — vision sidecar 会将其转为文字描述。 */
  imageBase64?: string;
  /**
   * 用户此刻的语音情绪/事件 (SenseVoice STT 提供)。
   * 例如 "happy"、"sad"、"angry/laughter"。
   * 让 Remi 接住用户的口气和情绪，而不是只看文字。
   */
  userVocalTone?: string;
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
  workingMemoryDraft?: WorkingMemoryV2 | null;
  signal?: AbortSignal;
  systemTriggered?: boolean;
  inputSource?: "text" | "voice";
  /** Capability that produced this reply, used to resolve image context. */
  capabilityId?: string;
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

  // When the reply was produced by image generation, preserve the image
  // subject in conversation history so the LLM knows what was drawn.
  const imageContext =
    input.capabilityId === "image_generation"
      ? getSessionLastImage(ctx.connId)?.subject
      : undefined;

  const historyUserContent = input.systemTriggered
    ? "［你主动开口陪对方聊天］"
    : userMessage;
  ctx.history.push({ role: "user", content: historyUserContent });
  ctx.history.push({ role: "assistant", content: stripImageMarkdownForHistory(reply, imageContext) });
  while (ctx.history.length > maxHistoryEntries()) {
    ctx.history.shift();
  }

  ctx.updateLiveState(emotion, userMessage, reply);
  ctx.slowBrain.recordUserTurnActivity(userMessage);
  ctx.slowBrain.applyWorkingMemoryDraft(input.workingMemoryDraft);
  ctx.slowBrain.setLastEmotion(emotion);
  if ((input.inputSource ?? "text") === "text") {
    recordTextArchiveEntry({
      kind: "text_archive",
      stage: "prompt",
      recordedAt: new Date().toISOString(),
      turnId: buildArchiveTurnId(ctx.connId),
      connId: ctx.connId,
      userId: ctx.userId,
      inputSource: input.inputSource ?? "text",
      systemTriggered: Boolean(input.systemTriggered),
      userMessage,
      memoryWrites: [],
      prompt: {
        memoryKeys: [],
        strategyHints: "",
        currentContext: "",
        slowBrainContext: "",
        deliberationBudget: "text_normal",
        reasoningEffort: "",
      },
      workingMemory: cloneWorkingMemory(input.workingMemoryDraft ?? null),
      repairState: cloneRepairState(ctx.slowBrain.getSnapshot().repairState ?? null),
    });
  }
  return "handled";
}

async function generateImageProgressIntro(
  ctx: RemiSessionContext,
  userMessage: string,
  signal?: AbortSignal,
): Promise<string> {
  const FALLBACK = "好，稍等一下～";
  try {
    const model = getFastBrainModel();
    if (!model) return FALLBACK;
    const recentHistory = ctx.history.slice(-6);
    const reply = await completeWithOptions(
      [
        {
          role: "system",
          content: [
            "/no_think",
            "你是 Remi，正在和对方聊天。",
            "对方说的话触发了你画图 / 展示图片的意图。",
            "在图片开始生成之前，用**一句话**自然地回应对方，让对方知道你在画了。",
            "要求：",
            "- 语气符合你和对方的关系（亲密/活泼/温柔），不要机械",
            '- 不要说"ComfyUI""生成中"等技术词',
            '- 根据上下文自然回应：如果对方说"看看你的照片"就说展示相关的话，如果说"帮我画个夕阳"就说画画相关的话',
            "- 只回一句话，不超过 20 字",
          ].join("\n"),
        },
        ...recentHistory,
        { role: "user", content: userMessage },
      ],
      {
        model,
        maxTokens: 60,
        temperature: 0.7,
        reasoningEffort: "none",
        signal,
      },
    );
    return reply.trim() || FALLBACK;
  } catch (err) {
    logger.warn("image progress intro LLM failed", {
      connId: ctx.connId,
      error: (err as Error).message,
    });
    return FALLBACK;
  }
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
  ctx.skipTtsThisTurn = false;

  // 处理「刚才说到哪了」查询
  const interruptedQueryRegex = /^(刚才|刚刚|刚刚|刚才)(说到哪|说什么|在说啥|讲到哪)/i;
  if (interruptedQueryRegex.test(userMessage.trim()) && ctx.lastInterruptedReply) {
    yield `我刚才说到：${ctx.lastInterruptedReply}`;
    return;
  }

  const inputSource = opts?.inputSource ?? "text";
  const archiveTurnId = buildArchiveTurnId(ctx.connId, opts?.traceId);

  // ── Vision sidecar: describe user-attached image ─────────────────────
  // When the user sends a photo, call the vision model to produce a text
  // description, then append it to the user message so the (text-only)
  // main LLM can "see" what the user shared.
  let effectiveUserMessage = userMessage;
  if (opts?.imageBase64 && visionEnabled()) {
    try {
      const description = await describeImage(opts.imageBase64, USER_IMAGE_PROMPT);
      if (description) {
        effectiveUserMessage = `${userMessage}\n[用户附带了一张图片：${description}]`;
        logger.info("vision sidecar described user image", { connId: ctx.connId, descriptionChars: description.length });
        // CIO-P2: 上传图入栈（shadow 用，不影响 legacy 路径）
        registerImage(ctx.connId, {
          id: crypto.randomUUID(),
          origin: "uploaded",
          descriptor: description,
          createdAt: Date.now(),
        });
      } else {
        effectiveUserMessage = `${userMessage}\n[用户发了一张图片]`;
      }
    } catch (err) {
      logger.warn("vision sidecar describe error", { connId: ctx.connId, error: (err as Error).message });
      effectiveUserMessage = `${userMessage}\n[用户发了一张图片]`;
    }
  } else if (opts?.imageBase64) {
    // Vision not available — still acknowledge the image
    effectiveUserMessage = `${userMessage}\n[用户发了一张图片，但我暂时看不到图片内容]`;
  }

  // ── CIO-P1/P3: 意图分类（shadow 或 wired）────────────────────────
  // P1/P2: fire-and-forget shadow，只写日志。
  // P3: wired 模式——分类结果驱动看图/生图消歧。
  // 注意：必须在 vision sidecar 之后跑，这样本轮上传图才在 registry 里。
  let cioIntent: ShadowContextualIntent | null = null;
  const cioWired = getConfig().REMI_CIO_WIRED_ENABLED;
  if (getConfig().REMI_CIO_SHADOW_ENABLED || cioWired) {
    try {
      cioIntent = classifyContextualIntent({
        userMessage,
        hasImage: !!opts?.imageBase64,
        hasSessionImage: sessionHasImage(ctx.connId),
        imageRegistry: getRegistry(ctx.connId),
      });
      if (cioIntent.meta.signals.length > 0) {
        logger.info("CIO shadow intent", {
          connId: ctx.connId,
          primary: cioIntent.primary,
          signals: cioIntent.meta.signals,
          wired: cioWired,
          latencyMs: cioIntent.meta.classifierLatencyMs,
        });
      }
    } catch {
      // 分类器不得影响主路径
    }
  }

  // ── CIO-P3 wired: 看图消歧——附了图且 vision 判定"想看图" → 跳过生图 ──
  const cioSuppressImageGen = cioWired && cioIntent?.vision?.wantsLook === true;

  const imageIntent = cioSuppressImageGen
    ? ({ kind: "none" } as const)
    : await resolveImageIntent({
    userMessage,
    recentHistory: ctx.history.slice(-4),
    hasPreviousImage: sessionHasImage(ctx.connId),
    lastImage: getSessionLastImage(ctx.connId),
    signal,
  });
  const config = getConfig();
  if (imageIntent.kind !== "none" && config.COMFYUI_ENABLED) {
    const intro = await generateImageProgressIntro(ctx, userMessage, signal);
    yield intro;
  }

  const directCapabilityResult = await tryHandleDirectCapabilities({
    userMessage,
    emotion,
    ctx,
    signal,
    systemTriggered: Boolean(opts?.systemTriggered),
    inputSource,
    imageIntent,
  });
  if (directCapabilityResult.handled) {
    const directWorkingMemoryDraft = ctx.slowBrain.buildWorkingMemoryDraft({
      userMessage,
      directCapabilityId: directCapabilityResult.capabilityId,
    });
    if (containsImageMarkdown(directCapabilityResult.reply)) {
      ctx.skipTtsThisTurn = true;
    }
    yield directCapabilityResult.reply;
    const result = finalizeDirectReply({
      ctx,
      userMessage,
      reply: directCapabilityResult.reply,
      emotion,
      workingMemoryDraft: directWorkingMemoryDraft,
      signal,
      systemTriggered: opts?.systemTriggered,
      inputSource,
      capabilityId: directCapabilityResult.capabilityId,
    });
    if (result === "handled" && !opts?.systemTriggered) {
      await persistContinuityCueState(ctx);
    }

    // Vision sidecar: asynchronously upgrade the history entry with a real
    // visual description from the vision model (fire-and-forget, non-blocking).
    if (
      result === "handled" &&
      directCapabilityResult.capabilityId === "image_generation" &&
      visionEnabled()
    ) {
      const imgUrl = extractFirstImageUrl(directCapabilityResult.reply);
      if (imgUrl) {
        fetchImageAsBase64(imgUrl)
          .then((base64) => (base64 ? describeImage(base64) : ""))
          .then((description) => {
            if (!description) return;
            // Replace the last assistant history entry with a richer description.
            const lastEntry = ctx.history[ctx.history.length - 1];
            if (lastEntry?.role === "assistant") {
              lastEntry.content = stripImageMarkdownForHistory(
                directCapabilityResult.reply,
                description,
              );
              logger.info("vision sidecar upgraded image history", {
                connId: ctx.connId,
                descriptionChars: description.length,
              });
            }
          })
          .catch((err) =>
            logger.warn("vision sidecar image describe failed", {
              connId: ctx.connId,
              error: (err as Error).message,
            }),
          );
      }
    }

    return;
  }

  // ── Semi-agent tool router (opt-in via REMI_TOOL_USE_ENABLED) ─────────
  // The regex fast-path above handles explicit capability requests at zero
  // latency. For the ambiguous phrasings it misses ("不穿衣服呢？" → image),
  // a clean, minimal, reasoning-off LLM router decides whether to dispatch a
  // tool. It runs ONLY when a broad keyword prefilter fires, so pure chat never
  // pays the extra call. The main reply brain is never given tools — it stays
  // fully in-character (see tool_router.ts).
  if (
    !opts?.systemTriggered &&
    config.REMI_TOOL_USE_ENABLED &&
    toolRouterPrefilter(userMessage)
  ) {
    const routedToolCalls = await routeMessageTools({ userMessage, ctx, signal });
    if (signal?.aborted) return;
    if (routedToolCalls.length > 0) {
      const toolExecCtx: ToolExecutionContext = { ctx, emotion, userMessage, signal };
      let directReplyFromTool: string | undefined;
      let skipTtsFromTool = false;
      let capabilityIdFromTool: string | undefined;
      const toolOutputs: string[] = [];

      // Image generation is slow (ComfyUI). Reaching here means the dedicated
      // image gate already classified this turn as non-image (no intro shown),
      // so a quick in-character intro before blocking is safe and non-duplicate.
      if (
        routedToolCalls.some((tc) => tc.name === "generate_image") &&
        config.COMFYUI_ENABLED
      ) {
        const intro = await generateImageProgressIntro(ctx, userMessage, signal);
        if (signal?.aborted) return;
        yield intro;
      }

      for (const tc of routedToolCalls) {
        let args: Record<string, unknown> = {};
        try {
          args = tc.arguments ? JSON.parse(tc.arguments) : {};
        } catch {
          logger.warn("failed to parse routed tool arguments", {
            name: tc.name,
            raw: tc.arguments,
          });
        }
        const result = await executeTool(tc.name, args, toolExecCtx);
        toolOutputs.push(result.output);
        if (result.directReply) directReplyFromTool = result.directReply;
        if (result.skipTts) skipTtsFromTool = true;
        if (result.capabilityId) capabilityIdFromTool = result.capabilityId;
      }
      if (skipTtsFromTool) ctx.skipTtsThisTurn = true;

      // Direct reply (image / video / mode toggle): yield + finalize like the
      // DirectCapability path, then we're done for this turn.
      if (directReplyFromTool) {
        const directWorkingMemoryDraft = ctx.slowBrain.buildWorkingMemoryDraft({
          userMessage,
          directCapabilityId: capabilityIdFromTool,
        });
        yield directReplyFromTool;
        const finalizeResult = finalizeDirectReply({
          ctx,
          userMessage,
          reply: directReplyFromTool,
          emotion,
          workingMemoryDraft: directWorkingMemoryDraft,
          signal,
          systemTriggered: opts?.systemTriggered,
          inputSource,
          capabilityId: capabilityIdFromTool,
        });
        if (finalizeResult === "handled" && !opts?.systemTriggered) {
          await persistContinuityCueState(ctx);
        }
        // Vision sidecar: upgrade the image history entry with a real visual
        // description (fire-and-forget) — same as the DirectCapability path.
        if (
          finalizeResult === "handled" &&
          capabilityIdFromTool === "image_generation" &&
          visionEnabled()
        ) {
          const imgUrl = extractFirstImageUrl(directReplyFromTool);
          if (imgUrl) {
            fetchImageAsBase64(imgUrl)
              .then((base64) => (base64 ? describeImage(base64) : ""))
              .then((description) => {
                if (!description) return;
                const lastEntry = ctx.history[ctx.history.length - 1];
                if (lastEntry?.role === "assistant") {
                  lastEntry.content = stripImageMarkdownForHistory(
                    directReplyFromTool!,
                    description,
                  );
                }
              })
              .catch(() => {});
          }
        }
        return;
      }

      // No direct reply (e.g. get_current_time): hand the tool output to the
      // main in-character brain as context and fall through to a normal reply,
      // so the answer keeps Remi's voice instead of a bare tool dump.
      if (toolOutputs.length > 0) {
        effectiveUserMessage = `${effectiveUserMessage}\n\n[供你参考的工具结果：${toolOutputs.join("；")}]`;
      }
    }
  }

  const fastMemoryWrites: { key: string; value: string }[] = [];
  const pregeneratedReply = opts?.pregeneratedReply?.trim();
  const precomputedAnalysis = opts?.structuredAnalysis?.used ? opts.structuredAnalysis : null;
  const carryForwardHint = opts?.carryForwardHint?.trim();
  const situationalContext = opts?.situationalContext?.trim();
  const userVocalTone = opts?.userVocalTone?.trim();
  const slowBrainSnapshot = ctx.slowBrain.getSnapshot();
  const analysisInput = {
    userMessage,
    history: ctx.history,
    slowBrainSnapshot,
    inputSource,
    connId: ctx.connId,
    signal,
  } as const;
  const analysisCandidate =
    Boolean(precomputedAnalysis) ||
    (!opts?.systemTriggered && shouldAnalyzeTurn(analysisInput));
  const preliminaryDeliberationBudget = resolveTextDeliberationBudget({
    inputSource,
    userMessage,
    analysis: precomputedAnalysis,
    repairLevel: slowBrainSnapshot.repairState?.level ?? null,
  });
  const preliminaryPromptMemoryMaxEntries = resolvePromptMemoryMaxEntries(
    inputSource,
    analysisCandidate,
    preliminaryDeliberationBudget,
  );
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
          maxEntries: preliminaryPromptMemoryMaxEntries,
          diagnostics: (meta) => {
            if (latencyTracer && traceId) {
              latencyTracer.annotateTrace(traceId, {
                episodeRecallSource: meta.episodeRecallSource,
                episodeRecallIds: meta.episodeRecallIds,
                episodeReferenceApplied: meta.episodeReferenceApplied,
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
  const deliberationBudget = resolveTextDeliberationBudget({
    inputSource,
    userMessage,
    analysis,
    repairLevel: slowBrainSnapshot.repairState?.level ?? null,
  });
  const promptMemoryMaxEntries = resolvePromptMemoryMaxEntries(
    inputSource,
    analysisCandidate,
    deliberationBudget,
  );
  const historyTokenBudget = resolveHistoryTokenBudget(
    inputSource,
    analysisCandidate,
    deliberationBudget,
  );
  const reasoningEffortOverride = resolveTextDeliberateReasoningEffort(deliberationBudget);
  if (
    !pregeneratedReply &&
    deliberationBudget === "text_deliberate" &&
    preliminaryPromptMemoryMaxEntries < promptMemoryMaxEntries
  ) {
    memory = await retrievePromptMemory(ctx.memory, {
      userId: ctx.userId,
      userMessage,
      slowBrainSnapshot,
      maxEntries: promptMemoryMaxEntries,
    });
  }
  // ── CIO Wired: performance 轴接线（flag 门控）─────────────────────
  // 发图+"像她一点" → 从图片描述推导说话风格 → 写 styleOverride
  if (cioWired && cioIntent?.performance?.op === "enter" && cioIntent.performance.wantsImageStyle) {
    const reg = getRegistry(ctx.connId);
    const lastUpload = [...reg].reverse().find((e) => e.origin === "uploaded");
    if (lastUpload?.descriptor) {
      const derived = await deriveStyleFromImageDescription(lastUpload.descriptor, signal);
      if (derived) {
        const persistent = hasPersistentKeyword(userMessage);
        ctx.persona.liveState.styleOverride = {
          humorBoost: false,
          teasingMode: "off",
          assistantySuppression: true,
          familiarityBoost: false,
          romanceBoost: false,
          roleplayStyle: derived,
          remainingTurns: 6,
          persistent,
          sourceText: userMessage,
        };
        logger.info("CIO wired: image→style override set", {
          connId: ctx.connId,
          derived,
          persistent,
        });
      }
    }
  }

  const resolvedStyleDirective = opts?.systemTriggered
    ? null
    : resolvePersonaStyleDirective({
        styleIntent: analysis?.used ? analysis.interpretation.styleIntent : null,
        userMessage,
        currentOverride: ctx.persona.liveState.styleOverride,
      });
  if (resolvedStyleDirective?.kind === "clear") {
    ctx.persona.liveState.styleOverride = null;
    ctx.slowBrain.clearResponseStyleNotes();
  } else if (resolvedStyleDirective?.kind === "set") {
    ctx.persona.liveState.styleOverride = resolvedStyleDirective.override;
    if (resolvedStyleDirective.responseStyleNote) {
      ctx.slowBrain.addResponseStyleNote(resolvedStyleDirective.responseStyleNote);
    }
  }
  const guidance = ctx.slowBrain.buildConversationGuidance(
    userMessage,
    analysis?.used ? analysis : null,
  );
  const slowBrainContext = ctx.slowBrain.synthesizeContext({
    suppressResponseStyleNotes: Boolean(ctx.persona.liveState.styleOverride),
  });
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
  const greetingLikeTurn = inputSource === "text" && isGreetingLikeTurn(userMessage);
  const compactPriorityContext =
    inputSource === "text" && !analysisCandidate && !greetingLikeTurn
      ? buildCompactPriorityContext(guidance.hints, slowBrainContext)
      : undefined;
  const historyForPrompt = trimHistoryToTokenBudget([...ctx.history], historyTokenBudget);
  const strategyHintsForPrompt = [
    // 世界情境放最前，作为本轮对话的场景地基（RW-P1-4）
    situationalContext ? `【你此刻的处境】\n${situationalContext}` : undefined,
    // 用户语音情绪——让她能接住对方的口气（SenseVoice STT 提供）
    userVocalTone
      ? `【对方此刻的语气】\n对方说话时的情绪：${userVocalTone}。请自然地回应这种语气，不要直接提及"我检测到你的情绪是…"。`
      : undefined,
    analysisPriorityContext ?? compactPriorityContext ?? guidance.hints,
    carryForwardHint,
  ]
    .filter((part): part is string => Boolean(part?.trim()))
    .join("\n\n");
  const slowBrainContextForPrompt =
    greetingLikeTurn
      ? undefined
      : (analysisPriorityContext && inputSource === "text") ||
        (compactPriorityContext && inputSource === "text" && !analysisCandidate)
        ? undefined
      : slowBrainContext;

  if (inputSource === "text") {
    recordTextArchiveEntry({
      kind: "text_archive",
      stage: "prompt",
      recordedAt: new Date().toISOString(),
      turnId: archiveTurnId,
      connId: ctx.connId,
      userId: ctx.userId,
      inputSource,
      systemTriggered: Boolean(opts?.systemTriggered),
      userMessage,
      memoryWrites: fastMemoryWrites.map((entry) => ({
        ...entry,
        source: "fast_extract" as const,
      })),
      prompt: {
        memoryKeys: memory.map((entry) => entry.key),
        strategyHints: strategyHintsForPrompt,
        currentContext: currentContext ?? "",
        slowBrainContext: slowBrainContextForPrompt ?? "",
        deliberationBudget: deliberationBudget ?? "",
        reasoningEffort: reasoningEffortOverride ?? "",
      },
      workingMemory: cloneWorkingMemory(
        workingMemoryDraft ?? slowBrainSnapshot.workingMemory ?? null,
      ),
      repairState: cloneRepairState(
        ctx.slowBrain.getSnapshot().repairState ?? null,
      ),
    });
  }

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

    // M3-P2: Tier4 时序事实召回（带硬超时降级）。热路径唯一动态项，
    // 进 prompt 动态尾部（缓存断点之后），不污染可缓存前缀。
    const timelineFacts = await recallTimelineFacts(ctx);

    // Capability dispatch is owned by the upstream tool router; the reply brain
    // is intentionally NOT given tools, so it stays fully in-character and never
    // fabricates outputs (e.g. fake image URLs) under the heavy persona prompt.
    for await (const token of fastBrainStream({
      userMessage: effectiveUserMessage,
      emotion,
      memory,
      history: historyForPrompt,
      currentContext,
      slowBrainContext: slowBrainContextForPrompt,
      strategyHints: strategyHintsForPrompt,
      deliberationBudget,
      reasoningEffortOverride,
      signal,
      onFirstLlmChunk,
      onFirstLlmReasoningChunk,
      onFirstLlmVisibleContent,
      persona: ctx.persona,
      connId: ctx.connId,
      timeContext: ctx.buildTimeContextBlock() ?? undefined,
      coreMemoryBlock: ctx.slowBrain?.coreMemory?.render() || undefined,
      timelineFacts,
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
    : effectiveUserMessage;
  const shouldPersistAssistantReply = !isFallbackAssistantReply(fullReply);
  // Update history
  ctx.history.push({ role: "user", content: historyUserContent });
  if (shouldPersistAssistantReply) {
    ctx.history.push({ role: "assistant", content: stripImageMarkdownForHistory(fullReply) });
  }
  while (ctx.history.length > maxHistoryEntries()) {
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
      connId: ctx.connId,
      turnId: archiveTurnId,
      userId: ctx.userId,
      userMessage,
      assistantReply: fullReply,
      inputSource,
      history: [...ctx.history],
      slowBrain: ctx.slowBrain,
      memoryRepo: ctx.memory,
      relationshipRepo:
        ctx.persistentRelationshipRepo ??
        ctx.memory.getPersistentBackend() ??
        ctx.memory,
      temporalFactsRepo: ctx.temporalFactsRepo ?? undefined,
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
