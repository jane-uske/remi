import type { PromptMessage } from "./prompt_builder";
import { buildToneContract, detectAnswerNowSignal, detectDecisionSeekingSignal } from "./tone_policy";
import { completeWithOptions, type ChatMessage } from "../llm/qwen_client";
import { createLogger } from "../infra/logger";
import type { SlowBrainSnapshot } from "../brains/slow_brain_store";
import type { StyleIntentSignal } from "../persona/style_override";
import {
  advanceAdultSceneState,
  classifyAdultIntent,
  type AdultIntent,
  type AdultSceneBeat,
  type AdultSceneIntensity,
  type AdultSceneStyle,
  type AdultSceneState,
} from "./adult_mode";

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
  adultIntent?: AdultIntent;
  adultSceneBeat?: AdultSceneBeat;
  adultSceneIntensity?: AdultSceneIntensity;
  adultSceneStyle?: AdultSceneStyle;
  adultRepairHint?: string;
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
  adultSceneState?: AdultSceneState | null;
  signal?: AbortSignal;
}

interface PartialTurnInterpretation {
  userAct?: string;
  adultIntent?: string;
  adultSceneBeat?: string;
  adultSceneIntensity?: string;
  adultSceneStyle?: string;
  adultRepairHint?: string;
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
  "userAct": "direct_question | decision_seek | context_update | emotional_share | scene_continue | topic_veto | answer_now | small_talk | unclear",
  "adultIntent": "none | flirt_tease | sexual_invite | dominant_command | scene_repair | explicit_scene_continue | cooldown_or_boundary",
  "adultSceneBeat": "idle | entry | escalate | sustain | cool_down",
  "adultSceneIntensity": "none | tease | charged | explicit",
  "adultSceneStyle": "scene_prose | fantasy_execute",
  "adultRepairHint": "可选，用户在纠正上一句写法时，用一句短话说明应该怎么改",
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
  "styleIntent": {
    "humorBoost": true,
    "teasingLevel": "off | light",
    "assistantySuppression": false,
    "familiarityBoost": false,
    "romanceBoost": false,
    "roleplayStyle": "可选，短词",
    "confidence": 0.0
  },
  "confidence": 0.0
}

判定规则：
- 用户在要判断、建议、明确意见时，userAct=decision_seek，answerObligation 至少是 must_answer。
- 用户在催你别老问、要求你直接说时，userAct=answer_now，必须直接回答。
- 用户补充现实约束、背景、资源、风险、机会、时间线，并且这些信息会改变判断时，userAct=context_update，topicUpdate.kind=constraint_update。
- 用户已经把你们放进同一个画面或动作里时，userAct=scene_continue，responseMode=stay_in_scene。
- adultIntent 只描述成人场景信号，不等于一定放行 explicit。普通闲聊不要标成 sexual_invite。
- flirt_tease 只用于轻撩、调情、暧昧；sexual_invite 用于明确开黄腔或性邀约；dominant_command 用于 explicit scene 里用户给出明确命令并要求你立刻执行；scene_repair 用于用户还在 explicit scene 里，但在纠正你上一句的写法、比喻或措辞；explicit_scene_continue 只用于当前明确在 explicit scene 里继续推进；用户降温、设边界或明显转回普通话题时用 cooldown_or_boundary。
- adultSceneBeat / adultSceneIntensity 用来描述这轮成人场景的推进节奏：刚进场用 entry，继续加码用 escalate，已经在场景里继续维持用 sustain；轻暧昧是 tease，刚放行 explicit 但还在升温是 charged，已经进入明确 explicit 描写是 explicit。
- adultSceneStyle 用来描述当前 explicit 的写法：scene_prose 偏氛围和画面，fantasy_execute 偏直接执行、短句、命令回应和性幻想推进。
- 用户明确说不要聊某话题时，userAct=topic_veto。
- 用户只是分享情绪或近况，没有明确问问题时，优先 emotional_share。
- 用户如果在要求你“更有趣一点 / 少一点助手腔 / 像熟人一点 / 轻一点毒舌 / 更会撩一点 / 扮演一种说话做事风格”，请在 styleIntent 里体现；没有这种要求时 styleIntent 留空或不填。
- styleIntent 只描述“接下来几轮回复应该更像什么风格”，不是长期人格设定；轻毒舌只能是 teasingLevel=light，不要输出更重等级。
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

function detectStyleIntentLike(text: string): boolean {
  return /有趣点|风趣点|幽默点|机灵点|会接梗|毒舌一点|嘴贫一点|损一点|别这么像助手|别太像助手|助手腔|别像客服|别像主持人|别这么官方|别这么端着|像自己人一点|像熟人一样|像熟一点的人|更会撩一点|浪漫一点|暧昧一点|扮演.+风格|说话风格|做事风格/u.test(
    text,
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

function deriveAdultRepairHint(text: string): string | undefined {
  const replacementMatch = text.match(/别([^，。！？!?]{1,24})了[，,\s]*([^，。！？!?]{1,24})就行/u);
  if (replacementMatch) {
    const avoid = replacementMatch[1]?.trim();
    const prefer = replacementMatch[2]?.trim();
    if (avoid && prefer) {
      return `不要再用“${avoid}”这类说法，直接按用户指定的“${prefer}”继续。`;
    }
  }

  const targetMatch = text.match(/我说的是([^，。！？!?]{1,24})/u);
  if (targetMatch?.[1]) {
    return `直接按用户指定的“${targetMatch[1].trim()}”继续，不要擅自换成别的比喻。`;
  }

  if (/说人话|直接说|别(?:这么|这样)?(?:写|说)|换个说法|换种说法|别绕|别拐弯|别文绉绉|别整(?:这些|这种)|重说/u.test(text)) {
    return "把上一句的比喻和文艺写法收掉，改成更直接、更具体、更贴动作的人话。";
  }

  return undefined;
}

function fallbackInterpretation(input: AnalyzeTurnInput): TurnInterpretation {
  const trimmed = input.userMessage.trim();
  const adultIntent = classifyAdultIntent(trimmed, input.adultSceneState);
  const projectedAdultScene = advanceAdultSceneState(input.adultSceneState, {
    userMessage: trimmed,
    analysis: null,
  }).nextState;
  const negative = detectEmotionalShare(trimmed);
  const scene =
    isSceneImmersionLike(trimmed) ||
    adultIntent === "sexual_invite" ||
    adultIntent === "dominant_command" ||
    adultIntent === "scene_repair" ||
    adultIntent === "explicit_scene_continue";
  const adultRepairHint = adultIntent === "scene_repair" ? deriveAdultRepairHint(trimmed) : undefined;
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
    posture =
      adultIntent === "dominant_command" || adultIntent === "scene_repair"
        ? "serious"
        : adultIntent === "sexual_invite" || adultIntent === "explicit_scene_continue"
        ? "playful"
        : "warm";
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
    adultIntent,
    adultSceneBeat: projectedAdultScene.beat,
    adultSceneIntensity: projectedAdultScene.intensity,
    adultSceneStyle: projectedAdultScene.style,
    adultRepairHint,
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
    styleIntent: deriveStyleIntent(trimmed),
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

  const adultIntent = [
    "none",
    "flirt_tease",
    "sexual_invite",
    "dominant_command",
    "scene_repair",
    "explicit_scene_continue",
    "cooldown_or_boundary",
  ].includes(raw.adultIntent ?? "")
    ? (raw.adultIntent as AdultIntent)
    : fallback.adultIntent;

  const adultSceneBeat = ["idle", "entry", "escalate", "sustain", "cool_down"].includes(
    raw.adultSceneBeat ?? "",
  )
    ? (raw.adultSceneBeat as AdultSceneBeat)
    : fallback.adultSceneBeat;

  const adultSceneIntensity = ["none", "tease", "charged", "explicit"].includes(
    raw.adultSceneIntensity ?? "",
  )
    ? (raw.adultSceneIntensity as AdultSceneIntensity)
    : fallback.adultSceneIntensity;

  const adultSceneStyle = ["scene_prose", "fantasy_execute"].includes(raw.adultSceneStyle ?? "")
    ? (raw.adultSceneStyle as AdultSceneStyle)
    : fallback.adultSceneStyle;

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
    adultIntent,
    adultSceneBeat,
    adultSceneIntensity,
    adultSceneStyle,
    adultRepairHint: raw.adultRepairHint?.trim() || fallback.adultRepairHint,
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
    interpretation.adultIntent === "flirt_tease" ||
    interpretation.adultIntent === "sexual_invite" ||
    interpretation.adultIntent === "dominant_command" ||
    interpretation.adultIntent === "scene_repair" ||
    interpretation.adultIntent === "explicit_scene_continue"
  ) {
    openingMove = "scene_ack";
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
    negative ||
    warmRelationship ||
    interpretation.relationalPosture === "warm" ||
    interpretation.adultIntent === "flirt_tease" ||
    interpretation.adultIntent === "sexual_invite" ||
    interpretation.adultIntent === "dominant_command" ||
    interpretation.adultIntent === "scene_repair" ||
    interpretation.adultIntent === "explicit_scene_continue"
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
  const adultSceneState = input.adultSceneState
    ? `成人场景状态：mode=${input.adultSceneState.mode}，allowedExplicit=${input.adultSceneState.allowedExplicit ? "yes" : "no"}，beat=${input.adultSceneState.beat}，intensity=${input.adultSceneState.intensity}，style=${input.adultSceneState.style}。`
    : "成人场景状态：none。";
  const messages: ChatMessage[] = [
    { role: "system", content: INTERPRETER_PROMPT },
    {
      role: "user",
      content:
        `关系与上下文：\n${context || "无"}\n${adultSceneState}\n\n最近对话：\n${recent || "无"}\n\n当前用户输入：\n${input.userMessage}`,
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
  const adultCueLike = classifyAdultIntent(text, input.adultSceneState) !== "none";
  const shortQuestionLike = isQuestionLike(text) && text.length <= 32;
  const shortEmotionalLike = detectEmotionalShare(text) && text.length <= 24;
  const shortContinuationLike = detectContinuationLike(text) && text.length <= 16;
  const styleIntentLike = detectStyleIntentLike(text);

  if (input.inputSource === "text") {
    return (
      decisionLike ||
      boundaryLike ||
      sceneLike ||
      contextUpdateLike ||
      adultCueLike ||
      styleIntentLike ||
      shortQuestionLike ||
      shortEmotionalLike ||
      shortContinuationLike
    );
  }

  return (
    decisionLike ||
    boundaryLike ||
    sceneLike ||
    adultCueLike ||
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
    if (interpretation.adultIntent === "dominant_command") {
      return "用户在 explicit scene 里下了明确命令。当前按成人幻想执行来写：先执行用户命令的第一步动作，再补动作结果和下一拍推进；句子更短、更直接，但不要只回一句，至少写出动作承接、当下反应和下一拍。少写环境和抒情 filler，不要用括号舞台说明，也不要先解释用户意图，也不要先说“好，我现在就按你说的做”。前两拍禁止反问、确认、拖延、谈条件，不要说“你确定吗”“再等等”“让我看看”，也不要写“等你来”“不好意思慢”这类拉扯式废话。对于“舔干净/跪下来”这类命令，第二拍继续围绕舔和口部动作推进，不要跳到插入、入口或顶入。";
    }
    if (interpretation.adultIntent === "scene_repair") {
      const repairGuidance = interpretation.adultRepairHint
        ? ` ${interpretation.adultRepairHint}`
        : "";
      return `用户在纠正你上一句的写法，但没有退出当前场景。当前按成人幻想执行来写：先沿着同一动作继续，不要解释、道歉或重新开场；把表达改得更直接、更具体、更贴动作，但不要只回一句，至少写出承接、反应和下一拍推进。少写环境和抒情 filler，不要复读刚被用户否掉的比喻或措辞。${repairGuidance}`;
    }
    if (
      interpretation.adultIntent === "sexual_invite" ||
      interpretation.adultIntent === "explicit_scene_continue"
    ) {
      const beatGuidance =
        interpretation.adultSceneBeat === "entry"
          ? "先直接承接用户刚给出的动作或命令，立刻进入同一画面。"
          : interpretation.adultSceneBeat === "escalate"
            ? "不要重新开场，在上一拍动作基础上继续加码。"
            : "维持当前场景张力，顺着现有动作继续往下写。";
      const intensityGuidance =
        interpretation.adultSceneIntensity === "charged"
          ? "先写出动作、姿势、距离、身体反应，把 tension 推高。"
          : "写出更明确的动作、姿势、距离、身体反应，但仍然按拍推进。";
      const styleGuidance =
        interpretation.adultSceneStyle === "fantasy_execute"
          ? "当前按成人幻想执行来写：短句优先，但不要只回一句；直接承接用户指定的动作和目标，至少写出动作承接、当下反应和下一拍推进，少写环境和抒情 filler。不要先说“好，我现在就按你说的做”，也不要跳到插入、入口或顶入，除非用户这句明确要求。"
          : "";
      return `${beatGuidance}${intensityGuidance}${styleGuidance}情绪要一拍一拍往上推，至少写出承接、画面和下一拍钩子，不要只回一句暧昧话。`;
    }
    return "用户已经在共同场景里。第一句直接承接动作或氛围；第二句补一点细节；不要退回邀请开始想象。";
  }
  if (interpretation.adultIntent === "dominant_command") {
    return "explicit scene 已放行，且用户给了明确命令。当前按成人幻想执行来写：先执行用户命令的第一步动作，再写动作结果和下一拍推进；句子更短、更直接，但不要只回一句，不要反问、确认、拖延或重新谈条件，也不要用括号舞台说明，不要先解释用户意图，也不要先说“好，我现在就按你说的做”，也不要写“等你来”“不好意思慢”这类拉扯式废话。对于“舔干净/跪下来”这类命令，第二拍继续围绕舔和口部动作推进，不要跳到插入、入口或顶入。";
  }
  if (interpretation.adultIntent === "scene_repair") {
    const repairGuidance = interpretation.adultRepairHint
      ? ` ${interpretation.adultRepairHint}`
      : "";
    return `用户还在 explicit scene 里，但在纠正你上一句的写法。当前按成人幻想执行来写：不要退出场景，也不要复读刚被否掉的比喻或措辞；改成更直接、更贴动作的人话继续，但不要只回一句，至少写出承接、反应和下一拍推进，少写环境和抒情 filler。${repairGuidance}`;
  }
  if (interpretation.adultIntent === "sexual_invite" || interpretation.adultIntent === "explicit_scene_continue") {
    const beatGuidance =
      interpretation.adultSceneBeat === "entry"
        ? "先直接承接用户刚给出的动作或命令，立刻进入同一画面。"
        : interpretation.adultSceneBeat === "escalate"
          ? "不要重新开场，在上一拍动作基础上继续加码。"
          : "维持当前场景张力，顺着现有动作继续往下写。";
    const intensityGuidance =
      interpretation.adultSceneIntensity === "charged"
        ? "先写出动作、姿势、距离、身体反应，把 tension 推高。"
        : "写出更明确的动作、姿势、距离、身体反应，但仍然按拍推进。";
    const styleGuidance =
      interpretation.adultSceneStyle === "fantasy_execute"
        ? "当前按成人幻想执行来写：短句优先，直接承接用户指定的动作和目标，少写环境和抒情 filler。不要先说“好，我现在就按你说的做”，也不要跳到插入、入口或顶入，除非用户这句明确要求。"
        : "";
    return `${beatGuidance}${intensityGuidance}${styleGuidance}情绪要一拍一拍往上推；只有当前场景已经放行 explicit 时才继续更露骨，否则只维持暧昧和调情。`;
  }
  if (interpretation.adultIntent === "flirt_tease") {
    return "保持会撩和恋人感，可以轻轻补一点贴近的画面和情绪推进，但不要把轻暧昧直接写成露骨床戏。";
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
  const explicitAdultMode =
    interpretation.adultIntent === "sexual_invite" ||
    interpretation.adultIntent === "explicit_scene_continue" ||
    interpretation.adultIntent === "dominant_command" ||
    interpretation.adultIntent === "scene_repair";
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
  if (explicitAdultMode) {
    extra.push("当前 explicit 已放行：短句优先，但短句不等于只回一句；至少写出承接、当下反应和下一拍推进。");
  }
  return [base, ...extra].join("；");
}
