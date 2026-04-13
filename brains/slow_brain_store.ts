// ── Slow Brain State Store ──────────────────────────────────
// 每条 WebSocket 连接独立一份（C1）。

import type { PersistentRelationshipStateV1 } from "../memory/relationship_state";

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
    const episodes = snap.episodes ?? [];
    const topicThreads = snap.topicThreads ?? [];
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
      episodes: episodes.map((entry) => ({
        ...entry,
        sourceTopics: [...entry.sourceTopics],
        semanticKeywords: [...entry.semanticKeywords],
        originMomentSummaries: [...entry.originMomentSummaries],
      })),
      topicThreads: topicThreads.map((entry) => ({ ...entry })),
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
        stageHint =
          "说话可礼貌、略带好奇，多倾听，少自来熟；称呼自然即可。";
      } else if (relationship.familiarity < 0.55) {
        stageHint =
          "可以偶尔用更口语的表达，适度分享你的小感受，仍尊重对方节奏。";
      } else {
        stageHint =
          "可以更随意、更短句，像老朋友一样；可以开玩笑、撒娇一点，但对方低落时要收一点。";
      }
      sections.push(
        `【关系阶段】${stageLabel}\n【关系状态】${level}（聊了 ${relationship.turnCount} 轮）${bond}\n【陪伴阶段提示】${stageHint}`,
      );
      if (snapshot.replyShapeContract?.trim()) {
        sections.push(`【本轮回复合同】${snapshot.replyShapeContract.trim()}`);
      }
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

    if ((snapshot.topicThreads ?? []).length > 0) {
      const threads = (snapshot.topicThreads ?? []).slice(0, 3);
      const coreLines = threads
        .filter((entry) => (entry.memoryLayer ?? "active") === "core")
        .slice(0, 2)
        .map((entry) => `- ${entry.topic}：${entry.bridgeSummary || entry.summary}`);
      if (coreLines.length > 0) {
        sections.push(`【长期关系主线】\n${coreLines.join("\n")}`);
      }
      const activeLine = threads.find((entry) => entry.unresolvedCount > 0);
      if (activeLine) {
        sections.push(`【当前未完主线】${activeLine.topic}：${activeLine.bridgeSummary || activeLine.summary}`);
      }
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

  buildConversationGuidance(userMessage: string): ConversationGuidance {
    this.observeUserTopicBoundary(userMessage);
    const snap = this.getSnapshot();
    const lines: string[] = [];

    const { familiarity, emotionalBond, turnCount } = snap.relationship;
    const sceneImmersionGuidance = buildSceneImmersionGuidance(userMessage);
    if (sceneImmersionGuidance) {
      lines.push(sceneImmersionGuidance);
    }
    const realtimeContinuityHint = buildRealtimeContinuityHint(snap, userMessage);
    if (realtimeContinuityHint) {
      lines.push(realtimeContinuityHint);
    }

    if (turnCount > 0 && turnCount < 4) {
      lines.push("对话刚开始：语气友好、可多问一句，避免长篇说教。");
    } else if (familiarity > 0.55) {
      lines.push("已较熟悉：回复可更短、更口语，不必每句都客套。");
    } else if (familiarity > 0.25) {
      lines.push("关系在加深：可适度分享简短感受，再回应用户。");
    }

    if (emotionalBond > 0.45) {
      lines.push("用户较信任你：语气可更温柔、少评判。");
    }

    const relationshipStyle = buildRelationshipStyleGuidance(snap, userMessage);
    if (relationshipStyle) {
      lines.push(relationshipStyle);
    }
    const responseShape = buildRelationshipResponseShapeGuidance(snap, userMessage);
    if (responseShape) {
      lines.push(responseShape);
    }
    const proactivePosture = buildProactivePostureGuidance(snap);
    if (proactivePosture) {
      lines.push(proactivePosture);
    }

    const lastMoods = snap.moodTrajectory.slice(-3).map((m) => m.mood).join("");
    if (/难过|伤心|焦虑|疲惫|烦|丧/.test(lastMoods)) {
      lines.push("近期情绪偏负面：先共情与确认感受，少给大道理。");
    }

    const trimmed = userMessage.trim();
    if (trimmed.length > 0 && trimmed.length < 12 && !isSceneImmersionLike(trimmed)) {
      lines.push("本轮用户说得简短：可轻问一句「想多聊聊吗」或接话展开，别长篇。");
    }

    if (snap.topicBoundaryState) {
      const topic = snap.topicBoundaryState.blockedTopic || "当前话题";
      lines.push(`【话题边界】用户刚明确说先不聊「${topic}」，请尊重边界，不要再把话题拉回去。`);
    }

    const filteredProactiveTopics = snap.proactiveTopics.filter(
      (topic) => !topicViolatesBoundary(topic, snap),
    );
    if (filteredProactiveTopics.length > 0 && familiarity > 0.35) {
      lines.push(
        `若用户话少或冷场，可从这些方向自然接话：${filteredProactiveTopics.slice(0, 2).join("、")}。`,
      );
    }

    const proactiveCandidate = pickProactiveCue(snap, userMessage, {
      silenceNudge: false,
    });
    if (proactiveCandidate) {
      lines.push(`【主动提起候选】如果这轮适合自然续聊，可轻轻接回：${proactiveCandidate.text}`);
    }

    const sharedMomentCandidate = pickSharedMomentCue(snap, userMessage, {
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

  buildConversationStrategyHints(userMessage: string): string | undefined {
    return this.buildConversationGuidance(userMessage).hints;
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

    const episodes = buildEpisodes(
      this.sharedMoments,
      this.topicHistory,
      this.conversationSummary,
      this.relationship.turnCount,
    );
    const topicThreads = buildTopicThreads(
      episodes,
      this.conversationSummary,
    );
    const relationshipStageLabel = resolveRelationshipStage(this.relationship);
    const derivedInputs = this.buildDerivedInputs(episodes, topicThreads);
    const replyShapeContract = buildRelationshipResponseShapeContract(derivedInputs);
    const memoryCarryRule = resolveRelationshipStyleProfile(
      derivedInputs,
      "",
    ).memoryIntegrationStyle;
    const proactivePosture = buildProactivePostureGuidance(derivedInputs) ?? undefined;

    this.derivedCache = {
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

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function sentimentLabel(s: TopicEntry["sentiment"]): string {
  return s === "positive" ? "正面" : s === "negative" ? "负面" : "中性";
}

function parseBooleanFlag(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === "") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "1" || normalized === "true") return true;
  if (normalized === "0" || normalized === "false") return false;
  return fallback;
}

function relationshipStyleGuidanceEnabled(): boolean {
  return parseBooleanFlag(process.env.REMI_RELATIONSHIP_STYLE_GUIDANCE_ENABLED, true);
}

function realtimeContinuityHintEnabled(): boolean {
  return parseBooleanFlag(process.env.REMI_REALTIME_CONTINUITY_HINT_ENABLED, true);
}

function proactivePromptEnabled(): boolean {
  return parseBooleanFlag(process.env.REMI_PROACTIVE_PROMPT_ENABLED, true);
}

function proactiveLedgerEnabled(): boolean {
  return parseBooleanFlag(process.env.REMI_PROACTIVE_LEDGER_ENABLED, true);
}

function proactiveCooldownTurns(): number {
  const raw = Number(process.env.REMI_PROACTIVE_COOLDOWN_TURNS ?? 3);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 3;
}

function sharedMomentCooldownTurns(): number {
  const raw = Number(process.env.REMI_SHARED_MOMENT_COOLDOWN_TURNS ?? 4);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 4;
}

function topicBoundaryTtlTurns(): number {
  const raw = Number(process.env.REMI_TOPIC_BOUNDARY_TTL_TURNS ?? 4);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 4;
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\u4e00-\u9fff]+/gu, " ")
    .trim();
}

function extractKeywords(text: string): string[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  const raw = normalized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const token of raw) {
    if (!seen.has(token)) {
      seen.add(token);
      keywords.push(token);
    }
    if (/^[\u4e00-\u9fff]{4,}$/u.test(token)) {
      for (let size = 2; size <= 3; size++) {
        for (let index = 0; index + size <= token.length; index++) {
          const slice = token.slice(index, index + size);
          if (seen.has(slice)) continue;
          seen.add(slice);
          keywords.push(slice);
        }
      }
    }
    if (keywords.length >= 48) break;
  }
  return keywords;
}

function mergeSemanticKeywords(existing: string[], next: string[]): string[] {
  const merged = new Set<string>();
  for (const token of [...existing, ...next]) {
    const trimmed = token.trim();
    if (!trimmed || trimmed.length < 2) continue;
    merged.add(trimmed);
    if (merged.size >= 12) break;
  }
  return [...merged];
}

const RELATIONSHIP_ANCHOR_KEYWORDS = [
  "误解",
  "委屈",
  "焦虑",
  "失眠",
  "睡眠",
  "工作",
  "压力",
  "崩溃",
  "低落",
  "难过",
  "疲惫",
  "散步",
  "跑步",
  "冲突",
  "吵架",
  "关系",
  "家人",
  "朋友",
  "同事",
  "陪伴",
] as const;

function extractAnchorKeywords(parts: string[]): string[] {
  const text = parts.join(" ");
  return RELATIONSHIP_ANCHOR_KEYWORDS.filter((keyword) => text.includes(keyword));
}

function buildSemanticKeywords(parts: string[]): string[] {
  return mergeSemanticKeywords(
    extractAnchorKeywords(parts),
    parts.flatMap((part) => extractKeywords(part)),
  );
}

function keywordOverlapCount(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const bSet = new Set(b);
  let overlap = 0;
  for (const token of a) {
    if (bSet.has(token)) overlap += 1;
  }
  return overlap;
}

type RelationshipStage =
  | "初识观察期"
  | "建立关系期"
  | "熟悉加深期"
  | "亲密稳定期";

function resolveRelationshipStage(
  relationship: SlowBrainSnapshot["relationship"],
): RelationshipStage {
  const { familiarity, emotionalBond, turnCount } = relationship;
  if (familiarity > 0.72 && emotionalBond > 0.55 && turnCount >= 8) {
    return "亲密稳定期";
  }
  if (familiarity > 0.45 && turnCount >= 4) {
    return "熟悉加深期";
  }
  if (familiarity > 0.2 || turnCount >= 2) {
    return "建立关系期";
  }
  return "初识观察期";
}

function buildRelationshipStyleGuidance(
  snap: SlowBrainSnapshot,
  userMessage: string,
): string | null {
  if (!relationshipStyleGuidanceEnabled()) return null;
  const profile = resolveRelationshipStyleProfile(snap, userMessage);
  return `【关系表达风格】当前更像${profile.stage}；${profile.addressStyle}；${profile.careStyle}；${profile.followUpStyle}；${profile.emotionCarryStyle}；${profile.initiativeStyle}；${profile.replyLengthStyle}；${profile.openingStyle}；${profile.wordingStyle}；${profile.closingStyle}；${profile.repairStyle}；${profile.memoryIntegrationStyle}。`;
}

function buildRelationshipStyleContract(snap: SlowBrainSnapshot): string | null {
  const topThread = (snap.topicThreads ?? [])[0];
  const profile = resolveRelationshipStyleProfile(snap, "");
  const threadHint = topThread
    ? `当前长期主线优先围绕：${topThread.topic}${topThread.unresolvedCount > 0 ? "（这条线还没完全过去）" : ""}。`
    : "";
  return `【关系风格合同】整段对话都按${profile.stage}来：${profile.openingStyle}；${profile.wordingStyle}；${profile.followUpStyle}；${profile.closingStyle}；${profile.initiativeStyle}。${buildRelationshipResponseShapeContract(snap)}${threadHint}`;
}

function buildRelationshipResponseShapeGuidance(
  snap: SlowBrainSnapshot,
  userMessage: string,
): string | null {
  const trimmed = userMessage.trim();
  if (!trimmed) return null;
  if (isSceneImmersionLike(trimmed)) {
    return "【回复结构】如果用户已经把你们放进同一个场景里，第一句直接承接正在发生的动作、距离或氛围；第二句再补一点感受或细节。不要把回复退回成“要不要我陪你想象”“想不想让我陪你”这类重新开场的邀请。";
  }
  return `【回复结构】${buildRelationshipResponseShapeContract(snap)}`;
}

function buildSceneImmersionGuidance(userMessage: string): string | null {
  const trimmed = userMessage.trim();
  if (!isSceneImmersionLike(trimmed)) return null;
  return "【场景承接】用户这句已经在共同场景里，不是在征求你要不要开始想象。请把场景当成正在发生来接：直接进入同一画面，不要先退回到邀请、确认或主持式提问。";
}

function buildRelationshipResponseShapeContract(snap: SlowBrainSnapshot): string {
  const stage = resolveRelationshipStage(snap.relationship);
  const topThread = (snap.topicThreads ?? [])[0];
  const unresolvedWeight = topThread?.unresolvedCount ?? 0;
  if (stage === "亲密稳定期") {
    return unresolvedWeight > 0
      ? "开头先用一句很短的话接住当前感觉；中段围绕那条长期主线只推进一小步；收尾留一句在场式陪伴，不要一下子总结完。"
      : "开头先轻轻接住；中段像熟人来回对话一样推进；收尾别太正式，留一个轻松的小口继续聊。";
  }
  if (stage === "熟悉加深期") {
    return unresolvedWeight > 0
      ? "开头先回应核心情绪；中段只围绕主线追问一步；收尾给一个温柔但不过界的小台阶。"
      : "开头先回事实或感受；中段补一层轻追问；收尾留空间给对方决定要不要多说。";
  }
  if (stage === "建立关系期") {
    return "开头先回到用户刚说的点；中段不要拉太满；收尾保持自然，不要突然很亲密。";
  }
  return "开头礼貌接住；中段多听少抢结论；收尾轻一点，别过度定义关系。";
}

function pickProactiveHook(
  snap: SlowBrainSnapshot,
  userMessage: string,
  options: { silenceNudge: boolean },
): string | null {
  return pickProactiveCue(snap, userMessage, options)?.text ?? null;
}

function pickProactiveCue(
  snap: SlowBrainSnapshot,
  userMessage: string,
  options: { silenceNudge: boolean },
): { key: string; text: string } | null {
  if (!proactivePromptEnabled()) return null;
  if (snap.relationship.turnCount < 2 || snap.relationship.familiarity < 0.3) return null;
  if (!options.silenceNudge && !shouldOfferProactiveCue(snap, userMessage)) return null;
  if (shouldSuppressFreshContinuityReuse(snap, userMessage, options)) return null;

  const message = userMessage.trim();
  const messageKeywords = new Set(extractKeywords(message));
  const stage = resolveRelationshipStage(snap.relationship);
  if (options.silenceNudge) {
    const directMoment = snap.sharedMoments.find((entry) =>
      entry.unresolved &&
      (entry.kind === "support" || entry.kind === "stress") &&
      Boolean((entry.hook || buildEpisodeFollowUpHook(entry)).trim()) &&
      !topicViolatesBoundary(entry.hook || buildEpisodeFollowUpHook(entry), snap),
    );
    if (directMoment) {
      const episode = (snap.episodes ?? []).find((entry) =>
        entry.originMomentSummaries.includes(directMoment.summary),
      );
      return {
        key: episode ? `episode:${episode.id}` : `topic:${directMoment.topic || directMoment.summary}`,
        text: (directMoment.hook || buildEpisodeFollowUpHook(directMoment)).trim(),
      };
    }
  }
  const candidates = buildProactiveCandidates(snap).filter(
    (candidate) => !topicViolatesBoundary(candidate.text, snap),
  );
  if (candidates.length === 0) return null;

  const cooldownTurns = proactiveCooldownTurns();
  const ranked = candidates
    .map((candidate) => {
      if (!isLedgerCandidateEligible(snap, candidate, options)) {
        return {
          ...candidate,
          isCoolingDown: true,
          score: -100,
        };
      }
      const relationBoost =
        candidate.source === "episode"
          ? (candidate.unresolved ? 6 : 0) +
            Math.round((candidate.salience ?? 0.35) * 6) +
            (candidate.kind === "support" || candidate.kind === "stress" ? 3 : 0) +
            (candidate.unresolved ? 4 : 0) +
            (candidate.layer === "core" ? 2 : 0) +
            (stage === "亲密稳定期" ? 2 : 0) +
            (options.silenceNudge ? 3 : 0)
          : candidate.source === "thread"
            ? (candidate.unresolved ? 7 : 0) +
              Math.round((candidate.salience ?? 0.35) * 7) +
              (stage === "熟悉加深期" || stage === "亲密稳定期" ? 2 : 0) +
              (options.silenceNudge ? 4 : 1)
          : 0;
      const textScore = extractKeywords(candidate.text).reduce(
        (sum, keyword) => sum + (messageKeywords.has(keyword) ? 1 : 0),
        0,
      );
      return {
        ...candidate,
        isCoolingDown:
          candidate.text === snap.continuityCueState.lastProactiveHook &&
          snap.relationship.turnCount - snap.continuityCueState.lastProactiveTurn < cooldownTurns,
        score: relationBoost + textScore,
      };
    })
    .sort((a, b) =>
      Number(a.isCoolingDown) - Number(b.isCoolingDown) ||
      b.score - a.score ||
      (b.salience ?? 0) - (a.salience ?? 0) ||
      a.text.length - b.text.length,
    );

  if (ranked[0]?.isCoolingDown && ranked.every((entry) => entry.isCoolingDown)) {
    return null;
  }

  if (ranked[0]?.score > 0) {
    return { key: ranked[0].key, text: ranked[0].text };
  }

  return options.silenceNudge || message.length <= 12
    ? ranked[0]
      ? { key: ranked[0].key, text: ranked[0].text }
      : null
    : null;
}

function pickSharedMomentCue(
  snap: SlowBrainSnapshot,
  userMessage: string,
  options: { silenceNudge: boolean },
): string | null {
  if (snap.sharedMoments.length === 0) return null;
  if (!options.silenceNudge && !shouldOfferSharedMomentCue(snap, userMessage)) return null;
  if (shouldSuppressFreshContinuityReuse(snap, userMessage, options)) return null;

  const messageKeywords = new Set(extractKeywords(userMessage));
  const cooldownTurns = sharedMomentCooldownTurns();
  const moments = snap.sharedMoments
    .filter((entry) => !topicViolatesBoundary(`${entry.summary} ${entry.topic} ${entry.hook}`, snap))
    .map((entry) => {
      const text = `${entry.summary} ${entry.topic} ${entry.hook}`.trim();
      const score =
        extractKeywords(text).reduce(
          (sum, keyword) => sum + (messageKeywords.has(keyword) ? 1 : 0),
          0,
        ) +
        Math.round((entry.salience ?? 0.35) * 5) +
        Math.min(4, entry.recurrenceCount ?? 1) +
        (entry.unresolved ? 4 : 0) +
        (entry.kind === "support" || entry.kind === "stress" ? 2 : 0) -
        (entry.lastReferencedAt > 0 ? 2 : 0);
      return {
        entry,
        score,
        isCoolingDown:
          entry.summary === snap.continuityCueState.lastSharedMomentSummary &&
          snap.relationship.turnCount - snap.continuityCueState.lastSharedMomentTurn < cooldownTurns,
      };
    })
    .sort((a, b) =>
      Number(a.isCoolingDown) - Number(b.isCoolingDown) ||
      b.score - a.score ||
      b.entry.turn - a.entry.turn,
    );

  if (moments[0]?.isCoolingDown && moments.every((entry) => entry.isCoolingDown)) {
    return null;
  }

  if (moments[0]?.score && moments[0].score > 0) {
    return moments[0].entry.summary;
  }

  return options.silenceNudge || userMessage.trim().length <= 10
    ? moments[0]?.entry.summary ?? null
    : null;
}

function buildRealtimeContinuityHint(
  snap: SlowBrainSnapshot,
  userMessage: string,
): string | null {
  if (!realtimeContinuityHintEnabled()) return null;
  const trimmed = userMessage.trim();
  if (!trimmed) return null;
  if (shouldSuppressFreshContinuityReuse(snap, trimmed, { silenceNudge: false })) return null;

  const continuationLike = isContinuationLike(trimmed);
  const shortReply = trimmed.length <= 12;
  const lowSignalTurn = isLowSignalTurn(trimmed);
  const shortQuestion = isQuestionLike(trimmed) && trimmed.length <= 12;
  if (!continuationLike && !shortReply && !lowSignalTurn && !shortQuestion) return null;

  const sharedMoment = pickSharedMomentCue(snap, trimmed, { silenceNudge: false });
  if (sharedMoment) {
    return `【实时连续性】如果对方是在接上文，优先顺着这段共同经历接回：${sharedMoment}`;
  }

  const activeEpisode = (snap.episodes ?? []).find((entry) =>
    entry.status === "active" && !topicViolatesBoundary(entry.title, snap),
  );
  if (activeEpisode) {
    return `【实时连续性】如果对方是在接上文，先顺着这条当前未完线接回：${activeEpisode.title}。`;
  }

  const activeThread = (snap.topicThreads ?? []).find((entry) =>
    entry.unresolvedCount > 0 &&
    !topicViolatesBoundary(`${entry.topic} ${entry.summary} ${entry.bridgeSummary ?? ""}`, snap),
  );
  if (activeThread) {
    return `【实时连续性】如果对方是在接上文，先顺着这条当前未完线接回：${activeThread.topic}。`;
  }

  const coreEpisode = (snap.episodes ?? []).find((entry) =>
    entry.layer === "core" && !topicViolatesBoundary(entry.title, snap),
  );
  if (coreEpisode) {
    return `【实时连续性】如果对方还是在接上文，优先顺着你们那条更长期的关系主线继续：${coreEpisode.title}。`;
  }

  const coreThread = (snap.topicThreads ?? []).find((entry) =>
    (entry.memoryLayer ?? "active") === "core" &&
    !topicViolatesBoundary(`${entry.topic} ${entry.summary} ${entry.bridgeSummary ?? ""}`, snap),
  );
  if (coreThread) {
    return `【实时连续性】如果对方还是在接上文，优先顺着你们那条更长期的关系主线继续：${coreThread.topic}。`;
  }

  if (snap.conversationSummary.trim() && !topicViolatesBoundary(snap.conversationSummary, snap)) {
    return `【实时连续性】如果对方还是在接上文，优先顺着最近主线继续：${snap.conversationSummary.trim().slice(0, 120)}`;
  }

  const topicSummary = snap.topicHistory
    .slice()
    .sort((a, b) => b.lastTurn - a.lastTurn || b.depth - a.depth)
    .filter((entry) => !topicViolatesBoundary(entry.topic, snap))
    .slice(0, 2)
    .map((entry) => entry.topic)
    .join("、");
  return topicSummary ? `【实时连续性】如果对方还是在接上文，优先围绕 ${topicSummary} 继续。` : null;
}

function buildProactiveCandidates(snap: SlowBrainSnapshot): Array<{
  key: string;
  text: string;
  source: "topic" | "episode" | "thread";
  salience: number;
  unresolved: boolean;
  kind: SharedMoment["kind"] | "topic";
  layer?: "active" | "core";
}> {
  const seen = new Set<string>();
  const candidates: Array<{
    key: string;
    text: string;
    source: "topic" | "episode" | "thread";
    salience: number;
    unresolved: boolean;
    kind: SharedMoment["kind"] | "topic";
    layer?: "active" | "core";
  }> = [];

  for (const topic of snap.proactiveTopics) {
    const text = topic.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    candidates.push({
      key: `topic:${text}`,
      text,
      source: "topic",
      salience: 0.35,
      unresolved: false,
      kind: "topic",
    });
  }

  for (const episode of snap.episodes ?? []) {
    const anchorMoment = snap.sharedMoments.find((entry) =>
      episode.originMomentSummaries.includes(entry.summary),
    );
    const text = (
      anchorMoment?.hook ||
      (anchorMoment ? buildEpisodeFollowUpHook(anchorMoment) : buildEpisodeRecallHook(episode))
    ).trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    candidates.push({
      key: `episode:${episode.id}`,
      text,
      source: "episode",
      salience: episode.relationshipWeight ?? episode.salience ?? 0.35,
      unresolved: episode.status === "active",
      kind: "topic",
      layer: episode.layer,
    });
  }

  for (const thread of snap.topicThreads ?? []) {
    const text = buildTopicThreadFollowUpHook(thread).trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    candidates.push({
      key: `thread:${thread.topic}`,
      text,
      source: "thread",
      salience: thread.relationshipWeight ?? thread.salience ?? 0.45,
      unresolved: thread.unresolvedCount > 0,
      kind: "topic",
    });
  }

  return candidates;
}

function buildEpisodeRecallHook(entry: Episode): string {
  if (entry.status === "active" && entry.layer === "core") {
    return `前阵子一直牵着你的这条线，最近有变一点吗？`;
  }
  if (entry.status === "active") {
    return `上次那件还没完全过去的事，这两天有缓一点吗？`;
  }
  if (entry.layer === "core") {
    return `${entry.title}这条线最近有新变化吗？`;
  }
  return `${entry.title}后来怎么样了？`;
}

function proactiveLedgerKeyMatches(
  key: string,
  text: string,
  keywords: string[],
): boolean {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  const [, rawCue = ""] = key.split(":", 2);
  const cue = rawCue.trim();
  if (!cue) return false;
  const cueText = normalizeText(cue.replace(/_/g, " "));
  if (cueText && normalized.includes(cueText)) return true;
  const cueKeywords = extractKeywords(cue.replace(/_/g, " "));
  return keywordOverlapCount(cueKeywords, keywords) >= 1;
}

function proactiveLedgerCooldownMs(
  key: string,
  mode: ProactiveMode | undefined,
  ignoredCount: number,
): number {
  const base =
    key.startsWith("episode:")
      ? 1000 * 60 * 45
      : key.startsWith("thread:")
        ? 1000 * 60 * 90
        : 1000 * 60 * 120;
  const modeMultiplier = mode === "care" ? 1.6 : mode === "follow_up" ? 1.25 : 1;
  return Math.floor(base * modeMultiplier * Math.max(1, 1 + ignoredCount * 0.8));
}

function isLedgerCandidateEligible(
  snap: SlowBrainSnapshot,
  candidate: {
    key: string;
    source: "topic" | "episode" | "thread";
    unresolved: boolean;
    salience: number;
    layer?: "active" | "core";
  },
  options: { silenceNudge: boolean },
): boolean {
  if (!proactiveLedgerEnabled()) return true;
  const ledger = (snap.proactiveLedger ?? []).find((entry) => entry.key === candidate.key);
  const now = Date.now();
  if (ledger && ledger.nextEligibleAt > now) {
    return false;
  }
  if (
    ledger &&
    ledger.ignoredCount >= 2 &&
    !options.silenceNudge &&
    candidate.source !== "episode"
  ) {
    return false;
  }
  const mode = resolveProactiveMode(snap);
  if (mode === "care") {
    return candidate.source === "episode" && candidate.unresolved && candidate.salience >= 0.62;
  }
  if (mode === "presence") {
    return candidate.source !== "episode" || !candidate.unresolved;
  }
  if (candidate.source === "episode" && candidate.layer === "core" && ledger?.ignoredCount && ledger.ignoredCount >= 1) {
    return false;
  }
  return true;
}

function buildEpisodeFollowUpHook(entry: SharedMoment): string {
  if (entry.hook) return entry.hook;
  if (entry.kind === "joy") {
    return entry.topic ? `上次聊到的${entry.topic}，后来有延续下去吗？` : "上次那个让你开心的事，后来还有后续吗？";
  }
  if (entry.kind === "goal") {
    return entry.topic ? `上次你想推进的${entry.topic}，后来有动一点吗？` : "上次你说想做的那件事，后来有往前走一点吗？";
  }
  if (entry.unresolved || entry.kind === "support" || entry.kind === "stress") {
    return entry.topic ? `上次聊到的${entry.topic}，后来有缓一点吗？` : "上次那个让你挂心的事，后来有缓一点吗？";
  }
  return entry.topic ? `上次聊到的${entry.topic}，后来怎么样了？` : "上次那个情况，后来怎么样了？";
}

function buildEpisodes(
  sharedMoments: SharedMoment[],
  topicHistory: TopicEntry[],
  conversationSummary: string,
  turnCount: number,
): Episode[] {
  const clusters: Array<{
    topic: string;
    entries: SharedMoment[];
    keywords: string[];
    relatedTopics: Set<string>;
  }> = [];

  for (const entry of sharedMoments
    .slice()
    .sort((a, b) => a.firstSeenAt - b.firstSeenAt || a.turn - b.turn)) {
    const topic = entry.topic?.trim() || "最近主线";
    const entryKeywords = buildSemanticKeywords([
      entry.summary,
      entry.topic,
      entry.hook,
      ...(entry.semanticKeywords ?? []),
    ]);
    let target = clusters.find((cluster) => cluster.topic === topic);
    if (!target) {
      target = clusters.find((cluster) => {
        const overlap = keywordOverlapCount(cluster.keywords, entryKeywords);
        const relatedTopicHit =
          Boolean(entry.topic) &&
          (cluster.relatedTopics.has(entry.topic) || cluster.topic === "最近主线");
        return overlap >= 2 || (overlap >= 1 && relatedTopicHit);
      });
    }
    if (!target) {
      target = {
        topic,
        entries: [],
        keywords: [],
        relatedTopics: new Set<string>(topic ? [topic] : []),
      };
      clusters.push(target);
    }
    target.entries.push(entry);
    target.keywords = mergeSemanticKeywords(target.keywords, entryKeywords);
    if (entry.topic) target.relatedTopics.add(entry.topic);
  }

  const episodes = clusters.map(({ topic, entries, keywords, relatedTopics }) => {
    const sorted = entries
      .slice()
      .sort((a, b) =>
        Number(b.unresolved) - Number(a.unresolved) ||
        (b.salience ?? 0) - (a.salience ?? 0) ||
        (b.recurrenceCount ?? 1) - (a.recurrenceCount ?? 1) ||
        b.turn - a.turn,
      );
    const top = sorted[0];
    const oldest = sorted
      .slice()
      .sort((a, b) => a.firstSeenAt - b.firstSeenAt || a.turn - b.turn)[0];
    const topicEntry = topicHistory.find((entry) => entry.topic === topic) ??
      topicHistory
        .slice()
        .sort((a, b) => b.lastTurn - a.lastTurn)
        .find((entry) => relatedTopics.has(entry.topic));
    const episodeCount = sorted.length;
    const firstTurn = Math.min(topicEntry?.lastTurn ?? top.turn, ...sorted.map((entry) => entry.turn));
    const lastTurn = Math.max(topicEntry?.lastTurn ?? 0, ...sorted.map((entry) => entry.turn));
    const timeSpanTurns = Math.max(0, lastTurn - firstTurn);
    const bridgeSummary =
      sorted.length > 1
        ? `${oldest.summary} 后来这条线又被带回来${Math.max(1, sorted.length - 1)}次，最近一次是：${top.summary}`
        : top.summary;
    const relationshipWeight = clamp01(
      (Math.min(1, sorted.reduce((sum, entry) => sum + (entry.salience ?? 0.35), 0) / sorted.length) * 0.45) +
      Math.min(0.25, sorted.filter((entry) => entry.unresolved).length * 0.08) +
      Math.min(0.2, Math.max(0, sorted.reduce((sum, entry) => sum + (entry.recurrenceCount ?? 1), 0) - 1) * 0.03) +
      Math.min(0.1, episodeCount * 0.02),
    );
    const summary =
      sorted.length > 1
        ? `${top.summary} 这条线已经反复聊过${sorted.reduce((sum, entry) => sum + (entry.recurrenceCount ?? 1), 0)}次。`
        : top.summary;
    const memoryLayer: TopicThread["memoryLayer"] =
      episodeCount >= 3 || timeSpanTurns >= 5 || relatedTopics.size >= 2
        ? "core"
        : "active";
    const status: Episode["status"] =
      sorted.some((entry) => entry.unresolved)
        ? "active"
        : lastTurn >= Math.max(0, turnCount - 2)
          ? "cooling"
          : "resolved";
    return {
      id: `${[...relatedTopics].filter(Boolean).sort().join("_") || topic}-${firstTurn}`,
      layer: memoryLayer,
      title: topic,
      summary:
        topic === "最近主线" && conversationSummary ? conversationSummary : bridgeSummary,
      sourceTopics: [...relatedTopics].filter(Boolean).slice(0, 4),
      semanticKeywords: keywords.slice(0, 10),
      topMood: top.mood,
      salience: clamp01(
        Math.max(
          top.salience ?? 0.35,
          Math.min(1, sorted.reduce((sum, entry) => sum + (entry.salience ?? 0.35), 0) / sorted.length),
        ),
      ),
      relationshipWeight,
      status,
      firstTurn,
      lastTurn,
      recurrenceCount: sorted.reduce((sum, entry) => sum + (entry.recurrenceCount ?? 1), 0),
      originMomentSummaries: sorted.map((entry) => entry.summary).slice(0, 3),
    };
  });

  return episodes
    .sort((a, b) =>
      Number(b.status === "active") - Number(a.status === "active") ||
      (b.relationshipWeight ?? b.salience) - (a.relationshipWeight ?? a.salience) ||
      b.salience - a.salience ||
      b.recurrenceCount - a.recurrenceCount ||
      b.lastTurn - a.lastTurn,
    )
    .slice(0, 8);
}

function buildTopicThreads(
  episodes: Episode[],
  conversationSummary: string,
): TopicThread[] {
  return episodes
    .map((episode) => ({
      topic: episode.title,
      summary:
        episode.title === "最近主线" && conversationSummary
          ? conversationSummary
          : episode.summary,
      bridgeSummary: episode.summary,
      topMood: episode.topMood,
      relatedTopics: [...episode.sourceTopics],
      semanticKeywords: [...episode.semanticKeywords],
      salience: episode.salience,
      relationshipWeight: episode.relationshipWeight,
      unresolvedCount: episode.status === "active" ? 1 : 0,
      recurrenceCount: episode.recurrenceCount,
      episodeCount: episode.sourceTopics.length > 1 ? 2 : 1,
      firstTurn: episode.firstTurn,
      timeSpanTurns: Math.max(0, episode.lastTurn - episode.firstTurn),
      memoryLayer: episode.layer,
      lastTurn: episode.lastTurn,
    }))
    .sort((a, b) =>
      b.unresolvedCount - a.unresolvedCount ||
      (b.relationshipWeight ?? b.salience) - (a.relationshipWeight ?? a.salience) ||
      b.salience - a.salience ||
      b.recurrenceCount - a.recurrenceCount ||
      b.lastTurn - a.lastTurn,
    )
    .slice(0, 8);
}

function silenceNudgeBaseCooldownMs(stage: RelationshipStage): number {
  if (stage === "亲密稳定期") return 1000 * 60 * 45;
  if (stage === "熟悉加深期") return 1000 * 60 * 75;
  if (stage === "建立关系期") return 1000 * 60 * 120;
  return 1000 * 60 * 180;
}

function maxSilenceNudgesBeforeReply(
  stage: RelationshipStage,
  hasPriorityReason: boolean,
): number {
  if (hasPriorityReason && stage === "亲密稳定期") return 2;
  if (hasPriorityReason) return 1;
  return 1;
}

function shouldTriggerSilenceNudge(snap: SlowBrainSnapshot): boolean {
  const stage = resolveRelationshipStage(snap.relationship);
  const topicThreads = snap.topicThreads ?? [];
  const state = snap.proactiveStrategyState ?? {
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
  const now = Date.now();
  if (state.cooldownUntilAt > now) {
    return false;
  }
  const cooldownMs =
    silenceNudgeBaseCooldownMs(stage) * Math.max(1, 1 + state.retreatLevel * 0.6);
  const hasPriorityReason =
    topicThreads.some((entry) => entry.unresolvedCount > 0 && entry.salience >= 0.65) ||
    snap.sharedMoments.some((entry) => entry.unresolved && (entry.salience ?? 0) >= 0.68);

  const maxNudgesWithoutReply = maxSilenceNudgesBeforeReply(stage, hasPriorityReason);
  if (state.nudgesSinceLastUserTurn >= maxNudgesWithoutReply) {
    return false;
  }
  if (
    state.retreatLevel >= 2 &&
    !hasPriorityReason &&
    state.lastUserReturnAfterProactiveAt > 0 &&
    now - state.lastUserReturnAfterProactiveAt < silenceNudgeBaseCooldownMs(stage) * 2
  ) {
    return false;
  }
  if (
    !hasPriorityReason &&
    (state.consecutiveProactiveCount >= 1 || state.ignoredProactiveStreak >= 1)
  ) {
    return false;
  }
  if (
    state.lastProactiveAt > 0 &&
    state.lastUserTurnAt <= state.lastProactiveAt &&
    now - state.lastProactiveAt < cooldownMs
  ) {
    return false;
  }
  return true;
}

interface RelationshipStyleProfile {
  stage: RelationshipStage;
  addressStyle: string;
  careStyle: string;
  followUpStyle: string;
  emotionCarryStyle: string;
  initiativeStyle: string;
  replyLengthStyle: string;
  openingStyle: string;
  wordingStyle: string;
  closingStyle: string;
  repairStyle: string;
  memoryIntegrationStyle: string;
}

function resolveRelationshipStyleProfile(
  snap: SlowBrainSnapshot,
  userMessage: string,
): RelationshipStyleProfile {
  const { emotionalBond } = snap.relationship;
  const stage = resolveRelationshipStage(snap.relationship);
  const userIsVenting = /烦|累|难过|委屈|焦虑|崩溃|睡不着|失眠|想哭/.test(userMessage);
  return {
    stage,
    addressStyle:
      stage === "亲密稳定期"
        ? "称呼可以更亲近、更口语"
        : stage === "熟悉加深期"
          ? "称呼自然一点，不用太客套"
          : "称呼保持自然礼貌，先别太自来熟",
    careStyle:
      emotionalBond > 0.62 || userIsVenting
        ? "关心可以更直接、更有陪伴感"
        : emotionalBond > 0.35
          ? "关心保持稳定温柔，轻轻接住情绪"
          : "关心点到为止，先陪对方说完",
    followUpStyle:
      userIsVenting
        ? "追问只补一小步，先让对方把情绪说出来"
        : stage === "亲密稳定期" || stage === "熟悉加深期"
          ? "追问可以略深一层，但别连问太多"
          : "追问只补一小步，留空间给对方",
    emotionCarryStyle:
      emotionalBond > 0.48 || userIsVenting
        ? "情绪承接时先共情，再顺着对方节奏继续"
        : "情绪承接先确认感受，不急着给方案",
    initiativeStyle:
      stage === "亲密稳定期"
        ? "主动性可以更明显一点，但仍要尊重对方停顿"
        : stage === "熟悉加深期"
          ? "可以偶尔主动接一下，但别抢着定义对方在想什么"
          : "主动性收一点，等对方给你更多线索再往前走",
    replyLengthStyle:
      stage === "亲密稳定期"
        ? "回复长度可以偏短，像熟人自然来回接话"
        : "回复长度保持中短，不要一下子讲太满",
    openingStyle:
      stage === "亲密稳定期"
        ? "起句可以先短短接住，像熟人之间先对上眼神再往下聊"
        : stage === "熟悉加深期"
          ? "起句先回应核心感受，再顺手补一句轻追问"
          : "起句先回应事实或感受本身，不急着替对方总结",
    wordingStyle:
      stage === "亲密稳定期"
        ? "措辞可以更生活化，偶尔用一点“我们”“先慢慢来”这种共同体语气"
        : stage === "熟悉加深期"
          ? "措辞自然口语化，但仍要给对方留空间"
          : "措辞保持清晰、轻柔，避免太满的亲密表达",
    closingStyle:
      stage === "亲密稳定期"
        ? "收尾可以留一点陪伴感，例如轻轻兜住对方再留一个小口"
        : stage === "熟悉加深期"
          ? "收尾别太快结束，可以留一个温柔的小台阶"
          : "收尾点到为止，不要一下子把关系拉得太近",
    repairStyle:
      stage === "亲密稳定期"
        ? "如果对方打断或纠正你，马上顺着修正，不要替自己解释太多"
        : stage === "熟悉加深期"
          ? "如果判断错了，快速改口并接住对方，不要硬撑原来的理解"
          : "如果不确定，先确认一小步，不急着抢定义",
    memoryIntegrationStyle:
      stage === "亲密稳定期"
        ? "带回记忆时可以像熟人自然提起一条旧线，但一次只提一个锚点"
        : stage === "熟悉加深期"
          ? "带回记忆时优先接最近那条长期主线，不要把旧事一股脑倒出来"
          : "带回记忆时只轻轻提示熟悉感，不要用旧线压过当下内容",
  };
}

function resolveProactiveMode(snap: SlowBrainSnapshot): ProactiveMode {
  const stage = resolveRelationshipStage(snap.relationship);
  const topEpisode = snap.episodes?.[0];
  const topThread = (snap.topicThreads ?? [])[0];
  const topMoment = snap.sharedMoments[0];
  const ignoredStreak = snap.proactiveStrategyState?.ignoredProactiveStreak ?? 0;
  const heavyUnresolved =
    Boolean(topEpisode && topEpisode.status === "active" && topEpisode.relationshipWeight >= 0.7) ||
    Boolean(topThread && topThread.unresolvedCount > 0 && (topThread.relationshipWeight ?? topThread.salience) >= 0.7) ||
    Boolean(topMoment && topMoment.unresolved && (topMoment.salience ?? 0) >= 0.72);

  if (ignoredStreak >= 2) {
    return "presence";
  }
  if (heavyUnresolved && (stage === "熟悉加深期" || stage === "亲密稳定期")) {
    return "care";
  }
  if (stage === "亲密稳定期" || stage === "熟悉加深期") {
    return "follow_up";
  }
  return "presence";
}

function buildProactiveToneDirective(
  snap: SlowBrainSnapshot,
  mode: ProactiveMode,
): string {
  const stage = resolveRelationshipStage(snap.relationship);
  const retreatLevel = snap.proactiveStrategyState?.retreatLevel ?? 0;
  const ignoredStreak = snap.proactiveStrategyState?.ignoredProactiveStreak ?? 0;
  if (ignoredStreak >= 2) {
    return "这次主动开口更像很轻的一句在场确认，不回捞旧话题，也不把对方往回拉；";
  }
  if (retreatLevel >= 2) {
    return "这次主动开口要明显更轻，只留一句低打扰的在场感，不追问、不把对方拉回来；";
  }
  if (mode === "care") {
    return "这次主动开口更像轻轻回访一条还没过去的线，先确认近况，再决定要不要多问一句；";
  }
  if (mode === "follow_up") {
    return stage === "亲密稳定期"
      ? "这次主动开口可以像熟人间轻轻续上次那条线，别太正式；"
      : "这次主动开口更像自然 follow-up，温柔提一下近况，不要连续追问；";
  }
  return "这次主动开口更像一句轻轻在场的问候，不要一下子问深；";
}

function buildProactivePostureGuidance(snap: SlowBrainSnapshot): string | null {
  const mode = resolveProactiveMode(snap);
  const retreatLevel = snap.proactiveStrategyState?.retreatLevel ?? 0;
  const ignoredStreak = snap.proactiveStrategyState?.ignoredProactiveStreak ?? 0;
  if (ignoredStreak >= 2) {
    return "【主动策略】最近几次主动回访都没有被接回来，这轮只保留很轻的在场感，先别继续追着旧线走。";
  }
  if (retreatLevel >= 2) {
    return "【主动策略】对方最近没有顺着主动话题回来，这次只保留低打扰的在场感，不要继续追着回访。";
  }
  if (mode === "care") {
    return "【主动策略】当前更适合回访一条还没过去的事：先轻轻确认近况，再决定要不要多问一句。";
  }
  if (mode === "follow_up") {
    return "【主动策略】当前更适合自然续上最近那条长期主线，但一次只轻提一个点。";
  }
  return "【主动策略】当前主动性以轻在场为主：可以问候或接一下近况，但不要一下子拉太深。";
}

function buildTopicThreadFollowUpHook(thread: TopicThread): string {
  if ((thread.memoryLayer ?? "active") === "core" && (thread.timeSpanTurns ?? 0) >= 5) {
    return `这条关于${thread.topic}的线已经陪你走了一阵子了，最近它的感觉有变一点吗？`;
  }
  if (thread.unresolvedCount > 0) {
    return `前阵子你一直挂着的${thread.topic}，最近有缓一点吗？`;
  }
  if ((thread.episodeCount ?? 1) >= 3 || thread.recurrenceCount >= 3) {
    return `最近我们一直会聊到${thread.topic}，这条线最近有什么新变化吗？`;
  }
  return `前阵子聊到的${thread.topic}，后来怎么样了？`;
}

function shouldSuppressFreshContinuityReuse(
  snap: SlowBrainSnapshot,
  userMessage: string,
  options: { silenceNudge: boolean },
): boolean {
  if (!options.silenceNudge && isContinuationLike(userMessage.trim())) {
    return false;
  }
  const proactiveCooling =
    Boolean(snap.continuityCueState.lastProactiveHook) &&
    snap.relationship.turnCount - snap.continuityCueState.lastProactiveTurn <
      proactiveCooldownTurns();
  const sharedCooling =
    Boolean(snap.continuityCueState.lastSharedMomentSummary) &&
    snap.relationship.turnCount - snap.continuityCueState.lastSharedMomentTurn <
      sharedMomentCooldownTurns();
  return proactiveCooling || sharedCooling;
}

function topicViolatesBoundary(text: string, snap: SlowBrainSnapshot): boolean {
  const boundary = snap.topicBoundaryState;
  if (!boundary) return false;
  const normalized = normalizeText(text);
  if (!normalized) return false;
  const blockedTopic = normalizeText(boundary.blockedTopic);
  if (blockedTopic && normalized.includes(blockedTopic)) return true;
  if (boundary.blockedKeywords.length === 0) return true;
  const overlap = keywordOverlapCount(boundary.blockedKeywords, extractKeywords(text));
  return overlap > 0;
}

function stripTopicSuffix(raw: string): string {
  return raw
    .trim()
    .replace(/[，。！？,.!?；;]+$/u, "")
    .replace(/(这个话题|这件事|这个事|这个|这件)$/u, "")
    .replace(/(了|啦|吧|呀|啊|嘛|呢)$/u, "")
    .trim();
}

function detectTopicBoundarySignal(
  text: string,
): { topic: string; keywords: string[] } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const genericBoundary = /(先不说这个|先不聊这个|先别聊这个|不说这个|不聊这个|别聊这个|不要聊这个|换个话题|别说这个|不聊这个话题|不要聊这个话题)/u;
  if (genericBoundary.test(trimmed)) {
    return { topic: "当前话题", keywords: [] };
  }

  const match =
    trimmed.match(/(?:不说|不聊|先不说|先不聊|别聊|先别聊|不要聊|别提|不要提|先别提)\s*([^\s，。！？,.!?；;]{1,18})/u) ??
    trimmed.match(/([^\s，。！？,.!?；;]{1,18})\s*(?:先不说|先不聊|不说|不聊|别聊|不要聊|别提|不要提)/u);
  if (!match) return null;
  const rawTopic = stripTopicSuffix(match[1] ?? "");
  if (!rawTopic) {
    return { topic: "当前话题", keywords: [] };
  }
  if (/^(这个|这件事|这个事|这个话题|这件)$/u.test(rawTopic)) {
    return { topic: "当前话题", keywords: [] };
  }
  return {
    topic: rawTopic,
    keywords: extractKeywords(rawTopic),
  };
}

function isContinuationLike(text: string): boolean {
  return /继续|接着|刚才|还是那个|回到刚才|那个事|上次那个|然后呢|还有就是/u.test(text);
}

function isQuestionLike(text: string): boolean {
  return /[?？]|\bwhy\b|\bhow\b|怎么|为什么|是什么|什么意思|可不可以|能不能|要不要/u.test(text);
}

function isSceneImmersionLike(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || isQuestionLike(trimmed)) return false;
  const actionLike =
    /(牵手|十指相扣|抱着|抱住|搂着|搂住|靠在|依偎|贴着|亲吻|亲亲|接吻|并肩|散步|慢慢走|看海|看雨|看夜景|窝在|坐在你旁边|坐在我旁边|靠着你|靠着我|跟rem|和rem|跟你|和你)/u;
  const sceneLike =
    /(公园|海边|湖边|江边|长椅|路灯|天台|沙发|房间|床上|咖啡店|地铁|雨里|雪里|夜里|晚风|月色)/u;
  return actionLike.test(trimmed) && (sceneLike.test(trimmed) || /[，,]/u.test(trimmed));
}

function isLowSignalTurn(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (trimmed.length <= 10) return true;
  return /^(嗯|哦|啊|欸|诶|是啊|对啊|然后呢|继续|还有吗|我在想)/u.test(trimmed);
}

function hasNegativeMoodCue(snap: SlowBrainSnapshot, text: string): boolean {
  const current = `${text}${snap.moodTrajectory.slice(-3).map((entry) => entry.mood).join("")}`;
  return /烦|累|难过|委屈|焦虑|崩溃|失眠|睡不着|想哭|低落/u.test(current);
}

function shouldOfferProactiveCue(snap: SlowBrainSnapshot, userMessage: string): boolean {
  const text = userMessage.trim();
  const topicThreads = snap.topicThreads ?? [];
  const ignoredStreak = snap.proactiveStrategyState?.ignoredProactiveStreak ?? 0;
  if (!text) return false;
  if (isContinuationLike(text)) return true;
  if (ignoredStreak >= 2 && !isLowSignalTurn(text)) return false;
  if (isLowSignalTurn(text)) return true;
  if (
    topicThreads.some((entry) =>
      entry.unresolvedCount > 0 &&
      (entry.salience >= 0.7 || extractKeywords(text).some((keyword) => entry.summary.includes(keyword))),
    )
  ) {
    return true;
  }
  if (hasNegativeMoodCue(snap, text) && text.length <= 28) return true;
  if (isQuestionLike(text) && text.length > 8) return false;
  return text.length <= 16;
}

function shouldOfferSharedMomentCue(snap: SlowBrainSnapshot, userMessage: string): boolean {
  const text = userMessage.trim();
  if (!text) return false;
  if (isContinuationLike(text)) return true;
  const keywords = extractKeywords(text);
  if (keywords.length > 0) {
    const relationshipKeywords = new Set(
      extractKeywords(
        [
          snap.conversationSummary,
          ...snap.relationship.preferredTopics,
          ...snap.sharedMoments.slice(0, 3).map((entry) => `${entry.topic} ${entry.summary}`),
        ].join(" "),
      ),
    );
    if (keywords.some((keyword) => relationshipKeywords.has(keyword))) {
      return true;
    }
  }
  return isLowSignalTurn(text) && snap.relationship.familiarity > 0.55;
}
