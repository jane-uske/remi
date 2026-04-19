import { applyPersonaProfilePreset, type PersonaState } from "../persona";
import type { PersistentRelationshipStateV1 } from "../memory/relationship_state";
import { createAdultSceneState } from "../brain/adult_mode";
import type { PersonaPresetId } from "../persona/presets";
import {
  getPersonaPreset,
  isPersonaPresetId as isPersonaPresetIdFromRegistry,
  listPersonaPresets,
} from "../persona/presets";
export type { PersonaPresetId } from "../persona/presets";

export type RelationshipPresetId =
  | "first_meet"
  | "warming_up"
  | "familiar"
  | "close"
  | "long_term";

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
      responseStyleNotes: [],
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
  applyPersonaProfilePreset(persona, presetId);
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
  persona.liveState.adultSceneState = createAdultSceneState();
  persona.liveState.styleOverride = null;
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

export { getPersonaPreset, listPersonaPresets, isPersonaPresetIdFromRegistry as isPersonaPresetId };

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
  return listPersonaPresets().map((preset) => preset.id);
}

export function listRelationshipPresetIds(): RelationshipPresetId[] {
  return ["first_meet", "warming_up", "familiar", "close", "long_term"];
}
