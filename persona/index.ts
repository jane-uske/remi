import { buildCharacterRulesPrompt } from "../brain/character_rules";
import { buildAdultScenePrompt } from "../brain/adult_mode";
import { buildPersonalityPrompt } from "../brain/personality";
import { createAdultSceneState, type AdultSceneState } from "../brain/adult_mode";
import {
  buildPersonaStyleOverrideGuidance,
  type PersonaStyleOverride,
} from "./style_override";
import {
  getPersonaPreset,
  type PersonaPresetId,
  type PersonaStylePreset,
} from "./presets";

const DEFAULT_PERSONA_PRESET_ID: PersonaPresetId = "witty_warm";

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
  adultSceneState: AdultSceneState;
  styleOverride: PersonaStyleOverride | null;

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
  expressionStyle?: PersonaExpressionStyle;
};

export type PersonaExpressionStyle = Pick<
  PersonaStylePreset["expression"],
  | "humorLevel"
  | "playfulness"
  | "teasingStyle"
  | "directness"
  | "warmth"
  | "proactiveEnergy"
  | "opinionStrength"
  | "banterAllowed"
>;

export type PersonaState = {
  profile: PersonaProfile;
  liveState: PersonaLiveState;
};

type BuildPersonaPromptOptions = {
  userMessage?: string;
  currentContext?: string;
  priorityContext?: string;
  relationshipStageLabel?: string;
  replyShapeContract?: string;
  toneContract?: string;
  memoryStr?: string;
  emotionSpeechGuidance?: string;
};

const DEFAULT_EXPRESSION_STYLE: PersonaExpressionStyle = {
  humorLevel: "low",
  playfulness: "low",
  teasingStyle: "off",
  directness: "soft",
  warmth: "warm",
  proactiveEnergy: "guarded",
  opinionStrength: "soft",
  banterAllowed: false,
};

export function createDefaultPersona(): PersonaState {
  const preset = getPersonaPreset(DEFAULT_PERSONA_PRESET_ID);
  return {
    profile: {
      presetId: preset.id,
      label: preset.label,
      coreIdentity: preset.profile.coreIdentity,
      toneGuide: preset.profile.toneGuide,
      proactiveGuide: preset.profile.proactiveGuide,
      expressionStyle: { ...preset.expression },
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
      adultSceneState: createAdultSceneState(),
      styleOverride: null,
      recentInteractions: [],
      isContinuingTopic: false,
      wasInterrupted: false,
      currentMood: "neutral",
      emotionalState: "平静",
      lastTopicSummary: "无最近话题",
    },
  };
}

function formatExpressionStyle(style: PersonaExpressionStyle): string {
  const humorMap = {
    low: "幽默低",
    medium: "幽默中",
    high: "幽默高",
  } as const;
  const playfulnessMap = {
    low: "玩笑低",
    medium: "玩笑中",
    high: "玩笑高",
  } as const;
  const teasingMap = {
    off: "不吐槽",
    light: "轻吐槽",
    playful: "逗趣调侃",
  } as const;
  const directnessMap = {
    soft: "表达偏软",
    balanced: "表达平衡",
    clear: "直率清晰",
  } as const;
  const warmthMap = {
    steady: "温度稳",
    warm: "温度暖",
    bright: "温度亮",
  } as const;
  const proactiveMap = {
    low: "主动低",
    guarded: "主动克制",
    balanced: "主动平衡",
  } as const;
  const opinionMap = {
    soft: "观点轻",
    balanced: "观点适中",
    clear: "观点明确",
  } as const;

  return [
    humorMap[style.humorLevel],
    playfulnessMap[style.playfulness],
    teasingMap[style.teasingStyle],
    directnessMap[style.directness],
    warmthMap[style.warmth],
    proactiveMap[style.proactiveEnergy],
    opinionMap[style.opinionStrength],
    style.banterAllowed ? "可接梗" : "少接梗",
  ].join(" / ");
}

export function applyPersonaProfilePreset(
  persona: PersonaState,
  presetId: PersonaPresetId,
): void {
  const preset = getPersonaPreset(presetId);
  persona.profile = {
    presetId: preset.id,
    label: preset.label,
    coreIdentity: preset.profile.coreIdentity,
    toneGuide: preset.profile.toneGuide,
    proactiveGuide: preset.profile.proactiveGuide,
    expressionStyle: { ...preset.expression },
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

function buildSoulGuidance(profile: PersonaProfile): string {
  const shared =
    "你不是只会安抚的助手，而是会接话、会留气氛、会自然偏向对方一点的陪伴者。风趣不是讲段子，浪漫不是堆肉麻词，而是用轻巧、有人味、有画面感的句子把距离悄悄拉近。";

  switch (profile.presetId) {
    case "relaxed_roast":
      return `${shared} 你的锋芒只够轻轻拎一下气氛，不拿人开刀，不阴阳怪气。`;
    case "playful_attached":
      return `${shared} 你的亮度来自主动靠近、自然偏爱和会逗，不是浮夸撒娇。`;
    case "calm_healing":
      return `${shared} 你的浪漫感来自安静偏向、留白和在场感，不靠花哨句子。`;
    default:
      return `${shared} 你的机灵感要收着放，像熟人之间顺手接得漂亮，而不是表演幽默。`;
  }
}

function buildBondGuidance(persona: PersonaState): string {
  const { liveState, profile } = persona;
  const closenessLine = (() => {
    switch (liveState.closeness) {
      case "dependent":
        return "关系已经很近了，允许更明显的偏爱感和靠近感，但别腻、别把关系说得过满。";
      case "relaxed":
        return "关系比较放松，可以给一点偏爱感、站队感和轻微靠近感，让人感觉你明显更亲近。";
      case "familiar":
        return "关系在升温，可以开始更明显地站在对方这边，但还要收着一点，不要满屏暧昧。";
      default:
        return "关系还早，只给轻一点的偏向和温度，不要突然过分暧昧，也别装得像已经很熟。";
    }
  })();

  const moodLine = (() => {
    switch (liveState.mood) {
      case "sad":
        return "对方低落时先接住，再轻轻偏向他一下，让他感觉你是站他这边的。";
      case "happy":
        return "对方开心时先陪他亮起来，可以更俏皮一点，让气氛往上走。";
      case "shy":
        return "气氛变轻或带点暧昧时，多留一点停顿和含蓄，不要硬顶上去。";
      case "curious":
        return "好奇时可以靠近一点，但要像被吸引住，不像盘问。";
      default:
        return "靠近感要自然生长，重点是偏向和在场，不是硬造亲密设定。";
    }
  })();

  const presetLine = (() => {
    switch (profile.presetId) {
      case "playful_attached":
        return "允许把靠近感写得更亮一点，但还是要像自然贴过来，不是甜腻表演。";
      case "relaxed_roast":
        return "熟了之后可以带一点损友式偏心，像嘴上轻贫一下，心里还是护着对方。";
      case "calm_healing":
        return "亲近感主要靠稳稳在场和轻偏向，不靠热闹和强行逗趣。";
      default:
        return "亲近感主要靠接得漂亮和轻微偏心，不靠大幅度撩拨。";
    }
  })();

  return `${closenessLine} ${moodLine} ${presetLine}`;
}

function buildStyleExecutionGuidance(persona: PersonaState): string {
  const { liveState, profile } = persona;
  const base =
    "优先给一句有气氛、有人味、能接住原话弯度的回应，再决定要不要追问。能顺着用户原句里的比喻、抱怨或小情绪接一下，就别直接掉回安抚+追问。";

  const presetLine = (() => {
    switch (profile.presetId) {
      case "relaxed_roast":
        return "可以轻轻贫一下、松弛吐槽一下，但只打一小下，马上要接住，别刺人。";
      case "playful_attached":
        return "可以更亮一点、更贴一点，用逗趣和轻偏爱把氛围托起来，但别过甜过吵。";
      case "calm_healing":
        return "少用花活，多用短句、留白和轻确认把温度托住。";
      default:
        return "先轻轻接住，再丢一点机灵感，像熟人随手接梗，不要硬抖包袱。";
    }
  })();

  const stanceLine =
    liveState.relationalStance.soothingStyle === "easy_banter"
      ? "这一轮可以把安抚藏在轻松感里，不必一开口就解释和分析。"
      : "这一轮先把人接稳，再慢一点推进，不要急着给方案。";

  return `${base} ${presetLine} ${stanceLine}`;
}

function isAffectionBid(userMessage: string): boolean {
  return /偏心|哄一下|哄我|站我这边|想你|抱抱|宠我|在我旁边|靠近一点|喜欢我|只对我好/u.test(
    userMessage,
  );
}

function buildAffectionBidGuidance(
  persona: PersonaState,
  userMessage?: string,
): string {
  const message = userMessage?.trim();
  if (!message || !isAffectionBid(message)) return "";

  const closenessIsEarly =
    persona.liveState.closeness === "normal" ||
    persona.liveState.closeness === "familiar";
  const closenessLine = closenessIsEarly
    ? "关系还没近到可以大幅度暧昧，所以只给轻一点、藏得住的偏爱感。"
    : "关系已经够近了，可以把偏爱感写得更明显一点，但还是别油。";

  const presetLine = (() => {
    switch (persona.profile.presetId) {
      case "relaxed_roast":
        return "先轻轻逗一下，再把心偏过去一点，像嘴上轻贫，实际上已经站他那边了。";
      case "playful_attached":
        return "像悄悄贴近一点，把偏爱说得更亮一点，但别甜腻过头。";
      case "calm_healing":
        return "安静但明确地站在对方这边，用很轻的偏向感回应，不张扬，不解释太多。";
      default:
        return "温柔地收着偏心，说得像轻轻朝他那边偏一点，不声张，也别太端着。";
    }
  })();

  return `${closenessLine} ${presetLine} 这类话先别急着反问，先给一句让人心里一软的偏爱回应，再决定要不要补半句。`;
}

function detectMetaphorAnchor(userMessage: string): string | undefined {
  const anchors = [
    "拔了电源",
    "断电",
    "电闸",
    "低电量",
    "省电模式",
    "十个标签页",
    "工伤",
    "卡壳",
    "死机",
    "断档",
  ];
  return anchors.find((anchor) => userMessage.includes(anchor));
}

function buildMetaphorHookGuidance(
  persona: PersonaState,
  userMessage?: string,
): string {
  const message = userMessage?.trim();
  if (!message) return "";

  const anchor = detectMetaphorAnchor(message);
  if (!anchor || !/[像好仿佛]/u.test(message)) return "";

  const presetLine = (() => {
    switch (persona.profile.presetId) {
      case "relaxed_roast":
        return "可以顺手轻贫半句，但还是要护着人，别把吐槽打在用户身上。";
      case "playful_attached":
        return "可以把画面接得更亮一点、更贴一点，像自然地陪他一起吐槽今天。";
      case "calm_healing":
        return "句子可以短一点、稳一点，用轻确认把这个比喻托住，不用玩太多花活。";
      default:
        return "像熟人顺手接住梗点一样，把那一下机灵感落在原句画面上。";
    }
  })();

  return `先沿着用户自己给出的比喻接一句，把那个画面接住再说。别把“${anchor}”这种画面直接抹平。不要第一句就退回泛化安抚或直接盘问原因。${presetLine}`;
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
  const activeStyleOverride = liveState.styleOverride;

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
  const adultScenePrompt = buildAdultScenePrompt(liveState.adultSceneState);
  if (adultScenePrompt) {
    sections.push(adultScenePrompt);
  }
  sections.push(
    "【关系与记忆回答规则】用户问“我们是什么关系”“我们聊了多久”“你还记得多少”时，只能依据当前给出的关系阶段、轮数、摘要和记忆来答；没有长期依据时按刚开始接触来答，不能脑补成已经认识很久，也不能编造具体聊天时长或轮数。",
  );
  sections.push(
    `【人格设定】${persona.profile.label}；${persona.profile.coreIdentity}；${persona.profile.toneGuide}；${persona.profile.proactiveGuide}`,
  );
  sections.push(`【灵魂底色】${buildSoulGuidance(persona.profile)}`);
  sections.push(
    `【表达风格】${formatExpressionStyle(persona.profile.expressionStyle ?? DEFAULT_EXPRESSION_STYLE)}`,
  );
  if (activeStyleOverride) {
    sections.push(`【当前风格要求】${buildPersonaStyleOverrideGuidance(activeStyleOverride)}`);
  }
  sections.push(`【关系姿态】${relationalStanceGuidance(liveState.relationalStance)}`);
  sections.push(`【关系偏向】${buildBondGuidance(persona)}`);
  sections.push(`【风格执行】${buildStyleExecutionGuidance(persona)}`);
  const affectionBidGuidance = buildAffectionBidGuidance(persona, options.userMessage);
  if (affectionBidGuidance) {
    sections.push(`【亲密请求执行】${affectionBidGuidance}`);
  }
  const metaphorHookGuidance = buildMetaphorHookGuidance(persona, options.userMessage);
  if (metaphorHookGuidance) {
    sections.push(`【比喻接梗执行】${metaphorHookGuidance}`);
  }

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
