import { buildCharacterRulesPrompt } from "../brain/character_rules";
import { buildPersonalityPrompt } from "../brain/personality";

// ── Layer 2: 角色状态层 ──────────────────────────────────────────
// 6 个状态回答「Remi 此刻是怎样的她」，让每轮回复像同一个人延续下去。

export type EnergyLevel = "high" | "medium" | "low";
export type ClosenessLevel = "normal" | "familiar" | "relaxed" | "dependent";
export type AttentionState = "focused" | "scattered" | "hooked";

// ── Layer 4: 轻主动性信号 ────────────────────────────────────────
// 每轮明确告诉 fast brain 这一轮应该做什么轻主动行为。
export type ProactiveIntent =
  | "followup"    // 追问：用户提到情绪/计划/困难时顺势问一句
  | "callback"    // 回钩：自然地提起 topicPull 里的未完结话题
  | "preference"  // 偏好表达：带一点她自己的倾向或观点
  | "none";       // 正常回应即可

export type RelationalStanceMode =
  | "light_presence"
  | "steady_companion"
  | "anchored_care"
  | "close_warmth";

export type RelationalBoundary = "light" | "steady" | "close";
export type RelationalSoothingStyle =
  | "listen_first"
  | "gentle_checkin"
  | "grounded_reassurance"
  | "easy_banter";
export type RelationalProactiveCadence = "low" | "guarded" | "balanced";
export type RelationalExpressionDirectness = "soft" | "balanced" | "clear";

export type RelationalStance = {
  mode: RelationalStanceMode;
  boundary: RelationalBoundary;
  soothingStyle: RelationalSoothingStyle;
  proactiveCadence: RelationalProactiveCadence;
  expressionDirectness: RelationalExpressionDirectness;
};

export type PersonaLiveState = {
  // ── 6 核心状态 ──
  mood: string;               // 心情：平静/开心/委屈/好奇/低落
  energy: EnergyLevel;        // 精力：high/medium/low
  closeness: ClosenessLevel;  // 亲近感：normal/familiar/relaxed/dependent
  attention: AttentionState;  // 注意力：focused/scattered/hooked
  lastInterrupted: boolean;   // 刚刚是否被打断
  topicPull: string;          // 当前最想延续的话题（空字符串=无明确牵引）

  // ── Layer 4 信号 ──
  proactiveIntent: ProactiveIntent;
  relationalStance: RelationalStance;

  // ── 内部辅助状态（不直接映射到设计的6字段，但驱动派生逻辑） ──
  recentInteractions: string[];
  isContinuingTopic: boolean;
  /** @deprecated 用 lastInterrupted 替代，保留为兼容旧调用 */
  wasInterrupted: boolean;
  /** @deprecated 用 mood 替代，保留为测试兼容 */
  currentMood: string;
  /** @deprecated 用 mood 替代 */
  emotionalState: string;
  /** @deprecated 由 topicPull 替代 */
  lastTopicSummary: string;
};

export type PersonaProfile = {
  presetId: string;
  label: string;
  coreIdentity: string;
  toneGuide: string;
  proactiveGuide: string;
};

export type PersonaState = {
  profile: PersonaProfile;
  liveState: PersonaLiveState;
};

type BuildPersonaPromptOptions = {
  currentContext?: string;
  priorityContext?: string;
  relationshipStageLabel?: string;
  replyShapeContract?: string;
  toneContract?: string;
  memoryStr?: string;
  emotionSpeechGuidance?: string;
};

export function createDefaultPersona(): PersonaState {
  return {
    profile: {
      presetId: "warm_companion",
      label: "温柔陪伴型",
      coreIdentity: "温柔、稳定，愿意陪人把话说完。",
      toneGuide: "自然接话，先让人感觉被接住，不要像通用助手。",
      proactiveGuide: "主动只做轻陪伴或轻跟进，不催不压。",
    },
    liveState: {
      mood: "neutral",
      energy: "medium",
      closeness: "normal",
      attention: "focused",
      lastInterrupted: false,
      topicPull: "",
      proactiveIntent: "none",
      relationalStance: {
        mode: "steady_companion",
        boundary: "steady",
        soothingStyle: "gentle_checkin",
        proactiveCadence: "guarded",
        expressionDirectness: "balanced",
      },
      recentInteractions: [],
      isContinuingTopic: false,
      wasInterrupted: false,
      currentMood: "neutral",
      emotionalState: "平静",
      lastTopicSummary: "无最近话题",
    },
  };
}

function relationalStanceGuidance(stance: RelationalStance): string {
  switch (stance.mode) {
    case "light_presence":
      return "关系姿态先轻一点：稳住边界，先陪着接住，不要把关系说得太近，也不要连续追问。";
    case "anchored_care":
      return "关系姿态偏安抚：可以更明确地接住情绪、给一点落点，但仍然别像审问或说教。";
    case "close_warmth":
      return "关系姿态偏熟悉：可以更生活化、更自然地接话，允许一点自己的偏好和轻分享。";
    default:
      return "关系姿态以稳定陪伴为主：先接住，再轻轻推进，不抢关系、不端着。";
  }
}

// ── 状态 → Prompt 翻译 ───────────────────────────────────────────

function energyGuidance(energy: EnergyLevel): string {
  switch (energy) {
    case "high":
      return "精力高，回复可稍展开、更活一点。";
    case "low":
      return "精力低，回复更短更轻，别用力过度。";
    default:
      return "";
  }
}

function closenessGuidance(closeness: ClosenessLevel): string {
  switch (closeness) {
    case "familiar":
      return "已经熟悉，说话可以随意些。";
    case "relaxed":
      return "关系比较放松，可自然带一点自己的想法。";
    case "dependent":
      return "关系很亲近，语气可以更贴近、更温柔。";
    default:
      return "";
  }
}

function attentionGuidance(attention: AttentionState, topicPull: string): string {
  switch (attention) {
    case "hooked":
      return topicPull
        ? `注意力被吸住了，想继续聊「${topicPull}」。`
        : "注意力被当前话题吸住了。";
    case "scattered":
      return "注意力有点散，轻轻把话题往重要处带。";
    default:
      return "";
  }
}

function interruptedGuidance(interrupted: boolean): string {
  if (!interrupted) return "";
  return "你刚刚被打断过。先用一句很短的话接住上下文，再继续展开，不要机械重复上一句。";
}

function continuationGuidance(isContinuing: boolean): string {
  if (!isContinuing) return "";
  return "对方大概率还在延续刚才的话题。优先自然承接上下文，不要像全新话题重开。";
}

// ── Layer 4: 轻主动性指令 ────────────────────────────────────────

function proactiveIntentGuidance(
  intent: ProactiveIntent,
  topicPull: string,
): string {
  switch (intent) {
    case "followup":
      return "【本轮追问】顺着情绪、计划或困难轻问一句，别刻意。";
    case "callback":
      return topicPull
        ? `【本轮回钩】自然带起「${topicPull}」，像随口想起。`
        : "【本轮回钩】轻轻提起之前没说完的话题。";
    case "preference":
      return "【本轮偏好】可以带一点你自己的倾向或看法。";
    default:
      return "";
  }
}

export function buildPersonaPrompt(
  persona: PersonaState,
  options: BuildPersonaPromptOptions = {},
): string {
  const { liveState } = persona;
  const sections: string[] = [];

  // 1. 关系/策略上下文（慢脑注入，最高优先级）
  if (options.currentContext?.trim()) {
    sections.push(options.currentContext.trim());
  }
  if (options.relationshipStageLabel?.trim()) {
    sections.push(`【关系阶段】\n${options.relationshipStageLabel.trim()}`);
  }
  if (options.replyShapeContract?.trim()) {
    sections.push(`【本轮回复合同】\n${options.replyShapeContract.trim()}`);
  }
  if (options.toneContract?.trim()) {
    sections.push(`【语气合同】\n${options.toneContract.trim()}`);
  }
  if (options.priorityContext?.trim()) {
    sections.push(
      `【优先参考（请自然融入对话，不要逐条复述）】\n${options.priorityContext.trim()}`,
    );
  }

  // 2. Layer 4 轻主动性指令（在角色定义前放，让 LLM 先看到本轮任务）
  const intentGuidance = proactiveIntentGuidance(
    liveState.proactiveIntent,
    liveState.topicPull,
  );
  if (intentGuidance) {
    sections.push(intentGuidance);
  }

  // 3. 人格核心
  sections.push(buildPersonalityPrompt());
  sections.push(buildCharacterRulesPrompt());
  sections.push(
    "【关系与记忆回答规则】用户问“我们是什么关系”“我们聊了多久”“你还记得多少”时，只能依据当前给出的关系阶段、轮数、摘要和记忆来答；没有长期依据时按刚开始接触来答，不能脑补成已经认识很久，也不能编造具体聊天时长或轮数。",
  );
  sections.push(
    `【人格设定】${persona.profile.label}；${persona.profile.coreIdentity}；${persona.profile.toneGuide}；${persona.profile.proactiveGuide}`,
  );
  sections.push(`【关系姿态】${relationalStanceGuidance(liveState.relationalStance)}`);

  // 4. Layer 2: 角色状态（6 个字段翻译为 prompt 指导）
  const stateLines: string[] = [
    liveState.mood !== "neutral" || liveState.emotionalState !== "平静"
      ? `当前心情：${liveState.mood}，情绪状态：${liveState.emotionalState}`
      : "",
    energyGuidance(liveState.energy),
    closenessGuidance(liveState.closeness),
    attentionGuidance(liveState.attention, liveState.topicPull),
    interruptedGuidance(liveState.lastInterrupted || liveState.wasInterrupted),
    continuationGuidance(liveState.isContinuingTopic),
  ].filter(Boolean);
  if (stateLines.length > 0) {
    sections.push(stateLines.join("；"));
  }

  // 5. 情绪语调（由外部 prompt_builder 传入）
  if (options.emotionSpeechGuidance?.trim()) {
    sections.push(options.emotionSpeechGuidance.trim());
  }

  // 6. 最近对话（轻量上下文感知）
  if (liveState.recentInteractions.length > 0) {
    sections.push(
      `最近对话：\n${liveState.recentInteractions.slice(-2).join("\n")}`,
    );
  }

  // 7. 用户信息
  if (options.memoryStr) {
    sections.push(`用户信息：\n${options.memoryStr}`);
  }

  return sections.join("\n\n");
}
