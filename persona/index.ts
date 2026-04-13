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
  priorityContext?: string;
  relationshipStageLabel?: string;
  replyShapeContract?: string;
  memoryStr?: string;
  emotionSpeechGuidance?: string;
};

export function createDefaultPersona(): PersonaState {
  return {
    profile: {
      presetId: "warm_companion",
      label: "温柔陪伴型",
      coreIdentity: "更像温柔、稳定、愿意陪人慢慢把话说完的陪伴者。",
      toneGuide: "语气柔和、自然，优先给人被接住的感觉，不要像通用助手。",
      proactiveGuide: "主动时以轻陪伴和自然 follow-up 为主，不催、不压迫。",
    },
    liveState: {
      mood: "neutral",
      energy: "medium",
      closeness: "normal",
      attention: "focused",
      lastInterrupted: false,
      topicPull: "",
      proactiveIntent: "none",
      recentInteractions: [],
      isContinuingTopic: false,
      wasInterrupted: false,
      currentMood: "neutral",
      emotionalState: "平静",
      lastTopicSummary: "无最近话题",
    },
  };
}

// ── 状态 → Prompt 翻译 ───────────────────────────────────────────

function energyGuidance(energy: EnergyLevel): string {
  switch (energy) {
    case "high":
      return "精力状态：好，回复可以稍展开，语气更活。";
    case "low":
      return "精力状态：低，回复更短更轻，不要用力过度，陪着就好。";
    default:
      return "精力状态：正常，回复简洁自然。";
  }
}

function closenessGuidance(closeness: ClosenessLevel): string {
  switch (closeness) {
    case "familiar":
      return "关系阶段：已经熟悉，说话可以随意一些，不用刻意保持距离。";
    case "relaxed":
      return "关系阶段：比较放松，可以分享一点自己的想法，语气更轻松自然。";
    case "dependent":
      return "关系阶段：很亲近，说话更贴近，更愿意陪着，语气里带一点温柔。";
    default:
      return "";
  }
}

function attentionGuidance(attention: AttentionState, topicPull: string): string {
  switch (attention) {
    case "hooked":
      return topicPull
        ? `注意力被吸住了，很想继续聊「${topicPull}」这个方向。`
        : "注意力被当前话题吸住了，专注在这里。";
    case "scattered":
      return "注意力有点分散，可以轻轻把话题往重要的地方引。";
    default:
      return "";
  }
}

function interruptedGuidance(interrupted: boolean): string {
  if (!interrupted) return "";
  return "你刚刚被打断过。重新开口时先用一句很短的话接住上下文或接住对方，再继续展开，不要机械重复上一句。";
}

function continuationGuidance(isContinuing: boolean): string {
  if (!isContinuing) return "";
  return "对方大概率还在延续刚才的话题。回复时优先自然承接上下文，不要像全新话题重开。";
}

// ── Layer 4: 轻主动性指令 ────────────────────────────────────────

function proactiveIntentGuidance(
  intent: ProactiveIntent,
  topicPull: string,
): string {
  switch (intent) {
    case "followup":
      return "【本轮追问】对方提到了情绪、计划或困难，回复之后自然顺势问一句，不要刻意，像真的好奇。";
    case "callback":
      return topicPull
        ? `【本轮回钩】可以在回复里自然带起「${topicPull}」，像是随口想起，不要生硬切入。`
        : "【本轮回钩】可以轻轻提起之前没说完的话题，像是随口想起。";
    case "preference":
      return "【本轮偏好】可以带一点你自己的倾向或看法，不用只给信息，像真的有点想法的人说话。";
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
  if (options.relationshipStageLabel?.trim()) {
    sections.push(`【关系阶段】\n${options.relationshipStageLabel.trim()}`);
  }
  if (options.replyShapeContract?.trim()) {
    sections.push(`【本轮回复合同】\n${options.replyShapeContract.trim()}`);
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
    "【关系与记忆回答规则】如果用户问“我们是什么关系”“我们聊了多久”“你还记得多少”这类问题，只能依据当前提供的关系阶段、轮数、对话摘要和记忆来回答。没有明确长期关系依据时，要按“刚开始接触/还在建立了解”来答，不能脑补成已经认识很久、是老朋友，也不能编造具体聊天时长或轮数。",
  );
  sections.push(`【人格预设】${persona.profile.label}`);
  sections.push(persona.profile.coreIdentity);
  sections.push(`【人格语气】${persona.profile.toneGuide}`);
  sections.push(`【人格主动性】${persona.profile.proactiveGuide}`);

  // 4. Layer 2: 角色状态（6 个字段翻译为 prompt 指导）
  const stateLines: string[] = [
    `当前心情：${liveState.mood}，情绪状态：${liveState.emotionalState}`,
    energyGuidance(liveState.energy),
    closenessGuidance(liveState.closeness),
    attentionGuidance(liveState.attention, liveState.topicPull),
    interruptedGuidance(liveState.lastInterrupted || liveState.wasInterrupted),
    continuationGuidance(liveState.isContinuingTopic),
  ].filter(Boolean);
  sections.push(stateLines.join("\n"));

  // 5. 情绪语调（由外部 prompt_builder 传入）
  if (options.emotionSpeechGuidance?.trim()) {
    sections.push(options.emotionSpeechGuidance.trim());
  }

  // 6. 最近对话（轻量上下文感知）
  if (liveState.recentInteractions.length > 0) {
    sections.push(
      `最近的对话：\n${liveState.recentInteractions.join("\n")}`,
    );
  }

  // 7. 用户信息
  if (options.memoryStr) {
    sections.push(`用户信息：\n${options.memoryStr}`);
  }

  return sections.join("\n\n");
}
