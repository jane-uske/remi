// ── Slow Brain State Store ──────────────────────────────────
// 每条 WebSocket 连接独立一份（C1）。

import type { PersistentRelationshipStateV1 } from "../memory/relationship_state";
import { sanitizeMemoryEvidenceText } from "../memory/prompt_memory_support";
import { detectAnswerNowSignal, detectDecisionSeekingSignal } from "../brain/tone_policy";
import {
  buildPolicyToneContract,
  buildResponsePolicyGuidance,
  buildResponseShapeContract,
  type ResponsePolicy,
  type TurnAnalysisBundle,
  type TurnInterpretation,
} from "../brain/turn_interpreter";
import {
  buildProactivePostureGuidance,
  buildProactiveToneDirective,
  buildRealtimeContinuityHint,
  buildRelationshipResponseShapeContract,
  buildRelationshipResponseShapeGuidance,
  buildRelationshipStyleContract,
  buildRelationshipStyleGuidance,
  buildSceneImmersionGuidance,
  buildToneContractGuidance,
  detectTopicBoundarySignal,
  isSceneImmersionLike,
  pickProactiveCue,
  pickSharedMomentCue,
  proactiveLedgerCooldownMs,
  proactiveLedgerKeyMatches,
  resolveProactiveMode,
  resolveRelationshipStyleProfile,
  silenceNudgeBaseCooldownMs,
  shouldTriggerSilenceNudge,
  topicViolatesBoundary,
} from "./slow_brain_guidance";
import {
  buildCompatibilityEpisodesFromSignals,
  buildCompatibilityTopicThreadsFromSignals,
  buildSemanticKeywords,
  clamp01,
  deriveTopicSignalsFromSharedMoments,
  extractKeywords,
  keywordOverlapCount,
  mergeSemanticKeywords,
  proactiveLedgerEnabled,
  resolveRelationshipStage,
  sentimentLabel,
  topicBoundaryTtlTurns,
  type DerivedTopicSignal,
} from "./slow_brain_store_support";

export interface UserProfile {
  facts: Map<string, string>;
  interests: string[];
  personalityNotes: string[];
  responseStyleNotes: string[];
}

export interface RelationshipState {
  familiarity: number;
  emotionalBond: number;
  turnCount: number;
  preferredTopics: string[];
}

export interface TopicEntry {
  topic: string;
  depth: number;
  lastTurn: number;
  sentiment: "positive" | "neutral" | "negative";
}

export interface MoodSnapshot {
  turn: number;
  mood: string;
}

export interface SharedMoment {
  summary: string;
  topic: string;
  mood: string;
  hook: string;
  semanticKeywords: string[];
  kind: "support" | "stress" | "joy" | "goal" | "routine" | "bond";
  salience: number;
  recurrenceCount: number;
  unresolved: boolean;
  turn: number;
  createdAt: number;
  firstSeenAt: number;
  lastReferencedAt: number;
}

export interface ContinuityCueState {
  lastProactiveHook: string;
  lastProactiveTurn: number;
  lastSharedMomentSummary: string;
  lastSharedMomentTurn: number;
}

export interface TopicBoundaryState {
  blockedTopic: string;
  blockedKeywords: string[];
  setAtTurn: number;
  expiresAtTurn: number;
}

export type RepairStateLevel = "none" | "minor_miss" | "trust_drop" | "rupture";

export interface RepairState {
  level: RepairStateLevel;
  reason: string;
  lastUpdatedTurn: number;
}

export interface TopicThread {
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

export type ProactiveMode = "presence" | "follow_up" | "care";

export interface Episode {
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

export interface ProactiveLedgerEntry {
  key: string;
  lastOfferedAt: number;
  lastAnsweredAt: number;
  ignoredCount: number;
  nextEligibleAt: number;
  lastMode?: ProactiveMode | "";
}

export interface ProactiveStrategyState {
  lastUserTurnAt: number;
  lastProactiveAt: number;
  lastUserReturnAfterProactiveAt: number;
  consecutiveProactiveCount: number;
  totalProactiveCount: number;
  nudgesSinceLastUserTurn: number;
  retreatLevel: number;
  ignoredProactiveStreak: number;
  cooldownUntilAt: number;
  lastProactiveMode?: ProactiveMode | "";
}

export type WorkingMemorySceneState = "none" | "planning" | "decision" | "immersive";

export interface WorkingMemoryV2 {
  activeThread: string;
  currentNeed: string;
  currentConstraints: string[];
  openLoop: string;
  doNotTouch: string[];
  sceneState: WorkingMemorySceneState;
  lastUpdatedTurn: number;
}

export type WorkingMemory = WorkingMemoryV2;

export interface SlowBrainSnapshot {
  userProfile: UserProfile;
  relationship: RelationshipState;
  topicHistory: TopicEntry[];
  moodTrajectory: MoodSnapshot[];
  conversationSummary: string;
  proactiveTopics: string[];
  sharedMoments: SharedMoment[];
  episodes?: Episode[];
  topicThreads?: TopicThread[];
  workingMemory?: WorkingMemoryV2;
  repairState?: RepairState;
  continuityCueState: ContinuityCueState;
  topicBoundaryState?: TopicBoundaryState;
  proactiveLedger?: ProactiveLedgerEntry[];
  proactiveStrategyState?: ProactiveStrategyState;
  relationshipStageLabel?: string;
  replyShapeContract?: string;
  memoryCarryRule?: string;
  proactivePosture?: string;
}

export interface ConversationGuidance {
  hints?: string;
  proactiveCandidate?: string;
  proactiveCandidateKey?: string;
  sharedMomentCandidate?: string;
}

export interface SilenceNudgePlan {
  userMessage: string;
  proactiveCandidate?: string;
  proactiveCandidateKey?: string;
  sharedMomentCandidate?: string;
  strategyMode?: ProactiveMode;
  episodeId?: string;
}

const WORKING_MEMORY_TTL_TURNS = 3;
const REPAIR_STATE_TTL_TURNS = 3;
const WORKING_MEMORY_MAX_CHARS = 180;
const WORKING_MEMORY_MAX_CONSTRAINTS = 4;
const GREETING_LIKE_TURN_PATTERN =
  /^(?:你好呀?|您好|哈喽|hello|hi|嗨|嘿|在吗|在不在|晚安(?:啦|呀)?|早安|早上好|晚上好)[!！?？~～。\s]*$/iu;

function workingMemoryEnabled(): boolean {
  const raw = (process.env.REMI_WORKING_MEMORY_ENABLED ?? "0").trim().toLowerCase();
  return raw === "1" || raw === "true";
}

function clipWorkingMemoryText(text: string, maxChars: number): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function normalizeWorkingMemoryConstraint(text: string): string {
  return text
    .trim()
    .replace(/^(而且|还有|另外|但是|但|不过|只是|现在|可我|可是|再加上)/u, "")
    .replace(/\s+/g, "");
}

function dedupeWorkingMemoryConstraints(entries: string[]): string[] {
  const kept: Array<{ raw: string; normalized: string }> = [];
  for (const entry of entries) {
    const raw = entry.trim();
    if (!raw) continue;
    const normalized = normalizeWorkingMemoryConstraint(raw);
    if (!normalized) continue;
    const overlapsExisting = kept.some(
      (candidate) =>
        candidate.normalized === normalized ||
        candidate.normalized.includes(normalized) ||
        normalized.includes(candidate.normalized),
    );
    if (overlapsExisting) continue;
    kept.push({ raw, normalized });
  }
  return kept.map((entry) => entry.raw);
}

function isGreetingLikeTurn(userMessage: string): boolean {
  const trimmed = userMessage.trim();
  if (!trimmed || trimmed.length > 12) return false;
  return GREETING_LIKE_TURN_PATTERN.test(trimmed);
}

function describeWorkingMemoryScene(sceneState: WorkingMemorySceneState): string {
  if (sceneState === "planning") return "planning";
  if (sceneState === "decision") return "decision";
  if (sceneState === "immersive") return "immersive";
  return "none";
}

export class SlowBrainStore {
  private readonly profile: UserProfile = {
    facts: new Map(),
    interests: [],
    personalityNotes: [],
    responseStyleNotes: [],
  };

  private readonly relationship: RelationshipState = {
    familiarity: 0,
    emotionalBond: 0,
    turnCount: 0,
    preferredTopics: [],
  };

  private readonly topicHistory: TopicEntry[] = [];
  private readonly moodTrajectory: MoodSnapshot[] = [];
  private conversationSummary = "";
  private proactiveTopics: string[] = [];
  private readonly sharedMoments: SharedMoment[] = [];
  private readonly continuityCueState: ContinuityCueState = {
    lastProactiveHook: "",
    lastProactiveTurn: -100,
    lastSharedMomentSummary: "",
    lastSharedMomentTurn: -100,
  };
  private topicBoundaryState: TopicBoundaryState | null = null;
  private repairState: RepairState | null = null;
  private readonly proactiveLedger = new Map<string, ProactiveLedgerEntry>();
  private readonly proactiveStrategyState: ProactiveStrategyState = {
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
  private workingMemory: WorkingMemoryV2 | null = null;
  private derivedCache: {
    topicSignals: DerivedTopicSignal[];
    episodes: Episode[];
    topicThreads: TopicThread[];
    relationshipStageLabel: string;
    replyShapeContract: string;
    memoryCarryRule: string;
    proactivePosture: string | undefined;
  } | null = null;

  private lastEmotionValue: string = "neutral";

  setLastEmotion(emotion: string): void {
    const valid = ["neutral", "happy", "curious", "shy", "sad"];
    if (valid.includes(emotion)) this.lastEmotionValue = emotion;
  }

  addFact(key: string, value: string): void {
    this.profile.facts.set(key, value);
    this.invalidateDerivedCache();
  }

  addInterest(interest: string): void {
    if (!this.profile.interests.includes(interest)) {
      this.profile.interests.push(interest);
      this.invalidateDerivedCache();
    }
  }

  addPersonalityNote(note: string): void {
    let changed = false;
    if (this.profile.personalityNotes.length >= 5) {
      this.profile.personalityNotes.shift();
      changed = true;
    }
    if (!this.profile.personalityNotes.includes(note)) {
      this.profile.personalityNotes.push(note);
      changed = true;
    }
    if (changed) {
      this.invalidateDerivedCache();
    }
  }

  addResponseStyleNote(note: string): void {
    const trimmed = note.trim();
    if (!trimmed) return;
    let changed = false;
    if (this.profile.responseStyleNotes.length >= 5) {
      this.profile.responseStyleNotes.shift();
      changed = true;
    }
    if (!this.profile.responseStyleNotes.includes(trimmed)) {
      this.profile.responseStyleNotes.push(trimmed);
      changed = true;
    }
    if (changed) {
      this.invalidateDerivedCache();
    }
  }

  clearResponseStyleNotes(): void {
    if (this.profile.responseStyleNotes.length === 0) return;
    this.profile.responseStyleNotes.splice(0, this.profile.responseStyleNotes.length);
    this.invalidateDerivedCache();
  }

  recordTurn(): void {
    this.relationship.turnCount++;
    this.invalidateDerivedCache();
  }

  bumpRelationship(opts: {
    familiarityDelta?: number;
    emotionalBondDelta?: number;
  }): void {
    let changed = false;
    if (opts.familiarityDelta) {
      this.relationship.familiarity = clamp01(
        this.relationship.familiarity + opts.familiarityDelta,
      );
      changed = true;
    }
    if (opts.emotionalBondDelta) {
      this.relationship.emotionalBond = clamp01(
        this.relationship.emotionalBond + opts.emotionalBondDelta,
      );
      changed = true;
    }
    if (changed) {
      this.invalidateDerivedCache();
    }
  }

  touchTopic(
    topic: string,
    sentiment: TopicEntry["sentiment"] = "neutral",
  ): void {
    const existing = this.topicHistory.find((t) => t.topic === topic);
    if (existing) {
      existing.depth++;
      existing.lastTurn = this.relationship.turnCount;
      existing.sentiment = sentiment;
    } else {
      this.topicHistory.push({
        topic,
        depth: 1,
        lastTurn: this.relationship.turnCount,
        sentiment,
      });
    }

    if (
      !this.relationship.preferredTopics.includes(topic) &&
      (existing?.depth ?? 0) >= 2
    ) {
      this.relationship.preferredTopics.push(topic);
    }
    this.invalidateDerivedCache();
  }

  recordMood(mood: string): void {
    this.moodTrajectory.push({ turn: this.relationship.turnCount, mood });
    if (this.moodTrajectory.length > 20) this.moodTrajectory.shift();
    this.invalidateDerivedCache();
  }

  setConversationSummary(summary: string): void {
    this.conversationSummary = summary;
    this.invalidateDerivedCache();
  }

  setProactiveTopics(topics: string[]): void {
    this.proactiveTopics = topics.slice(0, 5);
    this.invalidateDerivedCache();
  }

  recordSharedMoment(input: {
    summary: string;
    topic?: string;
    mood?: string;
    hook?: string;
    kind?: SharedMoment["kind"];
    salience?: number;
    unresolved?: boolean;
    createdAt?: number;
  }): void {
    const summary = input.summary.trim();
    if (!summary) return;

    const topic = input.topic?.trim() ?? "";
    const mood = input.mood?.trim() ?? "";
    const hook = input.hook?.trim() ?? "";
    const kind = input.kind ?? "routine";
    const salience = clamp01(input.salience ?? 0.45);
    const unresolved = input.unresolved ?? false;
    const semanticKeywords = buildSemanticKeywords([summary, topic, mood, hook]);
    const normalized = summary.toLowerCase();
    const existingIndex = this.sharedMoments.findIndex((entry) => {
      if (entry.summary.toLowerCase() === normalized) return true;
      if (topic && entry.topic === topic && entry.turn === this.relationship.turnCount) {
        return true;
      }
      return false;
    });

    const existing = existingIndex >= 0 ? this.sharedMoments[existingIndex] : null;
    const createdAt = input.createdAt ?? Date.now();
    const nextMoment: SharedMoment = {
      summary,
      topic,
      mood,
      hook,
      semanticKeywords: mergeSemanticKeywords(existing?.semanticKeywords ?? [], semanticKeywords),
      kind: existing?.kind ?? kind,
      salience: Math.max(existing?.salience ?? 0, salience),
      recurrenceCount: Math.max(1, (existing?.recurrenceCount ?? 0) + 1),
      unresolved: unresolved || existing?.unresolved === true,
      turn: this.relationship.turnCount,
      createdAt,
      firstSeenAt: existing?.firstSeenAt ?? createdAt,
      lastReferencedAt: existing?.lastReferencedAt ?? 0,
    };

    if (existingIndex >= 0) {
      this.sharedMoments.splice(existingIndex, 1);
    }
    this.sharedMoments.unshift(nextMoment);
    if (this.sharedMoments.length > 8) {
      this.sharedMoments.length = 8;
    }
    this.invalidateDerivedCache();
  }

  exportPersistentState(updatedAt: number = Date.now()): PersistentRelationshipStateV1 {
    const snap = this.getSnapshot();
    const proactiveLedger = snap.proactiveLedger ?? [];
    const proactiveStrategyState = snap.proactiveStrategyState ?? {
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
    return {
      version: "v1",
      updatedAt,
      userProfile: {
        interests: [...snap.userProfile.interests],
        personalityNotes: [...snap.userProfile.personalityNotes],
        responseStyleNotes: [...snap.userProfile.responseStyleNotes],
        facts: Object.fromEntries(snap.userProfile.facts),
      },
      lastEmotion: this.lastEmotionValue,
      relationship: {
        ...snap.relationship,
        preferredTopics: [...snap.relationship.preferredTopics],
      },
      topicHistory: snap.topicHistory.map((entry) => ({ ...entry })),
      moodTrajectory: snap.moodTrajectory.map((entry) => ({ ...entry })),
      conversationSummary: snap.conversationSummary,
      proactiveTopics: [...snap.proactiveTopics],
      sharedMoments: snap.sharedMoments.map((entry) => ({ ...entry })),
      workingMemory: snap.workingMemory
        ? {
            activeThread: snap.workingMemory.activeThread,
            currentNeed: snap.workingMemory.currentNeed,
            currentConstraints: [...snap.workingMemory.currentConstraints],
            openLoop: snap.workingMemory.openLoop,
            doNotTouch: [...snap.workingMemory.doNotTouch],
            sceneState: snap.workingMemory.sceneState,
            lastUpdatedTurn: snap.workingMemory.lastUpdatedTurn,
          }
        : undefined,
      repairState: snap.repairState
        ? {
            level: snap.repairState.level,
            reason: snap.repairState.reason,
            lastUpdatedTurn: snap.repairState.lastUpdatedTurn,
          }
        : undefined,
      continuityCueState: { ...snap.continuityCueState },
      proactiveLedger: proactiveLedger.map((entry) => ({ ...entry })),
      proactiveStrategyState: { ...proactiveStrategyState },
    };
  }

  hydratePersistentState(state: PersistentRelationshipStateV1): void {
    this.profile.interests.splice(
      0,
      this.profile.interests.length,
      ...state.userProfile.interests,
    );
    this.profile.personalityNotes.splice(
      0,
      this.profile.personalityNotes.length,
      ...state.userProfile.personalityNotes,
    );
    this.profile.responseStyleNotes.splice(
      0,
      this.profile.responseStyleNotes.length,
      ...(state.userProfile.responseStyleNotes ?? []),
    );
    this.profile.facts.clear();
    for (const [k, v] of Object.entries(state.userProfile.facts ?? {})) {
      this.profile.facts.set(k, v);
    }

    if (state.lastEmotion) {
      this.setLastEmotion(state.lastEmotion);
    }

    this.relationship.familiarity = clamp01(state.relationship.familiarity);
    this.relationship.emotionalBond = clamp01(state.relationship.emotionalBond);
    this.relationship.turnCount = Math.max(0, state.relationship.turnCount);
    this.relationship.preferredTopics.splice(
      0,
      this.relationship.preferredTopics.length,
      ...state.relationship.preferredTopics,
    );

    this.topicHistory.splice(
      0,
      this.topicHistory.length,
      ...state.topicHistory.map((entry) => ({ ...entry })),
    );
    this.moodTrajectory.splice(
      0,
      this.moodTrajectory.length,
      ...state.moodTrajectory.map((entry) => ({ ...entry })),
    );
    this.conversationSummary = state.conversationSummary;
    this.proactiveTopics.splice(
      0,
      this.proactiveTopics.length,
      ...state.proactiveTopics,
    );
    this.sharedMoments.splice(
      0,
      this.sharedMoments.length,
      ...state.sharedMoments.map((entry) => ({
        ...entry,
        semanticKeywords: [...(entry.semanticKeywords ?? [])],
      })),
    );
    this.proactiveLedger.clear();
    for (const entry of state.proactiveLedger ?? []) {
      this.proactiveLedger.set(entry.key, { ...entry });
    }
    this.continuityCueState.lastProactiveHook = state.continuityCueState.lastProactiveHook;
    this.continuityCueState.lastProactiveTurn = state.continuityCueState.lastProactiveTurn;
    this.continuityCueState.lastSharedMomentSummary =
      state.continuityCueState.lastSharedMomentSummary;
    this.continuityCueState.lastSharedMomentTurn =
      state.continuityCueState.lastSharedMomentTurn;
    this.proactiveStrategyState.lastUserTurnAt = state.proactiveStrategyState.lastUserTurnAt;
    this.proactiveStrategyState.lastProactiveAt = state.proactiveStrategyState.lastProactiveAt;
    this.proactiveStrategyState.lastUserReturnAfterProactiveAt =
      state.proactiveStrategyState.lastUserReturnAfterProactiveAt;
    this.proactiveStrategyState.consecutiveProactiveCount =
      state.proactiveStrategyState.consecutiveProactiveCount;
    this.proactiveStrategyState.totalProactiveCount =
      state.proactiveStrategyState.totalProactiveCount;
    this.proactiveStrategyState.nudgesSinceLastUserTurn =
      state.proactiveStrategyState.nudgesSinceLastUserTurn;
    this.proactiveStrategyState.retreatLevel =
      state.proactiveStrategyState.retreatLevel;
    this.proactiveStrategyState.ignoredProactiveStreak =
      state.proactiveStrategyState.ignoredProactiveStreak;
    this.proactiveStrategyState.cooldownUntilAt =
      state.proactiveStrategyState.cooldownUntilAt;
    this.proactiveStrategyState.lastProactiveMode =
      state.proactiveStrategyState.lastProactiveMode ?? "";
    this.workingMemory = state.workingMemory
      ? {
          activeThread: state.workingMemory.activeThread,
          currentNeed: state.workingMemory.currentNeed,
          currentConstraints: [...state.workingMemory.currentConstraints],
          openLoop: state.workingMemory.openLoop,
          doNotTouch: [...state.workingMemory.doNotTouch],
          sceneState: state.workingMemory.sceneState,
          lastUpdatedTurn: state.workingMemory.lastUpdatedTurn,
        }
      : null;
    this.repairState = state.repairState
      ? {
          level: state.repairState.level,
          reason: state.repairState.reason,
          lastUpdatedTurn: state.repairState.lastUpdatedTurn,
        }
      : null;
    this.topicBoundaryState = null;
    this.invalidateDerivedCache();
  }

  getSnapshot(): SlowBrainSnapshot {
    const derived = this.getDerivedCache();
    const workingMemory = this.getActiveWorkingMemory();
    return {
      userProfile: {
        facts: new Map(this.profile.facts),
        interests: [...this.profile.interests],
        personalityNotes: [...this.profile.personalityNotes],
        responseStyleNotes: [...this.profile.responseStyleNotes],
      },
      relationship: { ...this.relationship },
      topicHistory: this.topicHistory.map((t) => ({ ...t })),
      moodTrajectory: [...this.moodTrajectory],
      conversationSummary: this.conversationSummary,
      proactiveTopics: [...this.proactiveTopics],
      sharedMoments: this.sharedMoments.map((entry) => ({ ...entry })),
      episodes: this.cloneEpisodesForSnapshot(derived.episodes),
      topicThreads: this.cloneTopicThreadsForSnapshot(derived.topicThreads),
      workingMemory: workingMemory
        ? {
            activeThread: workingMemory.activeThread,
            currentNeed: workingMemory.currentNeed,
            currentConstraints: [...workingMemory.currentConstraints],
            openLoop: workingMemory.openLoop,
            doNotTouch: [...workingMemory.doNotTouch],
            sceneState: workingMemory.sceneState,
            lastUpdatedTurn: workingMemory.lastUpdatedTurn,
          }
        : undefined,
      repairState: this.getActiveRepairState() ?? undefined,
      continuityCueState: { ...this.continuityCueState },
      topicBoundaryState: this.getActiveTopicBoundaryState() ?? undefined,
      proactiveLedger: [...this.proactiveLedger.values()].map((entry) => ({ ...entry })),
      proactiveStrategyState: { ...this.proactiveStrategyState },
      relationshipStageLabel: derived.relationshipStageLabel,
      replyShapeContract: derived.replyShapeContract,
      memoryCarryRule: derived.memoryCarryRule,
      proactivePosture: derived.proactivePosture,
    };
  }

  buildWorkingMemoryDraft(input: {
    userMessage: string;
    interpretation?: TurnInterpretation | null;
    responsePolicy?: ResponsePolicy | null;
    directCapabilityId?: string | null;
  }): WorkingMemoryV2 | null {
    if (!workingMemoryEnabled()) return null;

    const active = this.getActiveWorkingMemory();
    const trimmed = clipWorkingMemoryText(input.userMessage, 72);
    if (!trimmed) return active;
    if (!input.interpretation && !input.directCapabilityId) {
      return active;
    }

    if (input.interpretation?.boundaryState === "veto_topic") {
      return null;
    }

    const currentConstraints = this.extractWorkingMemoryConstraints(input.userMessage);
    const activeThread = this.deriveWorkingMemoryActiveThread(
      trimmed,
      input.interpretation ?? null,
      input.directCapabilityId ?? null,
      active,
    );
    const currentNeed = this.deriveWorkingMemoryNeed(
      trimmed,
      input.interpretation ?? null,
      input.directCapabilityId ?? null,
    );
    const sceneState = this.deriveWorkingMemorySceneState(
      input.userMessage,
      input.interpretation ?? null,
      input.directCapabilityId ?? null,
    );
    const sameDecisionThread = active?.sceneState === "decision" && sceneState === "decision";
    const mergeConstraintContext =
      sameDecisionThread &&
      (input.interpretation?.userAct === "context_update" ||
        input.interpretation?.sceneType === "practical_judgment" ||
        trimmed.length <= 24);

    const shouldOverwrite =
      input.directCapabilityId != null ||
      input.responsePolicy?.shouldUpdateDecisionContext === true ||
      input.interpretation?.sceneState === "already_in_scene" ||
      input.interpretation?.userAct === "scene_continue" ||
      input.interpretation?.topicUpdate?.kind === "new_topic" ||
      input.interpretation?.userAct === "answer_now" ||
      input.interpretation?.userAct === "decision_seek" ||
      input.interpretation?.userAct === "direct_question";

    const nextConstraints =
      input.interpretation?.userAct === "context_update"
        ? dedupeWorkingMemoryConstraints(
            [
              ...(active?.currentConstraints ?? []),
              ...currentConstraints,
            ]
              .filter(Boolean)
              .filter((entry, index, list) => list.indexOf(entry) === index),
          ).slice(-WORKING_MEMORY_MAX_CONSTRAINTS)
        : mergeConstraintContext && currentConstraints.length > 0
        ? dedupeWorkingMemoryConstraints(
            [
              ...(active?.currentConstraints ?? []),
              ...currentConstraints,
            ]
              .filter(Boolean)
              .filter((entry, index, list) => list.indexOf(entry) === index),
          ).slice(-WORKING_MEMORY_MAX_CONSTRAINTS)
        : input.interpretation?.userAct === "decision_seek" &&
            currentConstraints.length === 0 &&
            active?.sceneState === "decision"
        ? [...(active.currentConstraints ?? [])].slice(0, WORKING_MEMORY_MAX_CONSTRAINTS)
        : currentConstraints.slice(0, WORKING_MEMORY_MAX_CONSTRAINTS);

    const openLoop = this.deriveWorkingMemoryOpenLoop(
      trimmed,
      input.interpretation ?? null,
      input.directCapabilityId ?? null,
      active,
    );
    const doNotTouch = this.deriveWorkingMemoryDoNotTouch(
      input.interpretation ?? null,
      input.responsePolicy ?? null,
      active,
    );
    const nextDoNotTouch =
      sameDecisionThread || (active?.sceneState === "immersive" && sceneState === "immersive")
        ? [...(active?.doNotTouch ?? []), ...doNotTouch]
            .filter(Boolean)
            .filter((entry, index, list) => list.indexOf(entry) === index)
            .slice(0, 4)
        : doNotTouch;

    if (!shouldOverwrite && !openLoop && nextConstraints.length === 0 && !activeThread && nextDoNotTouch.length === 0) {
      return active;
    }

    return {
      activeThread: activeThread || active?.activeThread || "",
      currentNeed: currentNeed || active?.currentNeed || trimmed,
      currentConstraints: nextConstraints,
      openLoop,
      doNotTouch: nextDoNotTouch,
      sceneState,
      lastUpdatedTurn: this.relationship.turnCount + 1,
    };
  }

  applyWorkingMemoryDraft(draft: WorkingMemoryV2 | null | undefined): void {
    if (!workingMemoryEnabled()) return;
    this.workingMemory = draft
      ? {
          activeThread: draft.activeThread,
          currentNeed: draft.currentNeed,
          currentConstraints: [...draft.currentConstraints],
          openLoop: draft.openLoop,
          doNotTouch: [...draft.doNotTouch],
          sceneState: draft.sceneState,
          lastUpdatedTurn: draft.lastUpdatedTurn,
        }
      : null;
    this.invalidateDerivedCache();
  }

  buildWorkingMemoryPromptBlock(draft?: WorkingMemoryV2 | null): string | undefined {
    if (!workingMemoryEnabled()) return undefined;
    const workingMemory = draft ?? this.getActiveWorkingMemory();
    if (!workingMemory) return undefined;

    const parts = [
      workingMemory.activeThread
        ? `当前主线：${workingMemory.activeThread}`
        : "",
      workingMemory.currentNeed
        ? `当前需求：${workingMemory.currentNeed}`
        : "",
      workingMemory.currentConstraints.length > 0
        ? `现实约束：${workingMemory.currentConstraints.join("；")}`
        : "",
      workingMemory.openLoop
        ? `未收口问题：${workingMemory.openLoop}`
        : "",
      workingMemory.doNotTouch.length > 0
        ? `不要做：${workingMemory.doNotTouch.join("；")}`
        : "",
      workingMemory.sceneState !== "none"
        ? `场景状态：${describeWorkingMemoryScene(workingMemory.sceneState)}`
        : "",
    ].filter(Boolean);
    if (parts.length === 0) return undefined;
    return `【当前上下文】\n${clipWorkingMemoryText(parts.join("\n"), WORKING_MEMORY_MAX_CHARS)}`;
  }

  recordUserTurnActivity(userMessage?: string): void {
    this.observeUserTopicBoundary(userMessage ?? "");
    if (
      this.proactiveStrategyState.lastProactiveAt > 0 &&
      this.proactiveStrategyState.lastProactiveAt >= this.proactiveStrategyState.lastUserTurnAt
    ) {
      this.proactiveStrategyState.lastUserReturnAfterProactiveAt = Date.now();
    }
    this.updateProactiveLedgerOnUserTurn(userMessage);
    this.proactiveStrategyState.lastUserTurnAt = Date.now();
    this.proactiveStrategyState.consecutiveProactiveCount = 0;
    this.proactiveStrategyState.nudgesSinceLastUserTurn = 0;
    this.invalidateDerivedCache();
  }

  observeUserTopicBoundary(userMessage: string): void {
    const signal = detectTopicBoundarySignal(userMessage);
    const activeBoundary = this.getActiveTopicBoundaryState();
    if (!signal) {
      if (!activeBoundary && this.topicBoundaryState) {
        this.topicBoundaryState = null;
        this.invalidateDerivedCache();
      }
      return;
    }

    const nextState: TopicBoundaryState = {
      blockedTopic: signal.topic,
      blockedKeywords: signal.keywords,
      setAtTurn: this.relationship.turnCount,
      expiresAtTurn: this.relationship.turnCount + topicBoundaryTtlTurns(),
    };
    const changed =
      !activeBoundary ||
      activeBoundary.blockedTopic !== nextState.blockedTopic ||
      activeBoundary.expiresAtTurn !== nextState.expiresAtTurn ||
      keywordOverlapCount(activeBoundary.blockedKeywords, nextState.blockedKeywords) !==
        nextState.blockedKeywords.length;
    this.topicBoundaryState = nextState;
    if (changed) {
      this.invalidateDerivedCache();
    }
  }

  recordProactiveOutreach(mode?: ProactiveMode, key?: string): void {
    const now = Date.now();
    const stage = resolveRelationshipStage(this.relationship);
    const unansweredStreak =
      this.proactiveStrategyState.lastProactiveAt > 0 &&
      this.proactiveStrategyState.lastUserTurnAt <= this.proactiveStrategyState.lastProactiveAt;
    this.proactiveStrategyState.lastProactiveAt = now;
    this.proactiveStrategyState.consecutiveProactiveCount += 1;
    this.proactiveStrategyState.totalProactiveCount += 1;
    this.proactiveStrategyState.nudgesSinceLastUserTurn += 1;
    this.proactiveStrategyState.ignoredProactiveStreak = unansweredStreak
      ? this.proactiveStrategyState.ignoredProactiveStreak + 1
      : 0;
    this.proactiveStrategyState.retreatLevel = Math.min(
      3,
      Math.max(
        this.proactiveStrategyState.retreatLevel,
        this.proactiveStrategyState.nudgesSinceLastUserTurn +
          this.proactiveStrategyState.ignoredProactiveStreak,
      ),
    );
    if (this.proactiveStrategyState.ignoredProactiveStreak >= 1) {
      const multiplier = mode === "care" ? 2.2 : 1.6;
      this.proactiveStrategyState.cooldownUntilAt = Math.max(
        this.proactiveStrategyState.cooldownUntilAt,
        now + Math.floor(silenceNudgeBaseCooldownMs(stage) * multiplier),
      );
    }
    this.proactiveStrategyState.lastProactiveMode = mode ?? "";
    if (key) {
      this.recordProactiveLedgerOffer(key, mode, now);
    }
    this.invalidateDerivedCache();
  }

  private updateProactiveLedgerOnUserTurn(userMessage?: string): void {
    if (!proactiveLedgerEnabled() || this.proactiveLedger.size === 0) {
      this.invalidateDerivedCache();
      return;
    }
    const now = Date.now();
    const text = userMessage?.trim() ?? "";
    const keywords = text ? extractKeywords(text) : [];
    const lowSignal = !text || text.length <= 6;
    const latestOfferedAt = this.proactiveStrategyState.lastProactiveAt;

    for (const entry of this.proactiveLedger.values()) {
      if (!entry.lastOfferedAt || entry.lastOfferedAt < latestOfferedAt) continue;
      const answered = lowSignal ? false : proactiveLedgerKeyMatches(entry.key, text, keywords);
      if (answered) {
        entry.lastAnsweredAt = now;
        entry.ignoredCount = 0;
        entry.nextEligibleAt = 0;
      }
    }

    const answeredAny = [...this.proactiveLedger.values()].some(
      (entry) => entry.lastAnsweredAt >= latestOfferedAt && latestOfferedAt > 0,
    );
    if (answeredAny) {
      this.proactiveStrategyState.retreatLevel = 0;
      this.proactiveStrategyState.ignoredProactiveStreak = 0;
      this.proactiveStrategyState.cooldownUntilAt = 0;
    }
    this.invalidateDerivedCache();
  }

  private recordProactiveLedgerOffer(
    key: string,
    mode: ProactiveMode | undefined,
    now: number,
  ): void {
    if (!proactiveLedgerEnabled()) return;
    const entry = this.proactiveLedger.get(key) ?? {
      key,
      lastOfferedAt: 0,
      lastAnsweredAt: 0,
      ignoredCount: 0,
      nextEligibleAt: 0,
      lastMode: "",
    };
    const unanswered =
      entry.lastOfferedAt > 0 && entry.lastAnsweredAt < entry.lastOfferedAt;
    entry.lastOfferedAt = now;
    entry.lastMode = mode ?? "";
    if (unanswered) {
      entry.ignoredCount += 1;
    }
    entry.nextEligibleAt = now + proactiveLedgerCooldownMs(key, mode, entry.ignoredCount);
    this.proactiveLedger.set(key, entry);
    this.invalidateDerivedCache();
  }

  synthesizeContext(options?: { suppressResponseStyleNotes?: boolean }): string | undefined {
    const sections: string[] = [];
    const { profile, relationship } = this;
    const snapshot = this.getSnapshot();

    if (profile.facts.size > 0 || profile.interests.length > 0) {
      const lines: string[] = [];
      for (const [k, v] of profile.facts) lines.push(`${k}：${v}`);
      if (profile.interests.length > 0)
        lines.push(`兴趣爱好：${profile.interests.join("、")}`);
      sections.push(`【用户画像】\n${lines.join("\n")}`);
    }

    if (profile.personalityNotes.length > 0) {
      sections.push(
        `【性格观察】\n${profile.personalityNotes.map((n) => `- ${n}`).join("\n")}`,
      );
    }

    if (!options?.suppressResponseStyleNotes && profile.responseStyleNotes.length > 0) {
      sections.push(
        `【回复风格偏好（候选）】这些只是最近观察到的弱偏好，若用户当轮另有明确要求，以当轮为准。\n${profile.responseStyleNotes.map((n) => `- ${n}`).join("\n")}`,
      );
    }

    if (relationship.turnCount > 0) {
      const stageLabel = snapshot.relationshipStageLabel ?? resolveRelationshipStage(relationship);
      const level = relationship.familiarity > 0.6
        ? "已经很熟了"
        : relationship.familiarity > 0.3
          ? "逐渐熟悉中"
          : "刚认识不久";
      const bond = relationship.emotionalBond > 0.5
        ? "，用户比较信任你" : "";
      let stageHint = "";
      if (relationship.familiarity < 0.25) {
        stageHint = "礼貌一点，多听少抢结论，别太自来熟。";
      } else if (relationship.familiarity < 0.55) {
        stageHint = "更口语一点，可带一点感受，但仍尊重对方节奏。";
      } else {
        stageHint = "更随意、更短句；低落时收一点，别太闹。";
      }
      sections.push(
        `【关系阶段】${stageLabel}\n【关系状态】${level}（聊了 ${relationship.turnCount} 轮）${bond}\n【陪伴阶段提示】${stageHint}`,
      );
      const styleContract = buildRelationshipStyleContract(snapshot);
      if (styleContract) {
        sections.push(styleContract);
      }
    }

    if (relationship.turnCount <= 1) {
      sections.push(
        "【关系校准】你们现在还处在刚开始接触的阶段。只有在上面明确提供了关系轮数、长期摘要或长期主线时，才能据此回答“我们是什么关系”“我们聊了多久”这类问题；否则要按“刚开始聊/还在建立了解”来答，不能说成老朋友、聊了很久，也不能编造具体时长和轮数。",
      );
    }

    const recentTopics = this.topicHistory
      .filter((t) => t.lastTurn >= relationship.turnCount - 3)
      .sort((a, b) => b.depth - a.depth);
    if (recentTopics.length > 0) {
      const topicLines = recentTopics.map(
        (t) => `- ${t.topic}（聊了 ${t.depth} 轮，${sentimentLabel(t.sentiment)}）`,
      );
      sections.push(`【最近话题】\n${topicLines.join("\n")}`);
    }

    const recent = this.moodTrajectory.slice(-5);
    if (recent.length >= 2) {
      const moods = recent.map((m) => m.mood);
      sections.push(`【情绪轨迹】最近几轮：${moods.join(" → ")}`);
    }

    if (this.conversationSummary) {
      sections.push(`【对话摘要】${this.conversationSummary}`);
    }

    if (this.proactiveTopics.length > 0) {
      sections.push(
        `【可以主动聊的话题】${this.proactiveTopics.join("、")}（只在用户话少、主动问起或当前话题相关时自然承接，不要突然翻旧账）`,
      );
    }

    if (snapshot.topicBoundaryState) {
      const topic = snapshot.topicBoundaryState.blockedTopic || "当前话题";
      sections.push(`【话题边界】用户刚说先不聊「${topic}」，本轮不要主动拉回这条线。`);
    }

    const topicSignals = deriveTopicSignalsFromSharedMoments(snapshot);
    const coreLines = topicSignals
      .filter((entry) => entry.isLongHorizon)
      .slice(0, 2)
      .map((entry) => `- ${entry.topic}：${entry.summary}`);
    if (coreLines.length > 0) {
      sections.push(`【长期关系主线】\n${coreLines.join("\n")}`);
    }
    const activeLine = topicSignals.find((entry) => entry.unresolvedCount > 0);
    if (activeLine) {
      sections.push(`【当前未完主线】${activeLine.topic}：${activeLine.summary}`);
    }

    if (this.sharedMoments.length > 0) {
      const recentMoments = this.sharedMoments
        .slice()
        .sort((a, b) =>
          Number(b.unresolved) - Number(a.unresolved) ||
          (b.salience ?? 0) - (a.salience ?? 0) ||
          (b.recurrenceCount ?? 1) - (a.recurrenceCount ?? 1) ||
          b.turn - a.turn,
        )
        .slice(0, 2)
        .map((entry) => {
          const tags = [
            entry.kind !== "routine" ? entry.kind : "",
            entry.unresolved ? "未完" : "",
            entry.recurrenceCount > 1 ? `反复提到${entry.recurrenceCount}次` : "",
          ].filter(Boolean);
          return `- ${entry.summary}${tags.length > 0 ? `（${tags.join(" / ")}）` : ""}`;
        });
      sections.push(`【共同经历锚点】\n${recentMoments.join("\n")}`);
    }

    return sections.length > 0 ? sections.join("\n\n") : undefined;
  }

  buildConversationGuidance(
    userMessage: string,
    analysis?: TurnAnalysisBundle | null,
  ): ConversationGuidance {
    this.observeUserTopicBoundary(userMessage);
    const repairState = this.observeRepairState(userMessage);
    const snap = this.getSnapshot();
    const lines: string[] = [];
    const trimmed = userMessage.trim();
    const greetingLikeTurn = isGreetingLikeTurn(trimmed);
    const structuredInterpretation = analysis?.used ? analysis.interpretation : null;
    const structuredPolicy = analysis?.used ? analysis.policy : null;
    const decisionSeeking =
      structuredInterpretation?.userAct === "decision_seek" ||
      (!structuredInterpretation && detectDecisionSeekingSignal(trimmed));
    const answerNow =
      structuredInterpretation?.userAct === "answer_now" ||
      (!structuredInterpretation && detectAnswerNowSignal(trimmed));
    const contextUpdate = structuredInterpretation?.userAct === "context_update";
    const sceneContinue = structuredInterpretation?.userAct === "scene_continue";
    const vetoTopic = structuredInterpretation?.userAct === "topic_veto";
    const suppressProactive =
      Boolean(
        structuredPolicy &&
        (
          structuredPolicy.shouldGiveJudgment ||
          structuredPolicy.shouldUpdateDecisionContext ||
          structuredInterpretation?.sceneState === "already_in_scene" ||
          structuredInterpretation?.boundaryState === "veto_topic"
        ),
      ) ||
      decisionSeeking ||
      answerNow ||
      contextUpdate ||
      sceneContinue ||
      greetingLikeTurn ||
      vetoTopic ||
      repairState?.level === "trust_drop" ||
      repairState?.level === "rupture";

    const { familiarity, emotionalBond, turnCount } = snap.relationship;
    const sceneImmersionGuidance =
      sceneContinue
        ? "【场景承接】用户已经在共同场景里。按正在发生来接，不要退回邀请、确认或主持式提问。"
        : buildSceneImmersionGuidance(userMessage);
    if (sceneImmersionGuidance) {
      lines.push(sceneImmersionGuidance);
    }
    const realtimeContinuityHint = greetingLikeTurn
      ? null
      : buildRealtimeContinuityHint(snap, userMessage);
    if (realtimeContinuityHint && !sceneContinue) {
      lines.push(realtimeContinuityHint);
    }
    if (greetingLikeTurn) {
      lines.push("【轻接话】这轮只是轻打招呼或确认在不在。先轻轻接住，不主动翻旧账，不把旧重话题拉回当前回复。");
    }
    const repairGuidance = this.buildRepairGuidance(repairState);
    if (repairGuidance) {
      lines.push(repairGuidance);
    }

    if (!analysis?.used && turnCount > 0 && turnCount < 4) {
      lines.push("对话刚开始：语气友好、可多问一句，避免长篇说教。");
    } else if (!analysis?.used && familiarity > 0.55) {
      lines.push("已较熟悉：回复可更短、更口语，不必每句都客套。");
    } else if (!analysis?.used && familiarity > 0.25) {
      lines.push("关系在加深：可适度分享简短感受，再回应用户。");
    }

    if (!analysis?.used && emotionalBond > 0.45) {
      lines.push("用户较信任你：语气可更温柔、少评判。");
    }

    if (analysis?.used) {
      lines.push(buildResponsePolicyGuidance(analysis));
    }

    if (answerNow) {
      lines.push("【先回答】用户明确嫌你老反问。这一轮先直接说判断或建议，不要再用“你是不是”开头。");
    } else if (decisionSeeking) {
      lines.push("【判断优先】用户在问你的判断。第一句先给倾向判断，第二句再补依据，最后才允许轻问。");
    } else if (contextUpdate) {
      lines.push("【更新判断】用户在补充现实约束。先吸收新信息并更新你的判断，不要继续旧追问。");
    }

    const relationshipStyle = analysis?.used
      ? null
      : buildRelationshipStyleGuidance(snap, userMessage);
    if (relationshipStyle) {
      lines.push(relationshipStyle);
    }
    const toneContract =
      analysis?.used
        ? `【语气合同】${buildPolicyToneContract(analysis, {
            relationshipStage: resolveRelationshipStage(snap.relationship),
            familiarity: snap.relationship.familiarity,
            emotionalBond: snap.relationship.emotionalBond,
            userMessage: trimmed,
          })}`
        : buildToneContractGuidance(snap, userMessage);
    if (toneContract) {
      lines.push(toneContract);
    }
    const responseShape =
      analysis?.used
        ? `【本轮回复合同】${buildResponseShapeContract(analysis)}`
        : buildRelationshipResponseShapeGuidance(snap, userMessage);
    if (responseShape) {
      lines.push(responseShape);
    }
    const proactivePosture = buildProactivePostureGuidance(snap);
    if (proactivePosture && !suppressProactive) {
      lines.push(proactivePosture);
    }

    const lastMoods = snap.moodTrajectory.slice(-3).map((m) => m.mood).join("");
    if (/难过|伤心|焦虑|疲惫|烦|丧/.test(lastMoods)) {
      lines.push("近期情绪偏负面：先接住感受，少讲大道理。");
    }

    if (
      trimmed.length > 0 &&
      trimmed.length < 12 &&
      !sceneContinue &&
      !isSceneImmersionLike(trimmed) &&
      !decisionSeeking &&
      !answerNow &&
      !contextUpdate &&
      !(structuredPolicy && structuredPolicy.questionBudget === 0)
    ) {
      lines.push("本轮用户说得简短：可轻问一句「想多聊聊吗」或接话展开，别长篇。");
    }

    if (snap.topicBoundaryState) {
      const topic = snap.topicBoundaryState.blockedTopic || "当前话题";
      lines.push(`【话题边界】用户刚明确说先不聊「${topic}」，请尊重边界，不要再把话题拉回去。`);
    }

    const filteredProactiveTopics = snap.proactiveTopics.filter(
      (topic) => !topicViolatesBoundary(topic, snap),
    );
    if (filteredProactiveTopics.length > 0 && familiarity > 0.35 && !suppressProactive) {
      lines.push(
        `若用户话少、主动问起或话题相关，可从这些方向自然接话：${filteredProactiveTopics.slice(0, 2).join("、")}；不要在新话题里突然翻旧账。`,
      );
    }

    const proactiveCandidate = suppressProactive
      ? null
      : pickProactiveCue(snap, userMessage, {
          silenceNudge: false,
        });
    if (proactiveCandidate) {
      lines.push(`【主动提起候选】仅当本轮和它相关或明显冷场时，才轻轻接回：${sanitizeMemoryEvidenceText(proactiveCandidate.text)}；不要用“对了/你之前/上次你说”开场。`);
    }

    const sharedMomentCandidate = suppressProactive
      ? null
      : pickSharedMomentCue(snap, userMessage, {
          silenceNudge: false,
        });
    if (sharedMomentCandidate) {
      lines.push(`【共同经历提醒】若用户提到相关线索，可自然承接：${sanitizeMemoryEvidenceText(sharedMomentCandidate)}；不要无关时主动翻出来。`);
    }

    return {
      hints: lines.length > 0 ? lines.join("\n") : undefined,
      proactiveCandidate: proactiveCandidate?.text ?? undefined,
      proactiveCandidateKey: proactiveCandidate?.key ?? undefined,
      sharedMomentCandidate: sharedMomentCandidate ?? undefined,
    };
  }

  buildConversationStrategyHints(
    userMessage: string,
    analysis?: TurnAnalysisBundle | null,
  ): string | undefined {
    return this.buildConversationGuidance(userMessage, analysis).hints;
  }

  private extractWorkingMemoryConstraints(userMessage: string): string[] {
    const explicitMatches = [
      ...userMessage.matchAll(/((?:我)?每个月挣[^，。！？；;,.!?]{1,12})/gu),
      ...userMessage.matchAll(/((?:月(?:收入|薪)|工资(?:只有)?)[^，。！？；;,.!?]{1,12})/gu),
      ...userMessage.matchAll(/(((?:我)?(?:还欠|欠了?|负债))[^，。！？；;,.!?]{1,12})/gu),
      ...userMessage.matchAll(/((?:赔了)[^，。！？；;,.!?]{1,12})/gu),
      ...userMessage.matchAll(/((?:房租(?:也)?快到了|手里只剩|现金(?:流)?(?:很)?紧|只剩[^，。！？；;,.!?]{1,12}|存款[^，。！？；;,.!?]{1,12})[^，。！？；;,.!?]{0,12})/gu),
    ]
      .map((match) => clipWorkingMemoryText(match[1] ?? "", 48))
      .filter(Boolean);
    const fragments = userMessage
      .split(/[，。！？；;,.!?]/u)
      .map((part) => clipWorkingMemoryText(part, 48))
      .filter(Boolean);
    const constraintLike = /(\d|钱|预算|负债|花呗|房租|贷款|网贷|赔偿|现金|现金流|存款|手里|只剩|offer|面试|时间|今天|这周|这个月|最近|已经|还|只能|不能|没法|不想|别|先不)/u;
    return dedupeWorkingMemoryConstraints([
      ...explicitMatches,
      ...fragments.filter((entry) => constraintLike.test(entry)),
    ]).slice(0, WORKING_MEMORY_MAX_CONSTRAINTS);
  }

  private deriveWorkingMemoryNeed(
    trimmedUserMessage: string,
    interpretation: TurnInterpretation | null,
    directCapabilityId: string | null,
  ): string {
    if (directCapabilityId === "date_recap") {
      return "用户想回顾某个日期聊过什么。";
    }
    if (directCapabilityId === "time") {
      return "用户想确认当前时间或日期。";
    }
    if (!interpretation) {
      return clipWorkingMemoryText(trimmedUserMessage, 64);
    }

    const label = interpretation.topicUpdate?.label?.trim();
    switch (interpretation.userAct) {
      case "decision_seek":
        return label
          ? `用户想就「${label}」得到明确判断。`
          : `用户想得到明确判断：${clipWorkingMemoryText(trimmedUserMessage, 36)}`;
      case "answer_now":
        return `用户要直接回答：${clipWorkingMemoryText(trimmedUserMessage, 36)}`;
      case "context_update":
        return label
          ? `用户在补充「${label}」的现实约束。`
          : "用户在补充新的现实约束。";
      case "scene_continue":
        return `用户在继续当前场景：${clipWorkingMemoryText(trimmedUserMessage, 36)}`;
      case "emotional_share":
        return label
          ? `用户在说「${label}」这条线上的感受。`
          : `用户在表达当前感受：${clipWorkingMemoryText(trimmedUserMessage, 36)}`;
      case "direct_question":
        return `用户在问：${clipWorkingMemoryText(trimmedUserMessage, 36)}`;
      default:
        return clipWorkingMemoryText(trimmedUserMessage, 64);
    }
  }

  private deriveWorkingMemoryActiveThread(
    trimmedUserMessage: string,
    interpretation: TurnInterpretation | null,
    directCapabilityId: string | null,
    active: WorkingMemoryV2 | null,
  ): string {
    if (directCapabilityId === "date_recap") {
      return "当前在回顾之前某个时间点的对话。";
    }
    if (directCapabilityId === "time") {
      return "当前在确认时间或日期。";
    }
    if (!interpretation) {
      return active?.activeThread ?? "";
    }

    if (interpretation.sceneType === "high_risk_distress") {
      return "当前在处理高风险现实压力，先稳住安全和眼前状态。";
    }
    if (interpretation.sceneType === "relational_recall") {
      return "当前在校验关系连续性，先答记得的部分，不要靠猜。";
    }
    if (interpretation.sceneType === "practical_judgment") {
      const label = interpretation.topicUpdate?.label?.trim();
      return label
        ? `当前在处理「${label}」这条现实判断线。`
        : "当前在处理现实判断和约束更新。";
    }
    if (
      interpretation.userAct === "decision_seek" ||
      interpretation.userAct === "answer_now" ||
      interpretation.userAct === "context_update"
    ) {
      const label = interpretation.topicUpdate?.label?.trim();
      return label
        ? `当前在处理「${label}」这条现实判断线。`
        : "当前在处理现实判断和约束更新。";
    }
    if (interpretation.userAct === "scene_continue") {
      return "当前在继续同一场景，不要重新开场。";
    }
    if (interpretation.userAct === "emotional_share") {
      return `当前在接住这轮感受：${clipWorkingMemoryText(trimmedUserMessage, 28)}`;
    }
    return active?.activeThread ?? "";
  }

  private deriveWorkingMemorySceneState(
    userMessage: string,
    interpretation: TurnInterpretation | null,
    directCapabilityId: string | null,
  ): WorkingMemorySceneState {
    if (directCapabilityId) return "decision";
    if (interpretation?.sceneState === "already_in_scene" || interpretation?.userAct === "scene_continue") {
      return "immersive";
    }
    if (
      interpretation?.userAct === "decision_seek" ||
      interpretation?.userAct === "answer_now" ||
      interpretation?.userAct === "context_update" ||
      interpretation?.userAct === "direct_question"
    ) {
      return "decision";
    }
    if (/计划|打算|准备|想要|目标|安排|下一步|之后/u.test(userMessage)) {
      return "planning";
    }
    return "none";
  }

  private deriveWorkingMemoryOpenLoop(
    trimmedUserMessage: string,
    interpretation: TurnInterpretation | null,
    directCapabilityId: string | null,
    active: WorkingMemoryV2 | null,
  ): string {
    if (directCapabilityId) return "";
    if (interpretation?.boundaryState === "veto_topic") return "";
    if (interpretation?.userAct === "context_update") {
      return active?.openLoop || active?.currentNeed || clipWorkingMemoryText(trimmedUserMessage, 52);
    }
    if (
      interpretation?.userAct === "decision_seek" ||
      interpretation?.userAct === "answer_now" ||
      interpretation?.userAct === "direct_question" ||
      interpretation?.userAct === "scene_continue" ||
      interpretation?.userAct === "emotional_share"
    ) {
      return clipWorkingMemoryText(trimmedUserMessage, 52);
    }
    return active?.openLoop ?? "";
  }

  private deriveWorkingMemoryDoNotTouch(
    interpretation: TurnInterpretation | null,
    responsePolicy: ResponsePolicy | null,
    active: WorkingMemoryV2 | null,
  ): string[] {
    if (!interpretation || !responsePolicy) {
      return active?.doNotTouch ? [...active.doNotTouch] : [];
    }
    if (interpretation.boundaryState === "veto_topic") {
      return [];
    }

    const bans = new Set(responsePolicy.bans);
    const rules: string[] = [];
    if (bans.has("no_jokes")) {
      rules.push("不要开玩笑");
    }
    if (bans.has("no_topic_pivot")) {
      rules.push("不要把话题拉回轻聊或不相干方向");
    }
    if (bans.has("no_speculative_memory")) {
      rules.push("记不准就承认，不要靠猜");
    }
    if (bans.has("no_shallow_reassurance")) {
      rules.push("不要轻飘安慰或无依据粗算");
    }
    if (bans.has("no_repeat_user_question")) {
      rules.push("不要把问题原样丢回去");
    }
    if (bans.has("no_reopen_vetoed_topic")) {
      rules.push("不要回拉用户刚拒绝的话题");
    }

    return rules.filter((entry, index, list) => list.indexOf(entry) === index).slice(0, 3);
  }

  private observeRepairState(userMessage: string): RepairState | null {
    const trimmed = userMessage.trim();
    if (!trimmed) return this.getActiveRepairState();

    let nextLevel: RepairStateLevel | null = null;
    let nextReason = "";

    if (/(傻逼|闭嘴|滚|有病吧|别说了|别烦我)/u.test(trimmed)) {
      nextLevel = "rupture";
      nextReason = "用户已经明显被惹毛了，先止损，不要解释或继续追问。";
    } else if (
      /(你安慰人都不会|我不想回答你问题了|你到底有没有在听|你根本没懂|你真记性不好|我已经说过了|你怎么又问|别再问了)/u.test(
        trimmed,
      )
    ) {
      nextLevel = "trust_drop";
      nextReason = "你刚刚没有接住对方，先承认失手，别继续追问或替自己辩解。";
    } else if (/(你在问我呢|你怎么老是问我|你忘了|再想想|不是这个意思)/u.test(trimmed)) {
      nextLevel = "minor_miss";
      nextReason = "这轮先修正理解，直接回到对方真正要的点，不要绕。";
    }

    if (!nextLevel) {
      return this.getActiveRepairState();
    }

    this.repairState = {
      level: nextLevel,
      reason: nextReason,
      lastUpdatedTurn: this.relationship.turnCount,
    };
    this.invalidateDerivedCache();
    return this.getActiveRepairState();
  }

  private buildRepairGuidance(repairState: RepairState | null): string | null {
    if (!repairState || repairState.level === "none") return null;
    if (repairState.level === "rupture") {
      return "【关系修复】用户已经明显烦了。先短句承认你刚刚没接住，别替自己解释，别继续追问，别把话题拉回你想聊的线；先站到对方这边，收住语气，再给一句低打扰的修复回应。";
    }
    if (repairState.level === "trust_drop") {
      return `【关系修复】当前不是普通续聊，而是在修复信任下滑。${repairState.reason} 回应顺序：先承认你刚刚没接住或问错了，再直接回到对方在意的点，不要急着安抚或讲道理。`;
    }
    return `【关系修复】当前先修正理解偏差。${repairState.reason} 先改口并贴着对方原话接住，不要继续复述旧理解。`;
  }

  markContinuityCueUsed(input: {
    proactiveCandidate?: string | null;
    sharedMomentCandidate?: string | null;
    turnOffset?: number;
  }): void {
    const targetTurn = this.relationship.turnCount + (input.turnOffset ?? 1);
    if (input.proactiveCandidate?.trim()) {
      this.continuityCueState.lastProactiveHook = input.proactiveCandidate.trim();
      this.continuityCueState.lastProactiveTurn = targetTurn;
    }
    if (input.sharedMomentCandidate?.trim()) {
      const summary = input.sharedMomentCandidate.trim();
      this.continuityCueState.lastSharedMomentSummary = summary;
      this.continuityCueState.lastSharedMomentTurn = targetTurn;
      const matched = this.sharedMoments.find((entry) => entry.summary === summary);
      if (matched) {
        matched.lastReferencedAt = Date.now();
      }
    }
    this.invalidateDerivedCache();
  }

  private invalidateDerivedCache(): void {
    this.derivedCache = null;
  }

  private getActiveWorkingMemory(): WorkingMemoryV2 | null {
    if (!this.workingMemory) return null;
    if (this.relationship.turnCount - this.workingMemory.lastUpdatedTurn >= WORKING_MEMORY_TTL_TURNS) {
      this.workingMemory = null;
      return null;
    }
    return {
      activeThread: this.workingMemory.activeThread,
      currentNeed: this.workingMemory.currentNeed,
      currentConstraints: [...this.workingMemory.currentConstraints],
      openLoop: this.workingMemory.openLoop,
      doNotTouch: [...this.workingMemory.doNotTouch],
      sceneState: this.workingMemory.sceneState,
      lastUpdatedTurn: this.workingMemory.lastUpdatedTurn,
    };
  }

  private getActiveTopicBoundaryState(): TopicBoundaryState | null {
    if (!this.topicBoundaryState) return null;
    if (this.relationship.turnCount > this.topicBoundaryState.expiresAtTurn) {
      this.topicBoundaryState = null;
      return null;
    }
    return {
      blockedTopic: this.topicBoundaryState.blockedTopic,
      blockedKeywords: [...this.topicBoundaryState.blockedKeywords],
      setAtTurn: this.topicBoundaryState.setAtTurn,
      expiresAtTurn: this.topicBoundaryState.expiresAtTurn,
    };
  }

  private getActiveRepairState(): RepairState | null {
    if (!this.repairState || this.repairState.level === "none") return null;
    if (this.relationship.turnCount - this.repairState.lastUpdatedTurn >= REPAIR_STATE_TTL_TURNS) {
      this.repairState = null;
      return null;
    }
    return {
      level: this.repairState.level,
      reason: this.repairState.reason,
      lastUpdatedTurn: this.repairState.lastUpdatedTurn,
    };
  }

  private buildDerivedInputs(
    episodes: Episode[],
    topicThreads: TopicThread[],
  ): SlowBrainSnapshot {
    return {
      userProfile: {
        facts: new Map(this.profile.facts),
        interests: [...this.profile.interests],
        personalityNotes: [...this.profile.personalityNotes],
        responseStyleNotes: [...this.profile.responseStyleNotes],
      },
      relationship: { ...this.relationship },
      topicHistory: this.topicHistory.map((t) => ({ ...t })),
      moodTrajectory: [...this.moodTrajectory],
      conversationSummary: this.conversationSummary,
      proactiveTopics: [...this.proactiveTopics],
      sharedMoments: this.sharedMoments.map((entry) => ({ ...entry })),
      episodes,
      topicThreads,
      workingMemory: this.getActiveWorkingMemory() ?? undefined,
      repairState: this.getActiveRepairState() ?? undefined,
      continuityCueState: { ...this.continuityCueState },
      topicBoundaryState: this.getActiveTopicBoundaryState() ?? undefined,
      proactiveLedger: [...this.proactiveLedger.values()].map((entry) => ({ ...entry })),
      proactiveStrategyState: { ...this.proactiveStrategyState },
      relationshipStageLabel: undefined,
      replyShapeContract: undefined,
      memoryCarryRule: undefined,
      proactivePosture: undefined,
    };
  }

  private getDerivedCache(): NonNullable<SlowBrainStore["derivedCache"]> {
    if (this.derivedCache) return this.derivedCache;

    const topicSignals = deriveTopicSignalsFromSharedMoments({
      userProfile: {
        facts: new Map(this.profile.facts),
        interests: [...this.profile.interests],
        personalityNotes: [...this.profile.personalityNotes],
        responseStyleNotes: [...this.profile.responseStyleNotes],
      },
      relationship: { ...this.relationship },
      topicHistory: this.topicHistory.map((t) => ({ ...t })),
      moodTrajectory: [...this.moodTrajectory],
      conversationSummary: this.conversationSummary,
      proactiveTopics: [...this.proactiveTopics],
      sharedMoments: this.sharedMoments.map((entry) => ({ ...entry })),
      continuityCueState: { ...this.continuityCueState },
      repairState: this.getActiveRepairState() ?? undefined,
      topicBoundaryState: this.getActiveTopicBoundaryState() ?? undefined,
      proactiveLedger: [...this.proactiveLedger.values()].map((entry) => ({ ...entry })),
      proactiveStrategyState: { ...this.proactiveStrategyState },
    });
    const episodes = buildCompatibilityEpisodesFromSignals(
      topicSignals,
      this.relationship.turnCount,
    );
    const topicThreads = buildCompatibilityTopicThreadsFromSignals(topicSignals);
    const relationshipStageLabel = resolveRelationshipStage(this.relationship);
    const derivedInputs = this.buildDerivedInputs(episodes, topicThreads);
    const replyShapeContract = buildRelationshipResponseShapeContract(derivedInputs);
    const memoryCarryRule = resolveRelationshipStyleProfile(
      derivedInputs,
      "",
    ).memoryIntegrationStyle;
    const proactivePosture = buildProactivePostureGuidance(derivedInputs) ?? undefined;

    this.derivedCache = {
      topicSignals,
      episodes,
      topicThreads,
      relationshipStageLabel,
      replyShapeContract,
      memoryCarryRule,
      proactivePosture,
    };
    return this.derivedCache;
  }

  private cloneEpisodesForSnapshot(episodes: Episode[]): Episode[] {
    return episodes.map((entry) => ({
      ...entry,
      sourceTopics: [...entry.sourceTopics],
      semanticKeywords: [...entry.semanticKeywords],
      originMomentSummaries: [...entry.originMomentSummaries],
    }));
  }

  private cloneTopicThreadsForSnapshot(topicThreads: TopicThread[]): TopicThread[] {
    return topicThreads.map((entry) => ({
      ...entry,
      relatedTopics: entry.relatedTopics ? [...entry.relatedTopics] : undefined,
      semanticKeywords: entry.semanticKeywords ? [...entry.semanticKeywords] : undefined,
    }));
  }

  buildSilenceNudgeUserMessage(): string | null {
    return this.buildSilenceNudgePlan()?.userMessage ?? null;
  }

  buildSilenceNudgePlan(): SilenceNudgePlan | null {
    const minTurns = Number(process.env.REMI_SILENCE_NUDGE_MIN_TURNS ?? 2);
    const snap = this.getSnapshot();
    if (snap.relationship.turnCount < minTurns) return null;
    if (!shouldTriggerSilenceNudge(snap)) return null;

    const proactiveCandidate = pickProactiveCue(snap, "", {
      silenceNudge: true,
    });
    const sharedMomentCandidate = pickSharedMomentCue(snap, "", {
      silenceNudge: true,
    });
    const topicHint =
      sharedMomentCandidate
        ? `如果自然，就轻轻接一下这条曾经聊过、现在仍适合回访的线：${sanitizeMemoryEvidenceText(sharedMomentCandidate)}。`
        : proactiveCandidate
          ? `如果自然，就从这个方向接话：${sanitizeMemoryEvidenceText(proactiveCandidate.text)}。`
          : snap.proactiveTopics.length > 0
            ? `可以参考的轻松方向：${snap.proactiveTopics.slice(0, 3).join("、")}。`
            : "不必硬找话题，一句问候或分享小事也可以。";

    const strategyMode = resolveProactiveMode(snap);
    const toneDirective = buildProactiveToneDirective(snap, strategyMode);

    return {
      userMessage:
        `（系统情境：对方有一段时间没发消息了。请你作为 Remi，用一两句自然、温柔的中文主动开口，像在陪在身边一样；${toneDirective}${topicHint}不要一次问太多问题，不要显得像在催对方回复。）`,
      proactiveCandidate: proactiveCandidate?.text ?? undefined,
      proactiveCandidateKey: proactiveCandidate?.key ?? undefined,
      sharedMomentCandidate: sharedMomentCandidate ?? undefined,
      strategyMode,
    };
  }
}
