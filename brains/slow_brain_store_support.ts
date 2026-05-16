import type {
  Episode,
  SharedMoment,
  SlowBrainSnapshot,
  TopicEntry,
  TopicThread,
} from "./background_analysis_store";

export function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function sentimentLabel(s: TopicEntry["sentiment"]): string {
  return s === "positive" ? "正面" : s === "negative" ? "负面" : "中性";
}

export function parseBooleanFlag(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === "") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "1" || normalized === "true") return true;
  if (normalized === "0" || normalized === "false") return false;
  return fallback;
}

export function relationshipStyleGuidanceEnabled(): boolean {
  return parseBooleanFlag(process.env.REMI_RELATIONSHIP_STYLE_GUIDANCE_ENABLED, true);
}

export function realtimeContinuityHintEnabled(): boolean {
  return parseBooleanFlag(process.env.REMI_REALTIME_CONTINUITY_HINT_ENABLED, true);
}

export function proactivePromptEnabled(): boolean {
  return parseBooleanFlag(process.env.REMI_PROACTIVE_PROMPT_ENABLED, true);
}

export function proactiveLedgerEnabled(): boolean {
  return parseBooleanFlag(process.env.REMI_PROACTIVE_LEDGER_ENABLED, true);
}

export function proactiveCooldownTurns(): number {
  const raw = Number(process.env.REMI_PROACTIVE_COOLDOWN_TURNS ?? 3);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 3;
}

export function sharedMomentCooldownTurns(): number {
  const raw = Number(process.env.REMI_SHARED_MOMENT_COOLDOWN_TURNS ?? 4);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 4;
}

export function topicBoundaryTtlTurns(): number {
  const raw = Number(process.env.REMI_TOPIC_BOUNDARY_TTL_TURNS ?? 4);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 4;
}

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\u4e00-\u9fff]+/gu, " ")
    .trim();
}

export function extractKeywords(text: string): string[] {
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

export function mergeSemanticKeywords(existing: string[], next: string[]): string[] {
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

export function extractAnchorKeywords(parts: string[]): string[] {
  const text = parts.join(" ");
  return RELATIONSHIP_ANCHOR_KEYWORDS.filter((keyword) => text.includes(keyword));
}

export function buildSemanticKeywords(parts: string[]): string[] {
  return mergeSemanticKeywords(
    extractAnchorKeywords(parts),
    parts.flatMap((part) => extractKeywords(part)),
  );
}

export function keywordOverlapCount(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const bSet = new Set(b);
  let overlap = 0;
  for (const token of a) {
    if (bSet.has(token)) overlap += 1;
  }
  return overlap;
}

export type RelationshipStage =
  | "初识观察期"
  | "建立关系期"
  | "熟悉加深期"
  | "亲密稳定期";

export function resolveRelationshipStage(
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

export type DerivedTopicSignal = {
  topic: string;
  summary: string;
  bridgeSummary?: string;
  unresolvedCount: number;
  salience: number;
  relationshipWeight?: number;
  recurrenceCount: number;
  isLongHorizon: boolean;
  relatedTopics: string[];
  semanticKeywords: string[];
  topMood: string;
  firstTurn: number;
  lastTurn: number;
};

export function deriveTopicSignalsFromSharedMoments(
  snap: SlowBrainSnapshot,
): DerivedTopicSignal[] {
  const groups = new Map<string, SharedMoment[]>();
  const allMoments = snap.sharedMoments ?? [];
  for (const moment of allMoments) {
    const topic = moment.topic?.trim() || "最近主线";
    const list = groups.get(topic) ?? [];
    list.push(moment);
    groups.set(topic, list);
  }

  const signals = [...groups.entries()]
    .map(([topic, moments]) => {
      const sorted = moments
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
        .sort((a, b) => a.turn - b.turn || a.createdAt - b.createdAt)[0];
      const relatedTopics = [...new Set(sorted.map((entry) => entry.topic).filter(Boolean))];
      const semanticKeywords = [
        ...new Set(
          sorted.flatMap((entry) =>
            [entry.topic, entry.summary, entry.hook, ...(entry.semanticKeywords ?? [])]
              .flatMap((text) => extractKeywords(text ?? ""))
          ),
        ),
      ].slice(0, 12);
      const firstTurn = Math.min(...sorted.map((entry) => entry.turn));
      const recurrenceCount = sorted.reduce((sum, entry) => sum + (entry.recurrenceCount ?? 1), 0);
      const unresolvedCount = sorted.filter((entry) => entry.unresolved).length;
      const salience = Math.max(...sorted.map((entry) => entry.salience ?? 0.35));
      const lastTurn = Math.max(...sorted.map((entry) => entry.turn));
      const relationshipWeight = clamp01(
        salience * 0.7 +
        Math.min(0.2, unresolvedCount * 0.08) +
        Math.min(0.1, Math.max(0, recurrenceCount - 1) * 0.03),
      );
      return {
        topic,
        summary:
          topic === "最近主线" && snap.conversationSummary.trim()
            ? snap.conversationSummary.trim()
            : top.summary,
        bridgeSummary:
          sorted.length > 1
            ? `${oldest.summary} 最近一次是：${top.summary}`
            : top.summary,
        unresolvedCount,
        salience,
        relationshipWeight,
        recurrenceCount,
        isLongHorizon:
          sorted.length >= 2 ||
          recurrenceCount >= 3 ||
          (topic === "最近主线" && Boolean(snap.conversationSummary.trim())),
        relatedTopics: relatedTopics.length > 0 ? relatedTopics : [topic],
        semanticKeywords,
        topMood: top.mood,
        firstTurn,
        lastTurn,
      } satisfies DerivedTopicSignal;
    });
  const distinctTopics = new Set(allMoments.map((entry) => entry.topic).filter(Boolean));
  if (allMoments.length >= 2) {
    const firstTurn = Math.min(...allMoments.map((entry) => entry.turn));
    const lastTurn = Math.max(...allMoments.map((entry) => entry.turn));
    const unresolvedCount = allMoments.filter((entry) => entry.unresolved).length;
    const salience = Math.max(...allMoments.map((entry) => entry.salience ?? 0.35));
    const recurrenceCount = allMoments.reduce((sum, entry) => sum + (entry.recurrenceCount ?? 1), 0);
    const summary =
      snap.conversationSummary.trim() ||
      allMoments
        .slice()
        .sort((a, b) =>
          Number(b.unresolved) - Number(a.unresolved) ||
          (b.salience ?? 0) - (a.salience ?? 0) ||
          b.turn - a.turn,
        )[0]
        ?.summary ||
      "";
    if (summary) {
      signals.push({
        topic: "最近主线",
        summary,
        bridgeSummary: summary,
        unresolvedCount,
        salience,
        relationshipWeight: clamp01(
          salience * 0.7 +
          Math.min(0.2, unresolvedCount * 0.08) +
          Math.min(0.1, Math.max(0, recurrenceCount - 1) * 0.03),
        ),
        recurrenceCount,
        isLongHorizon: lastTurn - firstTurn >= 5 || distinctTopics.size >= 2,
        relatedTopics: [...distinctTopics].slice(0, 4),
        semanticKeywords: [
          ...new Set(
            allMoments.flatMap((entry) =>
              [entry.topic, entry.summary, entry.hook, ...(entry.semanticKeywords ?? [])]
                .flatMap((text) => extractKeywords(text ?? ""))
            ),
          ),
        ].slice(0, 12),
        topMood:
          allMoments
            .slice()
            .sort((a, b) =>
              Number(b.unresolved) - Number(a.unresolved) ||
              (b.salience ?? 0) - (a.salience ?? 0) ||
              b.turn - a.turn,
            )[0]?.mood ?? "",
        firstTurn,
        lastTurn,
      });
    }
  }

  return signals.sort((a, b) =>
    Number(b.unresolvedCount > 0) - Number(a.unresolvedCount > 0) ||
    Number(b.isLongHorizon) - Number(a.isLongHorizon) ||
    b.salience - a.salience ||
    b.recurrenceCount - a.recurrenceCount ||
    b.lastTurn - a.lastTurn,
  );
}

export function getCurrentOpenTopicSignal(snap: SlowBrainSnapshot): DerivedTopicSignal | null {
  return (
    deriveTopicSignalsFromSharedMoments(snap).find((entry) => entry.unresolvedCount > 0) ??
    null
  );
}

export function getLongHorizonTopicSignal(snap: SlowBrainSnapshot): DerivedTopicSignal | null {
  return (
    deriveTopicSignalsFromSharedMoments(snap).find((entry) => entry.isLongHorizon) ??
    null
  );
}

export function buildCompatibilityEpisodesFromSignals(
  signals: DerivedTopicSignal[],
  turnCount: number,
): Episode[] {
  return signals
    .map((signal) => {
      const layer: Episode["layer"] = signal.isLongHorizon ? "core" : "active";
      const status: Episode["status"] =
        signal.unresolvedCount > 0
          ? "active"
          : signal.lastTurn >= Math.max(0, turnCount - 2)
            ? "cooling"
            : "resolved";
      return {
        id: `${signal.relatedTopics.filter(Boolean).sort().join("_") || signal.topic}-${signal.firstTurn}`,
        layer,
        title: signal.topic,
        summary: signal.bridgeSummary || signal.summary,
        sourceTopics: [...signal.relatedTopics].slice(0, 4),
        semanticKeywords: [...signal.semanticKeywords].slice(0, 10),
        topMood: signal.topMood,
        salience: signal.salience,
        relationshipWeight: signal.relationshipWeight ?? signal.salience,
        status,
        firstTurn: signal.firstTurn,
        lastTurn: signal.lastTurn,
        recurrenceCount: signal.recurrenceCount,
        originMomentSummaries: signal.bridgeSummary ? [signal.bridgeSummary] : [signal.summary],
      };
    })
    .sort((a, b) =>
      Number(b.status === "active") - Number(a.status === "active") ||
      (b.relationshipWeight ?? b.salience) - (a.relationshipWeight ?? a.salience) ||
      b.salience - a.salience ||
      b.recurrenceCount - a.recurrenceCount ||
      b.lastTurn - a.lastTurn,
    )
    .slice(0, 8);
}

export function buildCompatibilityTopicThreadsFromSignals(
  signals: DerivedTopicSignal[],
): TopicThread[] {
  return signals
    .map((signal) => {
      const memoryLayer: TopicThread["memoryLayer"] = signal.isLongHorizon ? "core" : "active";
      return {
        topic: signal.topic,
        summary: signal.summary,
        bridgeSummary: signal.bridgeSummary || signal.summary,
        topMood: signal.topMood,
        relatedTopics: [...signal.relatedTopics],
        semanticKeywords: [...signal.semanticKeywords],
        salience: signal.salience,
        relationshipWeight: signal.relationshipWeight ?? signal.salience,
        unresolvedCount: signal.unresolvedCount,
        recurrenceCount: signal.recurrenceCount,
        episodeCount: Math.max(1, signal.relatedTopics.length > 1 ? 2 : 1),
        firstTurn: signal.firstTurn,
        timeSpanTurns: Math.max(0, signal.lastTurn - signal.firstTurn),
        memoryLayer,
        lastTurn: signal.lastTurn,
      };
    })
    .sort((a, b) =>
      b.unresolvedCount - a.unresolvedCount ||
      (b.relationshipWeight ?? b.salience) - (a.relationshipWeight ?? a.salience) ||
      b.salience - a.salience ||
      b.recurrenceCount - a.recurrenceCount ||
      b.lastTurn - a.lastTurn,
    )
    .slice(0, 8);
}
