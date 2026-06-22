import type { PromptMessage } from "./prompt_builder";
import { getConfig } from "../server/config";
import {
  buildToneContract,
  detectAnswerNowSignal,
  detectBedtimeSignal,
  detectDecisionSeekingSignal,
  detectEmotionalDistressSignal,
  detectHighRiskDistressSignal,
  detectPracticalDistressSignal,
  detectRelationalRecallSignal,
} from "./tone_policy";
import { completeWithOptions, type ChatMessage } from "../llm/qwen_client";
import { createLogger } from "../infra/logger";
import type { SlowBrainSnapshot } from "../brains/background_analysis_store";
import type { StyleIntentSignal } from "../persona/style_override";
import { getTurnInterpreterHooks } from "../plugin/registry";

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
export type TurnSceneType =
  | "light_chat"
  | "deliverable_request"
  | "relational_recall"
  | "practical_judgment"
  | "emotional_distress"
  | "high_risk_distress"
  | "bedtime_wind_down";

export interface TurnInterpretation {
  userAct: TurnUserAct;
  sceneType?: TurnSceneType;
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
  styleIntent?: StyleIntentSignal;
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
    | "no_jokes"
    | "no_topic_pivot"
    | "no_speculative_memory"
    | "no_shallow_reassurance"
    | "no_external_delivery_claim"
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
  connId?: string;
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
  styleIntent?: {
    humorBoost?: boolean;
    teasingLevel?: string;
    assistantySuppression?: boolean;
    familiarityBoost?: boolean;
    romanceBoost?: boolean;
    roleplayStyle?: string;
    confidence?: number;
  };
  confidence?: number;
}

const INTERPRETER_PROMPT = `你是一个对话回合解释器，不是聊天角色本身。
你的任务：判断这句用户输入此刻真正要什么，以及下一句回复应该怎么开口。

严格返回合法 JSON，不要 markdown，不要解释：
{
  “userAct”: “direct_question | decision_seek | context_update | emotional_share | scene_continue | topic_veto | answer_now | small_talk | unclear”,
  “answerObligation”: “must_answer | answer_then_followup | followup_ok”,
  “responseMode”: “answer_first | attune_then_answer | stay_in_scene | gentle_followup | quiet_presence”,
  “emotionalState”: {
    “valence”: “negative | mixed | neutral | positive”,
    “intensity”: “low | medium | high”,
    “feltNeeds”: [“comfort | clarity | validation | practical_help | space”]
  },
  “relationalPosture”: “warm | steady | playful | serious”,
  “topicUpdate”: {
    “kind”: “new_topic | continuation | constraint_update | none”,
    “label”: “可选，短词”
  },
  “sceneState”: “already_in_scene | not_in_scene”,
  “boundaryState”: “veto_topic | none”,
  “followupPermission”: “none | one_light_question”,
  “styleIntent”: {
    “humorBoost”: true,
    “teasingLevel”: “off | light”,
    “assistantySuppression”: false,
    “familiarityBoost”: false,
    “romanceBoost”: false,
    “roleplayStyle”: “可选，短词”,
    “confidence”: 0.0
  },
  “confidence”: 0.0
}

判定规则：
- 用户在要判断、建议、明确意见时，userAct=decision_seek，answerObligation 至少是 must_answer。
- 用户在催你别老问、要求你直接说时，userAct=answer_now，必须直接回答。
- 用户要求你生成、整理、设计、写出或补发交付物（执行稿、方案、设计稿、文档、代码、脚本、清单、总结、报告等）时，userAct=answer_now，answerObligation=must_answer，responseMode=answer_first，followupPermission=none；必须在当前聊天直接输出正文，不能声称已发送到附件、压缩包、收件框或其他外部位置。
- 用户补充现实约束、背景、资源、风险、机会、时间线，并且这些信息会改变判断时，userAct=context_update，topicUpdate.kind=constraint_update。
- 用户已经把你们放进同一个画面或动作里时，userAct=scene_continue，responseMode=stay_in_scene。
- 用户明确说不要聊某话题时，userAct=topic_veto。
- 用户只是分享情绪或近况，没有明确问问题时，优先 emotional_share。
- 用户如果在要求你”更有趣一点 / 少一点助手腔 / 像熟人一点 / 轻一点毒舌 / 更会撩一点 / 扮演一种说话做事风格”，请在 styleIntent 里体现；没有这种要求时 styleIntent 留空或不填。
- styleIntent 只描述”接下来几轮回复应该更像什么风格”，不是长期人格设定；轻毒舌只能是 teasingLevel=light，不要输出更重等级。
- 不要把”我是不是该辞职””换个老板吗””我还欠花呗两万五””我手里只有三千””我快撑不住了”误判成 small_talk。
- 用户说”嗯””好的””哦””知道了””OK”等单字/短字回应时，优先 small_talk，followupPermission=none，不要误判为 emotional_share。
- 用户有明显负面情绪词（难过/委屈/崩溃/焦虑/失眠等）时才判 emotional_share，纯粹日常陈述不算。
- feltNeeds 只保留 1-3 个最关键的。
- followupPermission 要保守：短消息（<8字）且明显轻聊时才给 one_light_question；情绪重或问题明确时一律 none。
- 消息前半段轻松但后半段出现现实压力词（债务/裁员/手术/被骗/分手等）时，以后半段为准判断 sceneType，不要因为开头像 small_talk 就整条判轻聊。
- 用户提到被裁、失业、确诊、被骗等非债务类现实压力时，同样走 practical_judgment，不要误判为 emotional_share 或 small_talk。`;

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

function detectRelationalRecallContext(history: PromptMessage[]): boolean {
  const recent = history.slice(-4);
  const recentUserText = recent
    .filter((entry) => entry.role === "user")
    .map((entry) => entry.content)
    .join(" ");
  if (detectRelationalRecallSignal(recentUserText)) return true;

  const recentAssistantText = recent
    .filter((entry) => entry.role === "assistant")
    .map((entry) => entry.content)
    .join(" ");
  return /记错|记混|绕晕|被你抓包|快给点提示|没记牢|我怎么绕晕|猜错/u.test(recentAssistantText);
}

function detectPracticalFollowupContext(
  text: string,
  history: PromptMessage[],
  snapshot: SlowBrainSnapshot,
): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const active = snapshot.workingMemory;
  const activeDecisionThread =
    active?.sceneState === "decision" &&
    (/判断|债务|还款|约束|算/u.test(active.activeThread || "") ||
      /判断|还款|债务|花呗|欠/u.test(active.currentNeed || "") ||
      (active.currentConstraints?.length ?? 0) > 0);
  if (!activeDecisionThread) return false;

  if (/^(你帮我算算|帮我算算|你说呢|那怎么办|继续算|继续说|接着算|那我怎么办)$/u.test(trimmed)) {
    return true;
  }

  const recentUserText = history
    .slice(-3)
    .filter((entry) => entry.role === "user")
    .map((entry) => entry.content)
    .join(" ");
  return Boolean(recentUserText) && /欠|花呗|还到|月收入|每个月挣|赔了/u.test(recentUserText);
}

function detectConstraintCarryContext(
  text: string,
  history: PromptMessage[],
  snapshot: SlowBrainSnapshot,
): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  const active = snapshot.workingMemory;
  const activeDecisionThread =
    active?.sceneState === "decision" &&
    /判断|约束|债务|还款|现金流|房租|负债|花呗|贷款|网贷|工资|月收入|每个月挣|去留|老板|工作/u.test(
      `${active.activeThread || ""} ${active.currentNeed || ""} ${active.openLoop || ""} ${(active.currentConstraints ?? []).join(" ")}`,
    );
  if (!activeDecisionThread) return false;

  if (
    detectDecisionSeekingSignal(trimmed) ||
    detectAnswerNowSignal(trimmed) ||
    detectHighRiskDistressSignal(trimmed)
  ) {
    return false;
  }

  const connectorLike = /^(而且|还有|另外|但是|但|不过|只是|现在|可我|可是|问题是|再加上)/u.test(trimmed);
  const constraintLike =
    /(?:\d|花呗|房租|贷款|网贷|负债|还欠|赔偿|赔了|月收入|月薪|工资|手里|现金|现金流|存款|只剩|这个月|下个月|offer|面试|住院|睡不好|失眠|老板|工时|时间不够|没空)/u.test(
      trimmed,
    );
  const recentDecisionContext = history
    .slice(-4)
    .filter((entry) => entry.role === "user")
    .map((entry) => entry.content)
    .join(" ");

  return (
    constraintLike &&
    (connectorLike || (active.currentConstraints?.length ?? 0) > 0 || /欠|花呗|房租|贷款|网贷|工资|月收入|每个月挣/u.test(recentDecisionContext))
  );
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

function detectStyleIntentLike(text: string): boolean {
  return /有趣点|风趣点|幽默点|机灵点|会接梗|毒舌一点|嘴贫一点|损一点|别这么像助手|别太像助手|助手腔|别像客服|别像主持人|别这么官方|别这么端着|像自己人一点|像熟人一样|像熟一点的人|更会撩一点|浪漫一点|暧昧一点|扮演.+风格|说话风格|做事风格/u.test(
    text,
  );
}

function detectDeliverableRequest(text: string, history: PromptMessage[]): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  const deliverableNoun =
    /(?:codex)?(?:开发)?执行稿|方案|设计稿|文档|计划书|计划|prompt|提示词|代码|脚本|清单|总结|报告|大纲|PRD|需求文档|流程图/iu;
  const createOrShowVerb =
    /生成|写(?!的)|设计(?!的)|整理(?!的)|做(?!的)|输出|列|给我|发我|发一下|发过来|贴出来|给我看|看看|怎么设计|来设计/iu;
  const deliveryAsk =
    /发我|发一下|发过来|给我看|贴出来|直接(?:放|贴|发|写|输出).*(?:聊天|这里|当前)|放在聊天|聊天记录|在哪里|在哪|没看到|没发/iu;
  const fakeExternalDelivery =
    /(?:已|已经).{0,12}(?:发|发送|放|上传|整理好|调整好)|附件|压缩包|收件框|最后一页|打开翻到/iu;

  if (deliverableNoun.test(trimmed) && createOrShowVerb.test(trimmed)) {
    return true;
  }

  const recent = history
    .slice(-6)
    .map((entry) => entry.content)
    .join(" ");
  if (!recent) return false;

  return (
    deliveryAsk.test(trimmed) &&
    (deliverableNoun.test(recent) || fakeExternalDelivery.test(recent))
  );
}

function deriveStyleIntent(text: string): StyleIntentSignal | undefined {
  const humorBoost = /有趣点|风趣点|幽默点|机灵点|会接梗/u.test(text);
  const teasingLevel = /毒舌一点|嘴贫一点|损一点|嘴毒一点/u.test(text) ? "light" : "off";
  const assistantySuppression = /别这么像助手|别太像助手|助手腔|别像客服|别像主持人|别这么官方|别这么端着|别老安慰|别老问我/u.test(
    text,
  );
  const familiarityBoost = /像自己人一点|像熟人一样|像熟一点的人|像朋友一点/u.test(text);
  const romanceBoost = /更会撩一点|浪漫一点|暧昧一点|会哄一点/u.test(text);
  const roleplayStyle =
    text.match(/扮演([^，。！？\n]{2,30})/u)?.[1]?.trim().slice(0, 32) ??
    text.match(/像([^，。！？\n]{2,24})一样/u)?.[1]?.trim().slice(0, 24) ??
    undefined;

  if (
    !humorBoost &&
    teasingLevel === "off" &&
    !assistantySuppression &&
    !familiarityBoost &&
    !romanceBoost &&
    !roleplayStyle
  ) {
    return undefined;
  }

  const confidence =
    /有趣点|风趣点|毒舌一点|别这么像助手|像自己人一点|更会撩一点|扮演/u.test(text)
      ? 0.82
      : 0.74;

  return {
    humorBoost,
    teasingLevel,
    assistantySuppression,
    familiarityBoost,
    romanceBoost,
    roleplayStyle,
    confidence,
  };
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
  const highRiskDistress = detectHighRiskDistressSignal(trimmed);
  const practicalDistress = detectPracticalDistressSignal(trimmed);
  const emotionalDistress = detectEmotionalDistressSignal(trimmed);
  const question = isQuestionLike(trimmed);
  const deliverableRequest = detectDeliverableRequest(trimmed, input.history);
  const practicalFollowup = detectPracticalFollowupContext(trimmed, input.history, input.slowBrainSnapshot);
  const constraintCarry = detectConstraintCarryContext(trimmed, input.history, input.slowBrainSnapshot);
  const relationalRecall =
    detectRelationalRecallSignal(trimmed) ||
    (question && detectRelationalRecallContext(input.history));
  const veto = detectTopicVeto(trimmed);
  const contextUpdate = detectContextUpdateLike(trimmed, input.history);
  const continuation = detectContinuationLike(trimmed);

  let userAct: TurnUserAct = "small_talk";
  let answerObligation: AnswerObligation = "followup_ok";
  let responseMode: ResponseMode = negative ? "attune_then_answer" : "gentle_followup";
  let followupPermission: FollowupPermission = trimmed.length <= 12 ? "one_light_question" : "none";
  let posture: RelationalPosture = negative ? "warm" : "steady";
  let topicUpdate: { kind: TopicUpdateKind; label?: string } = {
    kind: continuation ? "continuation" : "none",
  };

  if (highRiskDistress) {
    userAct = "emotional_share";
    answerObligation = "must_answer";
    responseMode = "attune_then_answer";
    followupPermission = "none";
    posture = "serious";
  } else if (deliverableRequest) {
    userAct = "answer_now";
    answerObligation = "must_answer";
    responseMode = "answer_first";
    followupPermission = "none";
    posture = "serious";
  } else if (practicalDistress) {
    userAct = "decision_seek";
    answerObligation = "must_answer";
    responseMode = "attune_then_answer";
    followupPermission = "none";
    posture = "serious";
    topicUpdate = { kind: "constraint_update" };
  } else if (constraintCarry) {
    userAct = "context_update";
    answerObligation = "answer_then_followup";
    responseMode = "answer_first";
    followupPermission = "none";
    posture = "serious";
    topicUpdate = { kind: "constraint_update" };
  } else if (practicalFollowup) {
    userAct = "decision_seek";
    answerObligation = "must_answer";
    responseMode = "answer_first";
    followupPermission = "none";
    posture = "serious";
  } else if (answerNow) {
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
  } else if (emotionalDistress) {
    userAct = "emotional_share";
    answerObligation = "answer_then_followup";
    responseMode = "attune_then_answer";
    followupPermission = "none";
    posture = "warm";
    topicUpdate = { kind: continuation ? "continuation" : "none" };
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
  } else if (relationalRecall) {
    userAct = "direct_question";
    answerObligation = "must_answer";
    responseMode = "answer_first";
    followupPermission = "none";
    posture = "serious";
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
      valence:
        highRiskDistress || negative || emotionalDistress
          ? "negative"
          : hasPositiveCue(trimmed)
            ? "positive"
            : "neutral",
      intensity: highRiskDistress
        ? "high"
        : emotionalDistress || trimmed.length > 24 || /很|特别|太|一直/u.test(trimmed)
          ? "medium"
          : "low",
      feltNeeds: highRiskDistress
        ? ["validation", "comfort", "space"]
        : practicalDistress
        ? ["validation", "clarity", "practical_help"]
        : userAct === "decision_seek" || userAct === "context_update"
        ? ["clarity", "practical_help"]
        : emotionalDistress
        ? ["validation", "comfort"]
        : negative
          ? ["validation", "comfort"]
          : ["clarity"],
    },
    relationalPosture: posture,
    topicUpdate,
    sceneState: scene ? "already_in_scene" : "not_in_scene",
    boundaryState: veto ? "veto_topic" : "none",
    followupPermission,
    styleIntent: deriveStyleIntent(trimmed),
    confidence:
      deliverableRequest || answerNow || decision || scene || veto || contextUpdate || practicalDistress || practicalFollowup || constraintCarry || emotionalDistress
        ? 0.72
        : 0.46,
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

  const rawStyleIntent = raw.styleIntent;
  const styleIntent: StyleIntentSignal | undefined =
    rawStyleIntent &&
    (rawStyleIntent.humorBoost === true ||
      rawStyleIntent.teasingLevel === "light" ||
      rawStyleIntent.assistantySuppression === true ||
      rawStyleIntent.familiarityBoost === true ||
      rawStyleIntent.romanceBoost === true ||
      Boolean(rawStyleIntent.roleplayStyle?.trim()))
      ? {
          humorBoost: rawStyleIntent.humorBoost === true,
          teasingLevel: rawStyleIntent.teasingLevel === "light" ? "light" : "off",
          assistantySuppression: rawStyleIntent.assistantySuppression === true,
          familiarityBoost: rawStyleIntent.familiarityBoost === true,
          romanceBoost: rawStyleIntent.romanceBoost === true,
          roleplayStyle: rawStyleIntent.roleplayStyle?.trim()?.slice(0, 32) || undefined,
          confidence: clampConfidence(rawStyleIntent.confidence, fallback.styleIntent?.confidence ?? 0.72),
        }
      : fallback.styleIntent;

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
    styleIntent,
    confidence: clampConfidence(raw.confidence, fallback.confidence),
  };
}

function deriveSceneType(
  interpretation: TurnInterpretation,
  userMessage: string,
  history: PromptMessage[],
): TurnSceneType {
  const text = userMessage.trim();
  if (detectHighRiskDistressSignal(text)) return "high_risk_distress";
  if (detectDeliverableRequest(text, history)) return "deliverable_request";
  if (
    detectRelationalRecallSignal(text) ||
    (interpretation.userAct === "direct_question" && detectRelationalRecallContext(history))
  ) {
    return "relational_recall";
  }
  if (
    interpretation.userAct === "decision_seek" ||
    interpretation.userAct === "context_update" ||
    interpretation.userAct === "answer_now"
  ) {
    return "practical_judgment";
  }
  if (detectEmotionalDistressSignal(text)) return "emotional_distress";
  if (detectBedtimeSignal(text)) return "bedtime_wind_down";
  return "light_chat";
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

  if (interpretation.sceneType === "high_risk_distress") {
    bans.push("no_repeat_user_question", "no_jokes", "no_topic_pivot", "no_speculative_memory");
  } else if (interpretation.sceneType === "deliverable_request") {
    bans.push("no_repeat_user_question", "no_topic_pivot", "no_external_delivery_claim");
  } else if (interpretation.sceneType === "relational_recall") {
    bans.push("no_topic_pivot", "no_speculative_memory");
  } else if (interpretation.sceneType === "practical_judgment") {
    bans.push("no_topic_pivot");
    if (
      interpretation.responseMode === "attune_then_answer" &&
      interpretation.emotionalState.feltNeeds.includes("practical_help")
    ) {
      bans.push("no_shallow_reassurance");
    }
    if (
      slowBrainSnapshot.workingMemory?.doNotTouch?.includes("不要轻飘安慰或无依据粗算") &&
      !bans.includes("no_shallow_reassurance")
    ) {
      bans.push("no_shallow_reassurance");
    }
  } else if (interpretation.sceneType === "emotional_distress") {
    bans.push("no_jokes", "no_topic_pivot", "no_shallow_reassurance");
  } else if (interpretation.sceneType === "bedtime_wind_down") {
    bans.push("no_topic_pivot");
  }

  if (interpretation.answerObligation !== "followup_ok") {
    if (!bans.includes("no_repeat_user_question")) {
      bans.push("no_repeat_user_question");
    }
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
  if (interpretation.sceneType === "deliverable_request" || interpretation.sceneType === "relational_recall") {
    openingMove = "direct_answer";
  } else if (interpretation.sceneType === "bedtime_wind_down") {
    openingMove = "quiet_presence";
  } else if (interpretation.responseMode === "stay_in_scene") {
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
    interpretation.sceneType === "high_risk_distress"
      ? "medium"
      : shouldGiveJudgment || shouldUpdateDecisionContext || interpretation.userAct === "answer_now"
      ? "high"
      : interpretation.userAct === "direct_question"
        ? "medium"
        : "low";

  const warmth: ResponsePolicy["warmth"] =
    negative ||
    warmRelationship ||
    interpretation.relationalPosture === "warm"
      ? "high"
      : interpretation.relationalPosture === "serious"
        ? "medium"
        : "medium";

  const questionBudget: 0 | 1 =
    interpretation.sceneType !== "high_risk_distress" &&
    interpretation.sceneType !== "relational_recall" &&
    interpretation.sceneType !== "bedtime_wind_down" &&
    interpretation.sceneType !== "emotional_distress" &&
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
        model: getConfig().REMI_TURN_INTERPRETER_MODEL,
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
  const highRiskDistressLike = detectHighRiskDistressSignal(text);
  const practicalDistressLike = detectPracticalDistressSignal(text);
  const emotionalDistressLike = detectEmotionalDistressSignal(text);
  const deliverableRequestLike = detectDeliverableRequest(text, input.history);
  const practicalFollowupLike = detectPracticalFollowupContext(text, input.history, input.slowBrainSnapshot);
  const constraintCarryLike = detectConstraintCarryContext(text, input.history, input.slowBrainSnapshot);
  const relationalRecallLike = detectRelationalRecallSignal(text);
  const boundaryLike = detectTopicVeto(text);
  const sceneLike = isSceneImmersionLike(text);
  const contextUpdateLike = detectContextUpdateLike(text, input.history);
  const shortQuestionLike = isQuestionLike(text) && text.length <= 32;
  const shortEmotionalLike = detectEmotionalShare(text) && text.length <= 24;
  const shortContinuationLike = detectContinuationLike(text) && text.length <= 16;
  const styleIntentLike = detectStyleIntentLike(text);

  if (input.inputSource === "text") {
    return (
      decisionLike ||
      highRiskDistressLike ||
      practicalDistressLike ||
      emotionalDistressLike ||
      deliverableRequestLike ||
      practicalFollowupLike ||
      constraintCarryLike ||
      relationalRecallLike ||
      boundaryLike ||
      sceneLike ||
      contextUpdateLike ||
      styleIntentLike ||
      shortQuestionLike ||
      shortEmotionalLike ||
      shortContinuationLike
    );
  }

  return (
    decisionLike ||
    highRiskDistressLike ||
    practicalDistressLike ||
    emotionalDistressLike ||
    deliverableRequestLike ||
    practicalFollowupLike ||
    constraintCarryLike ||
    relationalRecallLike ||
    boundaryLike ||
    sceneLike ||
    styleIntentLike ||
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

  interpretation.sceneType = deriveSceneType(interpretation, input.userMessage, input.history);
  const policy = composeResponsePolicy(interpretation, input.slowBrainSnapshot);
  const bundle: TurnAnalysisBundle = {
    interpretation,
    policy,
    source,
    latencyMs: Date.now() - startedAt,
    timedOut,
    mode,
    used: mode === "on",
  };
  for (const hook of getTurnInterpreterHooks()) {
    const result = hook.postProcess(
      bundle.interpretation,
      bundle.policy,
      { userMessage: input.userMessage, inputSource: input.inputSource, connId: input.connId },
    );
    bundle.interpretation = result.interpretation;
    bundle.policy = result.policy;
  }
  return bundle;
}

export function buildResponsePolicyGuidance(bundle: TurnAnalysisBundle): string {
  const { interpretation, policy, source } = bundle;
  const lines: string[] = [
    `【响应策略】${interpretation.userAct}；场景=${interpretation.sceneType ?? "light_chat"}；开头=${policy.openingMove}；直接度=${policy.directness}；温度=${policy.warmth}；问题预算=${policy.questionBudget}；来源=${source}。`,
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
  if (interpretation.sceneType === "high_risk_distress") {
    return "这是高风险现实场景。第一句先确认用户此刻是不是安全的；第二句明确别让他一个人硬扛；第三句只给一个最小下一步。不要开玩笑，不要把话题拉回宠物或轻松梗，也不要立刻抛一串赚钱点子。";
  }
  if (interpretation.sceneType === "emotional_distress") {
    return "这是情绪承接场景（自责 / 委屈 / 难受 / 反讽下的失落）。先稳稳接住对方此刻的感受，让他知道你在；不要急着讲道理、追问或岔开话题，也不要用“没事的 / 会好起来”这类轻飘安慰。除非他开口要，否则别硬塞建议或解决方案。";
  }
  if (interpretation.sceneType === "bedtime_wind_down") {
    return "这是睡前陪聊场景。语气放柔放慢，句子短一点；不要抛新话题或追问，像在旁边安静陪着。";
  }
  if (interpretation.sceneType === "deliverable_request") {
    return "这是交付物请求。必须把正文直接输出在当前聊天框；如果没有真实文件/附件/收件箱工具，就明确说只能贴在聊天里。禁止说已发送、已上传、放进附件、压缩包、收件框或最后一页。先给正文，不要把话题拉回宠物、游戏梗或轻松闲聊。";
  }
  if (interpretation.sceneType === "relational_recall") {
    return "这是关系连续性校验。先直接回答你记得的部分；记不准就直接承认，不要靠猜，也不要把问题丢回用户或换成轻松话题。";
  }
  if (
    interpretation.sceneType === "practical_judgment" &&
    policy.bans.includes("no_shallow_reassurance")
  ) {
    return "这是现实压力判断场景。先承认眼前压力确实很重，再给一个有依据的判断或拆法；不要无依据地粗算，也不要只丢轻飘安慰或赚钱点子。";
  }
  if (interpretation.sceneType === "practical_judgment") {
    return "这是现实判断场景。先针对用户的具体问题给出你的看法或拆解，不要用反问代替回答，也不要绕回轻松话题。";
  }
  if (interpretation.userAct === "answer_now") {
    return "第一句直接给判断或建议；第二句补一条依据；不要反问，也别把决定权抛回去。";
  }
  if (interpretation.userAct === "decision_seek") {
    return "这是决策题。第一句先给倾向判断；第二句补依据；真的必要时最后再轻问。";
  }
  if (policy.shouldUpdateDecisionContext) {
    return "这句在补充现实约束。先吸收新信息并更新判断，再给一条关键建议；不要重置成共情或追问。";
  }
  if (policy.openingMove === "quiet_presence") {
    return "用户不需要你积极说话。一两个字的轻回应就好，不要主动延伸话题，不要追问。";
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
    decisionSeeking:
      interpretation.sceneType === "practical_judgment" ||
      interpretation.userAct === "decision_seek" ||
      interpretation.userAct === "answer_now" ||
      policy.shouldUpdateDecisionContext,
    answerNow: interpretation.userAct === "answer_now",
  });

  const extra: string[] = [];
  if (interpretation.sceneType === "high_risk_distress") {
    extra.push("这是高风险现实场景：禁玩笑、禁轻飘安慰、禁把话题拉回宠物梗、禁猜测式记忆。");
  }
  if (interpretation.sceneType === "emotional_distress") {
    extra.push("这是情绪承接场景：先接住自责 / 委屈 / 难受的情绪，别讲道理、别岔开、别轻飘安慰；没被要建议时不要硬给建议或分析。");
  }
  if (interpretation.sceneType === "deliverable_request") {
    extra.push("这是交付物请求：正文直接贴在当前聊天里，不要编造已发送、附件、压缩包、收件框、最后一页或其他外部交付渠道。");
  }
  if (interpretation.sceneType === "relational_recall") {
    extra.push("这是关系连续性校验：先回答你记得的部分，记不准就直接承认，不要靠猜。");
  }
  if (interpretation.sceneType === "practical_judgment") {
    extra.push("这是现实判断场景：别绕回轻聊或不相干的话题。");
    if (policy.bans.includes("no_shallow_reassurance")) {
      extra.push("这是现实压力判断：先承认压力，再给有依据的拆法，别随口给一个轻飘的粗算。");
    }
  }
  if (interpretation.sceneType === "bedtime_wind_down") {
    extra.push("睡前场景：语气放柔放慢，不要把话题越聊越兴奋。");
  }
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
