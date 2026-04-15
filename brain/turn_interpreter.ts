import type { PromptMessage } from "./prompt_builder";
import { buildToneContract, detectAnswerNowSignal, detectDecisionSeekingSignal } from "./tone_policy";
import { completeWithOptions, type ChatMessage } from "../llm/qwen_client";
import { createLogger } from "../infra/logger";
import type { SlowBrainSnapshot } from "../brains/slow_brain_store";

const logger = createLogger("turn_interpreter");

export type TurnUserAct =
  | "direct_question"
  | "decision_seek"
  | "context_update"
  | "emotional_share"
  | "scene_continue"
  | "topic_veto"
  | "answer_now"
  | "small_talk"
  | "unclear";

export type AnswerObligation = "must_answer" | "answer_then_followup" | "followup_ok";
export type ResponseMode =
  | "answer_first"
  | "attune_then_answer"
  | "stay_in_scene"
  | "gentle_followup"
  | "quiet_presence";
export type FeltNeed = "comfort" | "clarity" | "validation" | "practical_help" | "space";
export type RelationalPosture = "warm" | "steady" | "playful" | "serious";
export type TopicUpdateKind = "new_topic" | "continuation" | "constraint_update" | "none";
export type FollowupPermission = "none" | "one_light_question";
export type StructuredAnalysisSource = "llm_structured" | "heuristic_fallback";
export type StructuredInterpreterMode = "off" | "shadow" | "on";

export interface TurnInterpretation {
  userAct: TurnUserAct;
  answerObligation: AnswerObligation;
  responseMode: ResponseMode;
  emotionalState: {
    valence: "negative" | "mixed" | "neutral" | "positive";
    intensity: "low" | "medium" | "high";
    feltNeeds: FeltNeed[];
  };
  relationalPosture: RelationalPosture;
  topicUpdate?: {
    kind: TopicUpdateKind;
    label?: string;
  };
  sceneState?: "already_in_scene" | "not_in_scene";
  boundaryState?: "veto_topic" | "none";
  followupPermission: FollowupPermission;
  confidence: number;
}

export interface ResponsePolicy {
  openingMove: "direct_answer" | "gentle_attunement" | "scene_ack" | "quiet_presence";
  directness: "low" | "medium" | "high";
  warmth: "low" | "medium" | "high";
  questionBudget: 0 | 1;
  shouldMirrorEmotion: boolean;
  shouldGiveJudgment: boolean;
  shouldUpdateDecisionContext: boolean;
  bans: Array<
    | "no_assistantese"
    | "no_host_mode"
    | "no_repeat_user_question"
    | "no_reopen_vetoed_topic"
    | "no_scene_reset"
  >;
}

export interface TurnAnalysisBundle {
  interpretation: TurnInterpretation;
  policy: ResponsePolicy;
  source: StructuredAnalysisSource;
  latencyMs: number;
  timedOut: boolean;
  mode: StructuredInterpreterMode;
  used: boolean;
}

export interface AnalyzeTurnInput {
  userMessage: string;
  history: PromptMessage[];
  slowBrainSnapshot: SlowBrainSnapshot;
  inputSource: "text" | "voice";
  signal?: AbortSignal;
}

interface PartialTurnInterpretation {
  userAct?: string;
  answerObligation?: string;
  responseMode?: string;
  emotionalState?: {
    valence?: string;
    intensity?: string;
    feltNeeds?: string[];
  };
  relationalPosture?: string;
  topicUpdate?: {
    kind?: string;
    label?: string;
  };
  sceneState?: string;
  boundaryState?: string;
  followupPermission?: string;
  confidence?: number;
}

const INTERPRETER_PROMPT = `你是一个对话回合解释器，不是聊天角色本身。
你的任务：判断这句用户输入此刻真正要什么，以及下一句回复应该怎么开口。

严格返回合法 JSON，不要 markdown，不要解释：
{
  "userAct": "direct_question | decision_seek | context_update | emotional_share | scene_continue | topic_veto | answer_now | small_talk | unclear",
  "answerObligation": "must_answer | answer_then_followup | followup_ok",
  "responseMode": "answer_first | attune_then_answer | stay_in_scene | gentle_followup | quiet_presence",
  "emotionalState": {
    "valence": "negative | mixed | neutral | positive",
    "intensity": "low | medium | high",
    "feltNeeds": ["comfort | clarity | validation | practical_help | space"]
  },
  "relationalPosture": "warm | steady | playful | serious",
  "topicUpdate": {
    "kind": "new_topic | continuation | constraint_update | none",
    "label": "可选，短词"
  },
  "sceneState": "already_in_scene | not_in_scene",
  "boundaryState": "veto_topic | none",
  "followupPermission": "none | one_light_question",
  "confidence": 0.0
}

判定规则：
- 用户在要判断、建议、明确意见时，userAct=decision_seek，answerObligation 至少是 must_answer。
- 用户在催你别老问、要求你直接说时，userAct=answer_now，必须直接回答。
- 用户补充现实约束、背景、资源、风险、机会、时间线，并且这些信息会改变判断时，userAct=context_update，topicUpdate.kind=constraint_update。
- 用户已经把你们放进同一个画面或动作里时，userAct=scene_continue，responseMode=stay_in_scene。
- 用户明确说不要聊某话题时，userAct=topic_veto。
- 用户只是分享情绪或近况，没有明确问问题时，优先 emotional_share。
- 不要把“我是不是该辞职”“换个老板吗”“我还欠花呗两万五”误判成 small_talk。
- feltNeeds 只保留 1-3 个最关键的。
- followupPermission 要保守：只在真的适合轻问一句时给 one_light_question。`;

function configured(): boolean {
  return Boolean(process.env.key && process.env.base_url && process.env.model);
}

export function structuredInterpreterMode(): StructuredInterpreterMode {
  const raw = (process.env.REMI_STRUCTURED_TURN_INTERPRETER ?? "on").trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return "off";
  if (raw === "shadow") return "shadow";
  return "on";
}

function interpreterTimeoutMs(): number {
  const raw = Number(process.env.REMI_TURN_INTERPRETER_TIMEOUT_MS ?? 180);
  return Number.isFinite(raw) && raw >= 80 ? Math.floor(raw) : 180;
}

function isQuestionLike(text: string): boolean {
  return /[?？]|怎么|为什么|什么意思|可不可以|能不能|你怎么看|你觉得|要不要|是不是|该不该|需不需要/u.test(text);
}

function isSceneImmersionLike(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || isQuestionLike(trimmed)) return false;
  const actionLike = /(牵手|抱着|抱住|搂着|搂住|靠在|依偎|贴着|亲吻|亲亲|并肩|散步|慢慢走|看海|看雨|窝在|坐在你旁边|跟rem|和rem|跟你|和你)/u;
  const sceneLike = /(公园|海边|湖边|江边|长椅|路灯|天台|沙发|房间|床上|咖啡店|雨里|夜里|晚风|月色)/u;
  return actionLike.test(trimmed) && (sceneLike.test(trimmed) || /[，,]/u.test(trimmed));
}

function detectTopicVeto(text: string): boolean {
  return /(先不说这个|先不聊这个|先别聊这个|不说这个|不聊这个|别聊这个|不要聊这个|换个话题|别说这个|不聊这个话题|不要聊这个话题|不说项目了|别聊工作)/u.test(
    text,
  );
}

function detectContinuationLike(text: string): boolean {
  return /继续|接着|刚才|还是那个|回到刚才|上次那个|又想到|后来呢|然后呢/u.test(text);
}

function detectContextUpdateLike(text: string, history: PromptMessage[]): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const recent = history
    .slice(-4)
    .map((entry) => entry.content)
    .join(" ");
  const numericOrConstraint =
    /\d|一万|两万|三万|半年|一年|两年|offer|面试|存款|积蓄|花呗|负债|房租|贷款|还欠|手里|攒了|机会|下家|睡不好|失眠|身体|住院/u;
  if (!numericOrConstraint.test(trimmed)) return false;
  return /辞职|换工作|老板|去留|怎么办|选择|判断|建议|该不该|要不要|是不是该/u.test(recent);
}

function detectEmotionalShare(text: string): boolean {
  return /难过|伤心|焦虑|委屈|烦|累|堵|崩溃|失眠|睡不好|想哭|低落|难受/u.test(text);
}

function hasPositiveCue(text: string): boolean {
  return /开心|高兴|喜欢|太好了|爱你|谢谢|棒|好耶|哈哈/u.test(text);
}

function normalizeNeed(value: string): FeltNeed | null {
  if (["comfort", "clarity", "validation", "practical_help", "space"].includes(value)) {
    return value as FeltNeed;
  }
  return null;
}

function clampConfidence(raw: number | undefined, fallback: number): number {
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(0, Math.min(1, raw as number));
}

function extractJsonObject(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return trimmed.slice(start, end + 1);
}

function parseInterpretation(raw: string): PartialTurnInterpretation | null {
  const json = extractJsonObject(raw);
  if (!json) return null;
  try {
    return JSON.parse(json) as PartialTurnInterpretation;
  } catch {
    return null;
  }
}

function fallbackInterpretation(input: AnalyzeTurnInput): TurnInterpretation {
  const trimmed = input.userMessage.trim();
  const negative = detectEmotionalShare(trimmed);
  const scene = isSceneImmersionLike(trimmed);
  const answerNow = detectAnswerNowSignal(trimmed);
  const decision = detectDecisionSeekingSignal(trimmed);
  const veto = detectTopicVeto(trimmed);
  const contextUpdate = detectContextUpdateLike(trimmed, input.history);
  const question = isQuestionLike(trimmed);
  const continuation = detectContinuationLike(trimmed);

  let userAct: TurnUserAct = "small_talk";
  let answerObligation: AnswerObligation = "followup_ok";
  let responseMode: ResponseMode = negative ? "attune_then_answer" : "gentle_followup";
  let followupPermission: FollowupPermission = trimmed.length <= 12 ? "one_light_question" : "none";
  let posture: RelationalPosture = negative ? "warm" : "steady";
  let topicUpdate: { kind: TopicUpdateKind; label?: string } = {
    kind: continuation ? "continuation" : "none",
  };

  if (answerNow) {
    userAct = "answer_now";
    answerObligation = "must_answer";
    responseMode = "answer_first";
    followupPermission = "none";
    posture = "serious";
  } else if (decision) {
    userAct = "decision_seek";
    answerObligation = "must_answer";
    responseMode = negative ? "attune_then_answer" : "answer_first";
    followupPermission = "none";
    posture = "serious";
  } else if (contextUpdate) {
    userAct = "context_update";
    answerObligation = "answer_then_followup";
    responseMode = negative ? "attune_then_answer" : "answer_first";
    followupPermission = "none";
    posture = "serious";
    topicUpdate = { kind: "constraint_update" };
  } else if (scene) {
    userAct = "scene_continue";
    responseMode = "stay_in_scene";
    followupPermission = "none";
    posture = "warm";
  } else if (veto) {
    userAct = "topic_veto";
    responseMode = "quiet_presence";
    followupPermission = "none";
    posture = "steady";
  } else if (question) {
    userAct = "direct_question";
    answerObligation = "answer_then_followup";
    responseMode = negative ? "attune_then_answer" : "answer_first";
    followupPermission = trimmed.length <= 20 ? "one_light_question" : "none";
  } else if (negative) {
    userAct = "emotional_share";
    answerObligation = "answer_then_followup";
    responseMode = "attune_then_answer";
    followupPermission = trimmed.length <= 16 ? "one_light_question" : "none";
    posture = "warm";
  } else if (!trimmed || trimmed.length <= 4) {
    userAct = "small_talk";
    responseMode = continuation ? "gentle_followup" : "quiet_presence";
    followupPermission = continuation ? "one_light_question" : "none";
  }

  return {
    userAct,
    answerObligation,
    responseMode,
    emotionalState: {
      valence: negative ? "negative" : hasPositiveCue(trimmed) ? "positive" : "neutral",
      intensity: trimmed.length > 24 || /很|特别|太|一直/u.test(trimmed) ? "medium" : "low",
      feltNeeds: userAct === "decision_seek" || userAct === "context_update"
        ? ["clarity", "practical_help"]
        : negative
          ? ["validation", "comfort"]
          : ["clarity"],
    },
    relationalPosture: posture,
    topicUpdate,
    sceneState: scene ? "already_in_scene" : "not_in_scene",
    boundaryState: veto ? "veto_topic" : "none",
    followupPermission,
    confidence: answerNow || decision || scene || veto || contextUpdate ? 0.72 : 0.46,
  };
}

function normalizeInterpretation(
  raw: PartialTurnInterpretation | null,
  fallback: TurnInterpretation,
): TurnInterpretation {
  if (!raw) return fallback;

  const userAct = [
    "direct_question",
    "decision_seek",
    "context_update",
    "emotional_share",
    "scene_continue",
    "topic_veto",
    "answer_now",
    "small_talk",
    "unclear",
  ].includes(raw.userAct ?? "")
    ? (raw.userAct as TurnUserAct)
    : fallback.userAct;

  const answerObligation = ["must_answer", "answer_then_followup", "followup_ok"].includes(
    raw.answerObligation ?? "",
  )
    ? (raw.answerObligation as AnswerObligation)
    : fallback.answerObligation;

  const responseMode = [
    "answer_first",
    "attune_then_answer",
    "stay_in_scene",
    "gentle_followup",
    "quiet_presence",
  ].includes(raw.responseMode ?? "")
    ? (raw.responseMode as ResponseMode)
    : fallback.responseMode;

  const valence = ["negative", "mixed", "neutral", "positive"].includes(
    raw.emotionalState?.valence ?? "",
  )
    ? (raw.emotionalState?.valence as TurnInterpretation["emotionalState"]["valence"])
    : fallback.emotionalState.valence;

  const intensity = ["low", "medium", "high"].includes(raw.emotionalState?.intensity ?? "")
    ? (raw.emotionalState?.intensity as TurnInterpretation["emotionalState"]["intensity"])
    : fallback.emotionalState.intensity;

  const feltNeeds = Array.isArray(raw.emotionalState?.feltNeeds)
    ? raw.emotionalState?.feltNeeds.map(normalizeNeed).filter((value): value is FeltNeed => Boolean(value)).slice(0, 3)
    : [];

  const relationalPosture = ["warm", "steady", "playful", "serious"].includes(
    raw.relationalPosture ?? "",
  )
    ? (raw.relationalPosture as RelationalPosture)
    : fallback.relationalPosture;

  const topicKind = ["new_topic", "continuation", "constraint_update", "none"].includes(
    raw.topicUpdate?.kind ?? "",
  )
    ? (raw.topicUpdate?.kind as TopicUpdateKind)
    : fallback.topicUpdate?.kind ?? "none";

  const sceneState = ["already_in_scene", "not_in_scene"].includes(raw.sceneState ?? "")
    ? (raw.sceneState as TurnInterpretation["sceneState"])
    : fallback.sceneState;

  const boundaryState = ["veto_topic", "none"].includes(raw.boundaryState ?? "")
    ? (raw.boundaryState as TurnInterpretation["boundaryState"])
    : fallback.boundaryState;

  const followupPermission = ["none", "one_light_question"].includes(raw.followupPermission ?? "")
    ? (raw.followupPermission as FollowupPermission)
    : fallback.followupPermission;

  return {
    userAct,
    answerObligation,
    responseMode,
    emotionalState: {
      valence,
      intensity,
      feltNeeds: feltNeeds.length > 0 ? feltNeeds : fallback.emotionalState.feltNeeds,
    },
    relationalPosture,
    topicUpdate: {
      kind: topicKind,
      label: raw.topicUpdate?.label?.trim() || fallback.topicUpdate?.label,
    },
    sceneState,
    boundaryState,
    followupPermission,
    confidence: clampConfidence(raw.confidence, fallback.confidence),
  };
}

function composeResponsePolicy(
  interpretation: TurnInterpretation,
  slowBrainSnapshot: SlowBrainSnapshot,
): ResponsePolicy {
  const warmRelationship =
    slowBrainSnapshot.relationship.familiarity >= 0.45 ||
    slowBrainSnapshot.relationship.emotionalBond >= 0.4;
  const negative = interpretation.emotionalState.valence === "negative" || interpretation.emotionalState.valence === "mixed";
  const bans: ResponsePolicy["bans"] = ["no_assistantese", "no_host_mode"];

  if (interpretation.answerObligation !== "followup_ok") {
    bans.push("no_repeat_user_question");
  }
  if (interpretation.boundaryState === "veto_topic") {
    bans.push("no_reopen_vetoed_topic");
  }
  if (interpretation.sceneState === "already_in_scene") {
    bans.push("no_scene_reset");
  }

  const shouldGiveJudgment =
    interpretation.userAct === "decision_seek" || interpretation.userAct === "answer_now";
  const shouldUpdateDecisionContext =
    interpretation.userAct === "context_update" || interpretation.topicUpdate?.kind === "constraint_update";

  let openingMove: ResponsePolicy["openingMove"] = "gentle_attunement";
  if (interpretation.responseMode === "stay_in_scene") {
    openingMove = "scene_ack";
  } else if (interpretation.responseMode === "quiet_presence") {
    openingMove = "quiet_presence";
  } else if (
    interpretation.responseMode === "answer_first" ||
    shouldGiveJudgment ||
    shouldUpdateDecisionContext ||
    interpretation.userAct === "direct_question"
  ) {
    openingMove = "direct_answer";
  }

  const directness: ResponsePolicy["directness"] =
    shouldGiveJudgment || shouldUpdateDecisionContext || interpretation.userAct === "answer_now"
      ? "high"
      : interpretation.userAct === "direct_question"
        ? "medium"
        : "low";

  const warmth: ResponsePolicy["warmth"] =
    negative || warmRelationship || interpretation.relationalPosture === "warm"
      ? "high"
      : interpretation.relationalPosture === "serious"
        ? "medium"
        : "medium";

  const questionBudget: 0 | 1 =
    interpretation.followupPermission === "one_light_question" &&
    interpretation.userAct !== "answer_now" &&
    !shouldUpdateDecisionContext &&
    !shouldGiveJudgment &&
    interpretation.sceneState !== "already_in_scene"
      ? 1
      : 0;

  return {
    openingMove,
    directness,
    warmth,
    questionBudget,
    shouldMirrorEmotion: negative || interpretation.userAct === "emotional_share",
    shouldGiveJudgment,
    shouldUpdateDecisionContext,
    bans,
  };
}

function recentHistorySummary(history: PromptMessage[]): string {
  return history
    .slice(-4)
    .map((entry) => `${entry.role === "user" ? "用户" : "Remi"}：${entry.content}`)
    .join("\n");
}

function snapshotSummary(snapshot: SlowBrainSnapshot): string {
  const activeTopics = snapshot.sharedMoments
    .slice(0, 2)
    .map((entry) => entry.topic || entry.summary)
    .filter(Boolean)
    .join("、");
  return [
    `关系阶段：熟悉度 ${snapshot.relationship.familiarity.toFixed(2)}，情感连接 ${snapshot.relationship.emotionalBond.toFixed(2)}。`,
    snapshot.conversationSummary ? `最近主线：${snapshot.conversationSummary}` : "",
    activeTopics ? `共享记忆线索：${activeTopics}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function runInterpreterLlm(input: AnalyzeTurnInput): Promise<PartialTurnInterpretation | null> {
  const recent = recentHistorySummary(input.history);
  const context = snapshotSummary(input.slowBrainSnapshot);
  const messages: ChatMessage[] = [
    { role: "system", content: INTERPRETER_PROMPT },
    {
      role: "user",
      content:
        `关系与上下文：\n${context || "无"}\n\n最近对话：\n${recent || "无"}\n\n当前用户输入：\n${input.userMessage}`,
    },
  ];

  const timeoutMs = interpreterTimeoutMs();
  const timeoutController = new AbortController();
  const parentAbort = () => timeoutController.abort();
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timeoutController.abort();
      const error = new Error(`structured turn interpreter timed out after ${timeoutMs}ms`);
      error.name = "AbortError";
      reject(error);
    }, timeoutMs);
  });
  if (input.signal) {
    if (input.signal.aborted) {
      timeoutController.abort();
    } else {
      input.signal.addEventListener("abort", parentAbort, { once: true });
    }
  }

  try {
    const raw = await Promise.race([
      completeWithOptions(messages, {
        maxTokens: 220,
        temperature: 0.1,
        model: process.env.REMI_TURN_INTERPRETER_MODEL,
        signal: timeoutController.signal,
      }),
      timeoutPromise,
    ]);
    return parseInterpretation(raw);
  } finally {
    if (timer) clearTimeout(timer);
    if (input.signal) {
      input.signal.removeEventListener("abort", parentAbort);
    }
  }
}

export function shouldAnalyzeTurn(input: AnalyzeTurnInput): boolean {
  const text = input.userMessage.trim();
  if (!text) return false;

  const decisionLike = detectDecisionSeekingSignal(text) || detectAnswerNowSignal(text);
  const boundaryLike = detectTopicVeto(text);
  const sceneLike = isSceneImmersionLike(text);
  const contextUpdateLike = detectContextUpdateLike(text, input.history);
  const shortQuestionLike = isQuestionLike(text) && text.length <= 32;
  const shortEmotionalLike = detectEmotionalShare(text) && text.length <= 24;
  const shortContinuationLike = detectContinuationLike(text) && text.length <= 16;

  if (input.inputSource === "text") {
    return (
      decisionLike ||
      boundaryLike ||
      sceneLike ||
      contextUpdateLike ||
      shortQuestionLike ||
      shortEmotionalLike ||
      shortContinuationLike
    );
  }

  return (
    decisionLike ||
    boundaryLike ||
    sceneLike ||
    shortQuestionLike ||
    shortEmotionalLike ||
    contextUpdateLike ||
    shortContinuationLike ||
    text.length <= 16
  );
}

export async function analyzeTurn(input: AnalyzeTurnInput): Promise<TurnAnalysisBundle | null> {
  const mode = structuredInterpreterMode();
  if (mode === "off") return null;

  const candidate = shouldAnalyzeTurn(input);
  if (!candidate) {
    return null;
  }

  const startedAt = Date.now();
  const fallback = fallbackInterpretation(input);
  let interpretation = fallback;
  let source: StructuredAnalysisSource = "heuristic_fallback";
  let timedOut = false;

  if (configured()) {
    try {
      const llmResult = await runInterpreterLlm(input);
      if (llmResult) {
        interpretation = normalizeInterpretation(llmResult, fallback);
        source = "llm_structured";
      }
    } catch (err) {
      const error = err as Error;
      const aborted = error.name === "AbortError" || /abort/i.test(error.message);
      timedOut = aborted;
      logger.debug("structured turn interpreter fallback", {
        reason: aborted ? "timeout_or_abort" : "llm_error",
        error: error.message,
        source: input.inputSource,
      });
    }
  }

  const policy = composeResponsePolicy(interpretation, input.slowBrainSnapshot);
  return {
    interpretation,
    policy,
    source,
    latencyMs: Date.now() - startedAt,
    timedOut,
    mode,
    used: mode === "on",
  };
}

export function buildResponsePolicyGuidance(bundle: TurnAnalysisBundle): string {
  const { interpretation, policy, source } = bundle;
  const lines: string[] = [
    `【响应策略】${interpretation.userAct}；开头=${policy.openingMove}；直接度=${policy.directness}；温度=${policy.warmth}；问题预算=${policy.questionBudget}；来源=${source}。`,
  ];
  if (policy.shouldGiveJudgment) {
    lines.push("先给判断，不要先把问题丢回用户。");
  }
  if (policy.shouldUpdateDecisionContext) {
    lines.push("这句在补充现实约束，先更新判断，不要重置成共情或盘问。");
  }
  if (policy.bans.length > 0) {
    lines.push(`禁止：${policy.bans.join("、")}。`);
  }
  return lines.join("\n");
}

export function buildResponseShapeContract(bundle: TurnAnalysisBundle): string {
  const { interpretation, policy } = bundle;
  if (interpretation.userAct === "answer_now") {
    return "第一句直接给判断或建议；第二句补一条依据；不要反问，也别把决定权抛回去。";
  }
  if (interpretation.userAct === "decision_seek") {
    return "这是决策题。第一句先给倾向判断；第二句补依据；真的必要时最后再轻问。";
  }
  if (policy.shouldUpdateDecisionContext) {
    return "这句在补充现实约束。先吸收新信息并更新判断，再给一条关键建议；不要重置成共情或追问。";
  }
  if (interpretation.userAct === "scene_continue") {
    return "用户已经在共同场景里。第一句直接承接动作或氛围；第二句补一点细节；不要退回邀请开始想象。";
  }
  if (interpretation.userAct === "topic_veto") {
    return "先顺着新话题或只做轻陪伴，不要回拉被拒绝的话题。";
  }
  if (interpretation.userAct === "direct_question") {
    return "先回答用户的直接问题，再决定要不要补一句很轻的跟进。";
  }
  if (interpretation.userAct === "emotional_share") {
    return policy.questionBudget > 0
      ? "先接住用户当下的感受，再往前推一小步；如果合适，最后只轻轻问一句。"
      : "先接住用户当下的感受，再往前推一小步；不要急着讲道理。";
  }
  return policy.questionBudget > 0
    ? "优先贴着上下文自然接一句，再决定要不要补一个很轻的问题。"
    : "优先贴着上下文自然接一句，不要条件反射地追问。";
}

export function buildPolicyToneContract(
  bundle: TurnAnalysisBundle,
  input: {
    relationshipStage?: string;
    familiarity?: number;
    emotionalBond?: number;
    userMessage?: string;
  },
): string {
  const { interpretation, policy } = bundle;
  const base = buildToneContract({
    relationshipStage: input.relationshipStage,
    familiarity: input.familiarity,
    emotionalBond: input.emotionalBond,
    userMessage: input.userMessage,
    sceneImmersion: interpretation.sceneState === "already_in_scene",
    shortInput: Boolean((input.userMessage ?? "").trim().length > 0 && (input.userMessage ?? "").trim().length < 12),
    negativeEmotionalContext: interpretation.emotionalState.valence === "negative" || interpretation.emotionalState.valence === "mixed",
    continuingTopic: interpretation.topicUpdate?.kind === "continuation",
    decisionSeeking: interpretation.userAct === "decision_seek" || interpretation.userAct === "direct_question",
    answerNow: interpretation.userAct === "answer_now",
  });

  const extra: string[] = [];
  if (policy.shouldUpdateDecisionContext) {
    extra.push("补充现实约束时，要像真的听懂并纳入判断。");
  }
  if (policy.questionBudget === 0) {
    extra.push("这轮追问预算为 0，不要在前两句反问。");
  }
  if (policy.shouldGiveJudgment) {
    extra.push("判断题先给判断，不要先铺很长共情或主持式反问。");
  }
  return [base, ...extra].join("；");
}
