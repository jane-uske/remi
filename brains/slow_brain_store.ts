// ── Slow Brain State Store ──────────────────────────────────
// 每条 WebSocket 连接独立一份（C1）。

import type { PersistentRelationshipStateV1 } from "../memory/relationship_state";
import { detectAnswerNowSignal, detectDecisionSeekingSignal } from "../brain/tone_policy";
import {
  buildPolicyToneContract,
  buildResponsePolicyGuidance,
  buildResponseShapeContract,
  type TurnAnalysisBundle,
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
}

export class SlowBrainStore {
  private readonly profile: UserProfile = {
    facts: new Map(),
    interests: [],
    personalityNotes: [],
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
    this.topicBoundaryState = null;
    this.invalidateDerivedCache();
  }

  getSnapshot(): SlowBrainSnapshot {
    const derived = this.getDerivedCache();
    return {
      userProfile: {
        facts: new Map(this.profile.facts),
        interests: [...this.profile.interests],
        personalityNotes: [...this.profile.personalityNotes],
      },
      relationship: { ...this.relationship },
      topicHistory: this.topicHistory.map((t) => ({ ...t })),
      moodTrajectory: [...this.moodTrajectory],
      conversationSummary: this.conversationSummary,
      proactiveTopics: [...this.proactiveTopics],
      sharedMoments: this.sharedMoments.map((entry) => ({ ...entry })),
      episodes: this.cloneEpisodesForSnapshot(derived.episodes),
      topicThreads: this.cloneTopicThreadsForSnapshot(derived.topicThreads),
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

  synthesizeContext(): string | undefined {
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
        `【可以主动聊的话题】${this.proactiveTopics.join("、")}（在合适时机自然提起）`,
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
    const snap = this.getSnapshot();
    const lines: string[] = [];
    const trimmed = userMessage.trim();
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
      vetoTopic;

    const { familiarity, emotionalBond, turnCount } = snap.relationship;
    const sceneImmersionGuidance =
      sceneContinue
        ? "【场景承接】用户已经在共同场景里。按正在发生来接，不要退回邀请、确认或主持式提问。"
        : buildSceneImmersionGuidance(userMessage);
    if (sceneImmersionGuidance) {
      lines.push(sceneImmersionGuidance);
    }
    const realtimeContinuityHint = buildRealtimeContinuityHint(snap, userMessage);
    if (realtimeContinuityHint && !sceneContinue) {
      lines.push(realtimeContinuityHint);
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
        `若用户话少或冷场，可从这些方向自然接话：${filteredProactiveTopics.slice(0, 2).join("、")}。`,
      );
    }

    const proactiveCandidate = suppressProactive
      ? null
      : pickProactiveCue(snap, userMessage, {
          silenceNudge: false,
        });
    if (proactiveCandidate) {
      lines.push(`【主动提起候选】如果这轮适合自然续聊，可轻轻接回：${proactiveCandidate.text}`);
    }

    const sharedMomentCandidate = suppressProactive
      ? null
      : pickSharedMomentCue(snap, userMessage, {
          silenceNudge: false,
        });
    if (sharedMomentCandidate) {
      lines.push(`【共同经历提醒】若用户提到相关线索，可自然承接：${sharedMomentCandidate}`);
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

  private buildDerivedInputs(
    episodes: Episode[],
    topicThreads: TopicThread[],
  ): SlowBrainSnapshot {
    return {
      userProfile: {
        facts: new Map(this.profile.facts),
        interests: [...this.profile.interests],
        personalityNotes: [...this.profile.personalityNotes],
      },
      relationship: { ...this.relationship },
      topicHistory: this.topicHistory.map((t) => ({ ...t })),
      moodTrajectory: [...this.moodTrajectory],
      conversationSummary: this.conversationSummary,
      proactiveTopics: [...this.proactiveTopics],
      sharedMoments: this.sharedMoments.map((entry) => ({ ...entry })),
      episodes,
      topicThreads,
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
      },
      relationship: { ...this.relationship },
      topicHistory: this.topicHistory.map((t) => ({ ...t })),
      moodTrajectory: [...this.moodTrajectory],
      conversationSummary: this.conversationSummary,
      proactiveTopics: [...this.proactiveTopics],
      sharedMoments: this.sharedMoments.map((entry) => ({ ...entry })),
      continuityCueState: { ...this.continuityCueState },
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
        ? `如果自然，就轻轻接一下你们上次聊过的这件事：${sharedMomentCandidate}。`
        : proactiveCandidate
          ? `如果自然，就从这个方向接话：${proactiveCandidate.text}。`
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
