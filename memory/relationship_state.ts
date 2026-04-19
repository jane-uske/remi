import type { MemoryRepository } from "./memory_repository";
import { createLogger } from "../infra/logger";

const logger = createLogger("relationship-state");

export const RELATIONSHIP_STATE_KEY = "__rem_relationship_state_v1";

export type PersistentRelationshipSentiment = "positive" | "neutral" | "negative";

export interface PersistentRelationshipTopicEntry {
  topic: string;
  depth: number;
  lastTurn: number;
  sentiment: PersistentRelationshipSentiment;
}

export interface PersistentRelationshipMoodSnapshot {
  turn: number;
  mood: string;
}

export interface PersistentSharedMoment {
  summary: string;
  topic: string;
  mood: string;
  hook: string;
  semanticKeywords?: string[];
  kind: "support" | "stress" | "joy" | "goal" | "routine" | "bond";
  salience: number;
  recurrenceCount: number;
  unresolved: boolean;
  turn: number;
  createdAt: number;
  firstSeenAt: number;
  lastReferencedAt: number;
}

export interface PersistentContinuityCueState {
  lastProactiveHook: string;
  lastProactiveTurn: number;
  lastSharedMomentSummary: string;
  lastSharedMomentTurn: number;
}

export interface PersistentTopicThread {
  topic: string;
  summary: string;
  bridgeSummary?: string;
  topMood: string;
  relatedTopics?: string[];
  semanticKeywords?: string[];
  salience: number;
  relationshipWeight?: number;
  unresolvedCount: number;
  recurrenceCount: number;
  episodeCount?: number;
  firstTurn?: number;
  timeSpanTurns?: number;
  memoryLayer?: "active" | "core";
  lastTurn: number;
}

export type PersistentProactiveMode = "presence" | "follow_up" | "care";

export interface PersistentEpisode {
  id: string;
  layer: "active" | "core";
  title: string;
  summary: string;
  sourceTopics: string[];
  semanticKeywords: string[];
  topMood: string;
  salience: number;
  relationshipWeight: number;
  status: "active" | "cooling" | "resolved";
  firstTurn: number;
  lastTurn: number;
  recurrenceCount: number;
  originMomentSummaries: string[];
}

export interface PersistentProactiveLedgerEntry {
  key: string;
  lastOfferedAt: number;
  lastAnsweredAt: number;
  ignoredCount: number;
  nextEligibleAt: number;
  lastMode?: PersistentProactiveMode | "";
}

export interface PersistentProactiveStrategyState {
  lastUserTurnAt: number;
  lastProactiveAt: number;
  lastUserReturnAfterProactiveAt: number;
  consecutiveProactiveCount: number;
  totalProactiveCount: number;
  nudgesSinceLastUserTurn: number;
  retreatLevel: number;
  ignoredProactiveStreak: number;
  cooldownUntilAt: number;
  lastProactiveMode?: PersistentProactiveMode | "";
}

export interface PersistentWorkingMemory {
  currentNeed: string;
  currentConstraints: string[];
  openLoop: string;
  sceneState: "none" | "planning" | "decision" | "immersive";
  lastUpdatedTurn: number;
}

export interface PersistentRelationshipStateV1 {
  version: "v1";
  updatedAt: number;
  userProfile: {
    interests: string[];
    personalityNotes: string[];
    responseStyleNotes?: string[];
    facts?: Record<string, string>;
  };
  /** 上次会话结束时的情绪状态（neutral/happy/curious/shy/sad），重连时恢复用 */
  lastEmotion?: string;
  relationship: {
    familiarity: number;
    emotionalBond: number;
    turnCount: number;
    preferredTopics: string[];
  };
  topicHistory: PersistentRelationshipTopicEntry[];
  moodTrajectory: PersistentRelationshipMoodSnapshot[];
  conversationSummary: string;
  proactiveTopics: string[];
  sharedMoments: PersistentSharedMoment[];
  /** Legacy derived snapshot fields. New writes omit them; old payloads may still carry them. */
  episodes?: PersistentEpisode[];
  topicThreads?: PersistentTopicThread[];
  workingMemory?: PersistentWorkingMemory;
  continuityCueState: PersistentContinuityCueState;
  proactiveLedger: PersistentProactiveLedgerEntry[];
  proactiveStrategyState: PersistentProactiveStrategyState;
}

function parseBooleanFlag(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === "") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "1" || normalized === "true") return true;
  if (normalized === "0" || normalized === "false") return false;
  return fallback;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function toFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

const VALID_EMOTIONS = ["neutral", "happy", "curious", "shy", "sad"] as const;

function toFactsRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof k === "string" && typeof v === "string") {
      result[k] = v;
    }
    if (Object.keys(result).length >= 50) break;
  }
  return result;
}

function toStringList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  const deduped = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    deduped.add(trimmed);
    if (deduped.size >= limit) break;
  }
  return [...deduped];
}

function toTopicHistory(value: unknown): PersistentRelationshipTopicEntry[] {
  if (!Array.isArray(value)) return [];
  const topics: PersistentRelationshipTopicEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const topic = typeof record.topic === "string" ? record.topic.trim() : "";
    const depth = Math.max(1, Math.floor(toFiniteNumber(record.depth, 1)));
    const lastTurn = Math.max(0, Math.floor(toFiniteNumber(record.lastTurn, 0)));
    const sentiment = record.sentiment;
    if (!topic) continue;
    topics.push({
      topic,
      depth,
      lastTurn,
      sentiment:
        sentiment === "positive" || sentiment === "negative" ? sentiment : "neutral",
    });
    if (topics.length >= 24) break;
  }
  return topics;
}

function toMoodTrajectory(value: unknown): PersistentRelationshipMoodSnapshot[] {
  if (!Array.isArray(value)) return [];
  const moods: PersistentRelationshipMoodSnapshot[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const mood = typeof record.mood === "string" ? record.mood.trim() : "";
    const turn = Math.max(0, Math.floor(toFiniteNumber(record.turn, 0)));
    if (!mood) continue;
    moods.push({ turn, mood });
    if (moods.length >= 24) break;
  }
  return moods;
}

function toSharedMoments(value: unknown): PersistentSharedMoment[] {
  if (!Array.isArray(value)) return [];
  const moments: PersistentSharedMoment[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const summary =
      typeof record.summary === "string" ? record.summary.trim().slice(0, 180) : "";
    const topic =
      typeof record.topic === "string" ? record.topic.trim().slice(0, 40) : "";
    const mood =
      typeof record.mood === "string" ? record.mood.trim().slice(0, 24) : "";
    const hook =
      typeof record.hook === "string" ? record.hook.trim().slice(0, 80) : "";
    const kind = record.kind;
    const salience = clamp01(toFiniteNumber(record.salience, 0.45));
    const recurrenceCount = Math.max(1, Math.floor(toFiniteNumber(record.recurrenceCount, 1)));
    const unresolved = record.unresolved === true;
    const turn = Math.max(0, Math.floor(toFiniteNumber(record.turn, 0)));
    const createdAt = Math.max(0, Math.floor(toFiniteNumber(record.createdAt, Date.now())));
    const firstSeenAt = Math.max(0, Math.floor(toFiniteNumber(record.firstSeenAt, createdAt)));
    const lastReferencedAt = Math.max(
      0,
      Math.floor(toFiniteNumber(record.lastReferencedAt, 0)),
    );
    if (!summary) continue;
    moments.push({
      summary,
      topic,
      mood,
      hook,
      semanticKeywords: toStringList(record.semanticKeywords, 12),
      kind:
        kind === "support" ||
        kind === "stress" ||
        kind === "joy" ||
        kind === "goal" ||
        kind === "bond"
          ? kind
          : "routine",
      salience,
      recurrenceCount,
      unresolved,
      turn,
      createdAt,
      firstSeenAt,
      lastReferencedAt,
    });
    if (moments.length >= 8) break;
  }
  return moments;
}

function toContinuityCueState(value: unknown): PersistentContinuityCueState {
  if (!value || typeof value !== "object") {
    return {
      lastProactiveHook: "",
      lastProactiveTurn: -100,
      lastSharedMomentSummary: "",
      lastSharedMomentTurn: -100,
    };
  }

  const record = value as Record<string, unknown>;
  return {
    lastProactiveHook:
      typeof record.lastProactiveHook === "string"
        ? record.lastProactiveHook.trim().slice(0, 80)
        : "",
    lastProactiveTurn: Math.floor(toFiniteNumber(record.lastProactiveTurn, -100)),
    lastSharedMomentSummary:
      typeof record.lastSharedMomentSummary === "string"
        ? record.lastSharedMomentSummary.trim().slice(0, 180)
        : "",
    lastSharedMomentTurn: Math.floor(toFiniteNumber(record.lastSharedMomentTurn, -100)),
  };
}

function toTopicThreads(value: unknown): PersistentTopicThread[] {
  if (!Array.isArray(value)) return [];
  const threads: PersistentTopicThread[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const topic = typeof record.topic === "string" ? record.topic.trim().slice(0, 40) : "";
    const summary =
      typeof record.summary === "string" ? record.summary.trim().slice(0, 200) : "";
    const topMood =
      typeof record.topMood === "string" ? record.topMood.trim().slice(0, 24) : "";
    if (!topic || !summary) continue;
    threads.push({
      topic,
      summary,
      bridgeSummary:
        typeof record.bridgeSummary === "string"
          ? record.bridgeSummary.trim().slice(0, 240)
          : undefined,
      topMood,
      relatedTopics: toStringList(record.relatedTopics, 6),
      semanticKeywords: toStringList(record.semanticKeywords, 12),
      salience: clamp01(toFiniteNumber(record.salience, 0.4)),
      relationshipWeight: clamp01(toFiniteNumber(record.relationshipWeight, 0.4)),
      unresolvedCount: Math.max(0, Math.floor(toFiniteNumber(record.unresolvedCount, 0))),
      recurrenceCount: Math.max(1, Math.floor(toFiniteNumber(record.recurrenceCount, 1))),
      episodeCount: Math.max(1, Math.floor(toFiniteNumber(record.episodeCount, 1))),
      firstTurn: Math.max(0, Math.floor(toFiniteNumber(record.firstTurn, 0))),
      timeSpanTurns: Math.max(0, Math.floor(toFiniteNumber(record.timeSpanTurns, 0))),
      memoryLayer: record.memoryLayer === "core" ? "core" : "active",
      lastTurn: Math.max(0, Math.floor(toFiniteNumber(record.lastTurn, 0))),
    });
    if (threads.length >= 8) break;
  }
  return threads;
}

function toEpisodes(value: unknown): PersistentEpisode[] {
  if (!Array.isArray(value)) return [];
  const episodes: PersistentEpisode[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim().slice(0, 80) : "";
    const title =
      typeof record.title === "string" ? record.title.trim().slice(0, 80) : "";
    const summary =
      typeof record.summary === "string" ? record.summary.trim().slice(0, 280) : "";
    const topMood =
      typeof record.topMood === "string" ? record.topMood.trim().slice(0, 24) : "";
    if (!id || !title || !summary) continue;
    const layer = record.layer === "core" ? "core" : "active";
    const status = record.status;
    episodes.push({
      id,
      layer,
      title,
      summary,
      sourceTopics: toStringList(record.sourceTopics, 8),
      semanticKeywords: toStringList(record.semanticKeywords, 14),
      topMood,
      salience: clamp01(toFiniteNumber(record.salience, 0.4)),
      relationshipWeight: clamp01(toFiniteNumber(record.relationshipWeight, 0.4)),
      status:
        status === "active" || status === "cooling" || status === "resolved"
          ? status
          : layer === "core"
            ? "cooling"
            : "active",
      firstTurn: Math.max(0, Math.floor(toFiniteNumber(record.firstTurn, 0))),
      lastTurn: Math.max(0, Math.floor(toFiniteNumber(record.lastTurn, 0))),
      recurrenceCount: Math.max(1, Math.floor(toFiniteNumber(record.recurrenceCount, 1))),
      originMomentSummaries: toStringList(record.originMomentSummaries, 6),
    });
    if (episodes.length >= 8) break;
  }
  return episodes;
}

function toProactiveLedger(value: unknown): PersistentProactiveLedgerEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: PersistentProactiveLedgerEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const key = typeof record.key === "string" ? record.key.trim().slice(0, 120) : "";
    if (!key) continue;
    const mode = record.lastMode;
    entries.push({
      key,
      lastOfferedAt: Math.max(0, Math.floor(toFiniteNumber(record.lastOfferedAt, 0))),
      lastAnsweredAt: Math.max(0, Math.floor(toFiniteNumber(record.lastAnsweredAt, 0))),
      ignoredCount: Math.max(0, Math.floor(toFiniteNumber(record.ignoredCount, 0))),
      nextEligibleAt: Math.max(0, Math.floor(toFiniteNumber(record.nextEligibleAt, 0))),
      lastMode:
        mode === "presence" || mode === "follow_up" || mode === "care" ? mode : "",
    });
    if (entries.length >= 24) break;
  }
  return entries;
}

function toProactiveStrategyState(value: unknown): PersistentProactiveStrategyState {
  if (!value || typeof value !== "object") {
    return {
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
    };
  }
  const record = value as Record<string, unknown>;
  const mode = record.lastProactiveMode;
  return {
    lastUserTurnAt: Math.max(0, Math.floor(toFiniteNumber(record.lastUserTurnAt, 0))),
    lastProactiveAt: Math.max(0, Math.floor(toFiniteNumber(record.lastProactiveAt, 0))),
    lastUserReturnAfterProactiveAt: Math.max(
      0,
      Math.floor(toFiniteNumber(record.lastUserReturnAfterProactiveAt, 0)),
    ),
    consecutiveProactiveCount: Math.max(
      0,
      Math.floor(toFiniteNumber(record.consecutiveProactiveCount, 0)),
    ),
    totalProactiveCount: Math.max(0, Math.floor(toFiniteNumber(record.totalProactiveCount, 0))),
    nudgesSinceLastUserTurn: Math.max(
      0,
      Math.floor(toFiniteNumber(record.nudgesSinceLastUserTurn, 0)),
    ),
    retreatLevel: Math.max(0, Math.floor(toFiniteNumber(record.retreatLevel, 0))),
    ignoredProactiveStreak: Math.max(
      0,
      Math.floor(toFiniteNumber(record.ignoredProactiveStreak, 0)),
    ),
    cooldownUntilAt: Math.max(0, Math.floor(toFiniteNumber(record.cooldownUntilAt, 0))),
    lastProactiveMode:
      mode === "presence" || mode === "follow_up" || mode === "care" ? mode : "",
  };
}

function toWorkingMemory(value: unknown): PersistentWorkingMemory | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const currentNeed =
    typeof record.currentNeed === "string" ? record.currentNeed.trim().slice(0, 120) : "";
  const openLoop =
    typeof record.openLoop === "string" ? record.openLoop.trim().slice(0, 120) : "";
  const sceneState =
    record.sceneState === "planning" ||
    record.sceneState === "decision" ||
    record.sceneState === "immersive"
      ? record.sceneState
      : "none";
  const currentConstraints = toStringList(record.currentConstraints, 3)
    .map((entry) => entry.slice(0, 72));
  const lastUpdatedTurn = Math.max(0, Math.floor(toFiniteNumber(record.lastUpdatedTurn, 0)));
  if (!currentNeed && !openLoop && currentConstraints.length === 0 && sceneState === "none") {
    return undefined;
  }
  return {
    currentNeed,
    currentConstraints,
    openLoop,
    sceneState,
    lastUpdatedTurn,
  };
}

export function relationshipStateEnabled(): boolean {
  return parseBooleanFlag(process.env.REMI_RELATIONSHIP_STATE_ENABLED, true);
}

export function isSystemMemoryKey(key: string): boolean {
  return key.trim().startsWith("__rem_");
}

export function normalizePersistentRelationshipState(
  value: unknown,
): PersistentRelationshipStateV1 | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const version = record.version;
  if (version !== "v1") return null;

  const userProfile =
    record.userProfile && typeof record.userProfile === "object"
      ? (record.userProfile as Record<string, unknown>)
      : {};
  const relationship =
    record.relationship && typeof record.relationship === "object"
      ? (record.relationship as Record<string, unknown>)
      : {};

  return {
    version: "v1",
    updatedAt: Math.max(0, Math.floor(toFiniteNumber(record.updatedAt, Date.now()))),
    userProfile: {
      interests: toStringList(userProfile.interests, 12),
      personalityNotes: toStringList(userProfile.personalityNotes, 6),
      responseStyleNotes: toStringList(userProfile.responseStyleNotes, 5),
      facts: toFactsRecord(userProfile.facts),
    },
    lastEmotion: (VALID_EMOTIONS as readonly string[]).includes(record.lastEmotion as string)
      ? (record.lastEmotion as string)
      : undefined,
    relationship: {
      familiarity: clamp01(toFiniteNumber(relationship.familiarity, 0)),
      emotionalBond: clamp01(toFiniteNumber(relationship.emotionalBond, 0)),
      turnCount: Math.max(0, Math.floor(toFiniteNumber(relationship.turnCount, 0))),
      preferredTopics: toStringList(relationship.preferredTopics, 8),
    },
    topicHistory: toTopicHistory(record.topicHistory),
    moodTrajectory: toMoodTrajectory(record.moodTrajectory),
    conversationSummary:
      typeof record.conversationSummary === "string"
        ? record.conversationSummary.trim().slice(0, 600)
        : "",
    proactiveTopics: toStringList(record.proactiveTopics, 6),
    sharedMoments: toSharedMoments(record.sharedMoments),
    episodes: toEpisodes(record.episodes),
    topicThreads: toTopicThreads(record.topicThreads),
    workingMemory: toWorkingMemory(record.workingMemory),
    continuityCueState: toContinuityCueState(record.continuityCueState),
    proactiveLedger: toProactiveLedger(record.proactiveLedger),
    proactiveStrategyState: toProactiveStrategyState(record.proactiveStrategyState),
  };
}

export async function loadPersistentRelationshipState(
  repo: MemoryRepository,
): Promise<PersistentRelationshipStateV1 | null> {
  try {
    const entry = await repo.getByKey(RELATIONSHIP_STATE_KEY);
    if (!entry?.value) return null;
    const parsed = normalizePersistentRelationshipState(JSON.parse(entry.value));
    if (!parsed) {
      logger.warn("relationship state payload is invalid", {
        key: RELATIONSHIP_STATE_KEY,
      });
    }
    return parsed;
  } catch (err) {
    logger.warn("failed to load relationship state", {
      error: (err as Error).message,
    });
    return null;
  }
}

export async function savePersistentRelationshipState(
  repo: MemoryRepository,
  state: PersistentRelationshipStateV1,
): Promise<void> {
  await repo.upsert(RELATIONSHIP_STATE_KEY, JSON.stringify(state), 1);
}
