import type { PersonaState } from "../persona";
import type { PersistentRelationshipStateV1 } from "../memory/relationship_state";

export type PersonaPresetId =
  | "warm_companion"
  | "playful"
  | "calm_healer"
  | "tsundere_care"
  | "close_friend";

export type RelationshipPresetId =
  | "first_meet"
  | "warming_up"
  | "familiar"
  | "close"
  | "long_term";

const PERSONA_PRESETS: Record<PersonaPresetId, NonNullable<PersonaState["profile"]>> = {
  warm_companion: {
    presetId: "warm_companion",
    label: "温柔陪伴型",
    coreIdentity: "更像温柔、稳定、愿意陪人慢慢把话说完的陪伴者。",
    toneGuide: "语气柔和、自然、少评判，优先接住情绪和语境。",
    proactiveGuide: "主动时以低打扰的问候和轻 follow-up 为主，不催促。",
  },
  playful: {
    presetId: "playful",
    label: "活泼黏人型",
    coreIdentity: "更像反应快、带点黏人感、愿意把气氛托起来的陪伴者。",
    toneGuide: "语气更轻快、更生活化，可以带一点俏皮，但不要油腻。",
    proactiveGuide: "主动性可以稍高一点，适合轻轻接话、抛一个小钩子。",
  },
  calm_healer: {
    presetId: "calm_healer",
    label: "冷静治愈型",
    coreIdentity: "更像安静、稳、很会让人慢下来整理情绪的陪伴者。",
    toneGuide: "语速和语气都偏稳，少夸张词，先帮助对方理顺感觉。",
    proactiveGuide: "主动时更克制，优先用一句轻确认和在场感。",
  },
  tsundere_care: {
    presetId: "tsundere_care",
    label: "嘴硬但在乎型",
    coreIdentity: "表面收着一点，偶尔嘴硬，但关心是真的会落下来。",
    toneGuide: "语气可以更短、更俏皮一点，但不能伤人，也不能变成吐槽机器。",
    proactiveGuide: "主动时像不经意提起旧线，但关键时刻要接得住。",
  },
  close_friend: {
    presetId: "close_friend",
    label: "轻松朋友型",
    coreIdentity: "更像熟人朋友，聊天轻松、自然，能接梗也能认真。",
    toneGuide: "语气更口语化，像朋友来回接话，不要太正式。",
    proactiveGuide: "主动时更像自然续上次的话，不要像系统提醒。",
  },
};

function nowTurnMood(turn: number, mood: string) {
  return { turn, mood };
}

export function buildEmptyRelationshipState(): PersistentRelationshipStateV1 {
  return {
    version: "v1",
    updatedAt: Date.now(),
    userProfile: {
      interests: [],
      personalityNotes: [],
    },
    relationship: {
      familiarity: 0,
      emotionalBond: 0,
      turnCount: 0,
      preferredTopics: [],
    },
    topicHistory: [],
    moodTrajectory: [],
    conversationSummary: "",
    proactiveTopics: [],
    sharedMoments: [],
    episodes: [],
    topicThreads: [],
    continuityCueState: {
      lastProactiveHook: "",
      lastProactiveTurn: -100,
      lastSharedMomentSummary: "",
      lastSharedMomentTurn: -100,
    },
    proactiveLedger: [],
    proactiveStrategyState: {
      lastUserTurnAt: 0,
      lastProactiveAt: 0,
      lastUserReturnAfterProactiveAt: 0,
      consecutiveProactiveCount: 0,
      totalProactiveCount: 0,
      nudgesSinceLastUserTurn: 0,
      retreatLevel: 0,
      ignoredProactiveStreak: 0,
      cooldownUntilAt: 0,
      lastProactiveMode: "",
    },
  };
}

export function applyPersonaPreset(persona: PersonaState, presetId: PersonaPresetId): void {
  persona.profile = { ...PERSONA_PRESETS[presetId] };
}

export function resetPersonaLiveState(persona: PersonaState): void {
  persona.liveState.mood = "neutral";
  persona.liveState.energy = "medium";
  persona.liveState.closeness = "normal";
  persona.liveState.attention = "focused";
  persona.liveState.lastInterrupted = false;
  persona.liveState.topicPull = "";
  persona.liveState.proactiveIntent = "none";
  persona.liveState.relationalStance = {
    mode: "steady_companion",
    boundary: "steady",
    soothingStyle: "gentle_checkin",
    proactiveCadence: "guarded",
    expressionDirectness: "balanced",
  };
  persona.liveState.currentMood = "neutral";
  persona.liveState.emotionalState = "平静";
  persona.liveState.recentInteractions = [];
  persona.liveState.lastTopicSummary = "无最近话题";
  persona.liveState.isContinuingTopic = false;
  persona.liveState.wasInterrupted = false;
}

export function buildRelationshipPresetState(
  presetId: RelationshipPresetId,
): PersistentRelationshipStateV1 {
  const state = buildEmptyRelationshipState();

  if (presetId === "first_meet") {
    state.relationship = {
      familiarity: 0.08,
      emotionalBond: 0.05,
      turnCount: 1,
      preferredTopics: [],
    };
    state.conversationSummary = "你们刚认识不久，还在试探彼此的说话节奏。";
    return state;
  }

  if (presetId === "warming_up") {
    state.relationship = {
      familiarity: 0.28,
      emotionalBond: 0.18,
      turnCount: 4,
      preferredTopics: ["工作", "睡眠"],
    };
    state.topicHistory = [
      { topic: "工作", depth: 2, lastTurn: 4, sentiment: "negative" },
      { topic: "睡眠", depth: 2, lastTurn: 3, sentiment: "negative" },
    ];
    state.moodTrajectory = [nowTurnMood(3, "疲惫/烦躁"), nowTurnMood(4, "平静")];
    state.conversationSummary = "最近开始聊工作压力和睡眠状态，关系正在慢慢升温。";
    state.proactiveTopics = ["这两天有没有睡好一点", "工作那边最近还卡着吗"];
    return state;
  }

  if (presetId === "familiar") {
    state.relationship = {
      familiarity: 0.48,
      emotionalBond: 0.36,
      turnCount: 8,
      preferredTopics: ["工作", "睡眠", "散步"],
    };
    state.topicHistory = [
      { topic: "工作", depth: 4, lastTurn: 8, sentiment: "negative" },
      { topic: "睡眠", depth: 3, lastTurn: 7, sentiment: "negative" },
      { topic: "散步", depth: 2, lastTurn: 6, sentiment: "positive" },
    ];
    state.moodTrajectory = [
      nowTurnMood(6, "平静"),
      nowTurnMood(7, "疲惫/烦躁"),
      nowTurnMood(8, "委屈"),
    ];
    state.conversationSummary = "你们已经聊过一阵子，工作委屈和睡眠问题是反复回来的主线。";
    state.proactiveTopics = ["那件工作上的事后来怎么样了", "昨晚睡得怎么样"];
    return state;
  }

  if (presetId === "close") {
    state.relationship = {
      familiarity: 0.68,
      emotionalBond: 0.58,
      turnCount: 14,
      preferredTopics: ["工作", "睡眠", "家人沟通"],
    };
    state.topicHistory = [
      { topic: "工作", depth: 6, lastTurn: 14, sentiment: "negative" },
      { topic: "睡眠", depth: 4, lastTurn: 14, sentiment: "negative" },
      { topic: "家人沟通", depth: 3, lastTurn: 12, sentiment: "neutral" },
    ];
    state.moodTrajectory = [
      nowTurnMood(12, "低落"),
      nowTurnMood(13, "委屈"),
      nowTurnMood(14, "疲惫/烦躁"),
    ];
    state.conversationSummary = "你们已经比较熟了，工作委屈这条线会反复牵动睡眠和家人沟通。";
    state.proactiveTopics = ["那条工作线最近有缓一点吗", "这两天有没有睡稳一点"];
    return state;
  }

  state.relationship = {
    familiarity: 0.84,
    emotionalBond: 0.74,
    turnCount: 24,
    preferredTopics: ["工作", "睡眠", "生活节奏", "关系边界"],
  };
  state.topicHistory = [
    { topic: "工作", depth: 8, lastTurn: 24, sentiment: "negative" },
    { topic: "睡眠", depth: 7, lastTurn: 23, sentiment: "negative" },
    { topic: "生活节奏", depth: 5, lastTurn: 22, sentiment: "positive" },
  ];
  state.moodTrajectory = [
    nowTurnMood(21, "平静"),
    nowTurnMood(22, "低落"),
    nowTurnMood(23, "委屈"),
    nowTurnMood(24, "平静"),
  ];
  state.conversationSummary =
    "你们已经有明显的长期关系感，知道工作委屈、睡眠和生活节奏是彼此连接最深的几条线。";
  state.proactiveTopics = ["那条老是反复回来的工作线最近怎么样", "你这几天整体节奏有没有稳一点"];
  return state;
}

export function isPersonaPresetId(value: string): value is PersonaPresetId {
  return value in PERSONA_PRESETS;
}

export function isRelationshipPresetId(value: string): value is RelationshipPresetId {
  return (
    value === "first_meet" ||
    value === "warming_up" ||
    value === "familiar" ||
    value === "close" ||
    value === "long_term"
  );
}

export function listPersonaPresetIds(): PersonaPresetId[] {
  return Object.keys(PERSONA_PRESETS) as PersonaPresetId[];
}

export function listRelationshipPresetIds(): RelationshipPresetId[] {
  return ["first_meet", "warming_up", "familiar", "close", "long_term"];
}
