import type { SlowBrainSnapshot } from "../brains/slow_brain_store";

const STOP_WORDS = new Set([
  "我们",
  "你们",
  "他们",
  "这个",
  "那个",
  "现在",
  "最近",
  "刚才",
  "还是",
  "已经",
  "真的",
  "有点",
  "一下",
  "因为",
  "所以",
  "可以",
  "今天",
  "昨天",
  "晚上",
]);

export type SnapshotThreadCandidate = {
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
};

export type SnapshotEpisodeCandidate = {
  id: string;
  title: string;
  summary: string;
  layer: "active" | "core";
  status: "active" | "cooling" | "resolved";
  sourceTopics: string[];
  semanticKeywords: string[];
  topMood: string;
  salience: number;
  relationshipWeight: number;
  recurrenceCount: number;
  lastTurn: number;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function parseBooleanFlag(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === "") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "1" || normalized === "true") return true;
  if (normalized === "0" || normalized === "false") return false;
  return fallback;
}

export function episodeLongHorizonRankingEnabled(): boolean {
  return parseBooleanFlag(process.env.REMI_EPISODE_LONG_HORIZON_RANKING_ENABLED, true);
}

export function episodeStorePromptEnabled(): boolean {
  return parseBooleanFlag(process.env.REMI_EPISODE_STORE_PROMPT_ENABLED, true);
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
  const raw = normalized.split(/\s+/);
  const seen = new Set<string>();
  const keywords: string[] = [];

  for (const token of raw) {
    const trimmed = token.trim();
    if (trimmed.length < 2 || STOP_WORDS.has(trimmed)) continue;
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      keywords.push(trimmed);
    }
    if (/^[\u4e00-\u9fff]{4,}$/.test(trimmed)) {
      for (let size = 2; size <= 3; size++) {
        for (let i = 0; i + size <= trimmed.length; i++) {
          const slice = trimmed.slice(i, i + size);
          if (STOP_WORDS.has(slice) || seen.has(slice)) continue;
          seen.add(slice);
          keywords.push(slice);
        }
      }
    }
  }

  return keywords;
}

export function getSnapshotThreadCandidates(
  slowBrainSnapshot: SlowBrainSnapshot | null | undefined,
): SnapshotThreadCandidate[] {
  if (!slowBrainSnapshot) return [];
  const threads = slowBrainSnapshot.topicThreads ?? [];
  if (threads.length > 0) return threads;

  const groups = new Map<string, NonNullable<SlowBrainSnapshot["sharedMoments"]>[number][]>();
  for (const moment of slowBrainSnapshot.sharedMoments ?? []) {
    const topic = moment.topic?.trim() || "最近主线";
    const list = groups.get(topic) ?? [];
    list.push(moment);
    groups.set(topic, list);
  }

  return [...groups.entries()]
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
      const topicEntry = slowBrainSnapshot.topicHistory.find((entry) => entry.topic === topic);
      const firstTurn = Math.min(...sorted.map((entry) => entry.turn), topicEntry?.lastTurn ?? Infinity);
      const lastTurn = Math.max(...sorted.map((entry) => entry.turn), topicEntry?.lastTurn ?? 0);
      const recurrenceCount = sorted.reduce((sum, entry) => sum + (entry.recurrenceCount ?? 1), 0);
      const unresolvedCount = sorted.filter((entry) => entry.unresolved).length;
      const averageSalience =
        sorted.reduce((sum, entry) => sum + (entry.salience ?? 0.35), 0) / Math.max(1, sorted.length);
      const salience = clamp01(Math.max(top.salience ?? 0.35, averageSalience));
      const relationshipWeight = clamp01(
        salience * 0.7 +
        Math.min(0.2, unresolvedCount * 0.08) +
        Math.min(0.1, Math.max(0, recurrenceCount - 1) * 0.03),
      );
      return {
        topic,
        summary:
          topic === "最近主线" && slowBrainSnapshot.conversationSummary
            ? slowBrainSnapshot.conversationSummary
            : top.summary,
        bridgeSummary:
          sorted.length > 1
            ? `${oldest.summary} 最近一次是：${top.summary}`
            : top.summary,
        topMood: top.mood,
        relatedTopics: relatedTopics.length > 0 ? relatedTopics : [topic],
        semanticKeywords: [
          ...new Set(
            sorted.flatMap((entry) =>
              [entry.topic, entry.summary, entry.hook, ...(entry.semanticKeywords ?? [])]
                .flatMap((text) => extractKeywords(text ?? ""))
            ),
          ),
        ].slice(0, 12),
        salience,
        relationshipWeight,
        unresolvedCount,
        recurrenceCount,
        episodeCount: sorted.length,
        firstTurn: Number.isFinite(firstTurn) ? firstTurn : top.turn,
        timeSpanTurns: Math.max(0, lastTurn - (Number.isFinite(firstTurn) ? firstTurn : top.turn)),
        memoryLayer:
          sorted.length >= 2 || recurrenceCount >= 3 || relatedTopics.length >= 2
            ? "core"
            : "active",
        lastTurn,
      } satisfies SnapshotThreadCandidate;
    })
    .sort((a, b) =>
      b.unresolvedCount - a.unresolvedCount ||
      (b.relationshipWeight ?? b.salience) - (a.relationshipWeight ?? a.salience) ||
      b.salience - a.salience ||
      b.recurrenceCount - a.recurrenceCount ||
      b.lastTurn - a.lastTurn,
    );
}

export function getSnapshotEpisodeCandidates(
  slowBrainSnapshot: SlowBrainSnapshot | null | undefined,
): SnapshotEpisodeCandidate[] {
  if (!slowBrainSnapshot) return [];
  const episodes = slowBrainSnapshot.episodes ?? [];
  if (episodes.length > 0) return episodes;

  return getSnapshotThreadCandidates(slowBrainSnapshot).map((thread) => ({
    id: `${thread.topic}-${thread.firstTurn ?? thread.lastTurn}`,
    title: thread.topic,
    summary: thread.bridgeSummary || thread.summary,
    layer:
      thread.memoryLayer === "core" ||
      (thread.episodeCount ?? 1) >= 3 ||
      thread.recurrenceCount >= 3 ||
      (thread.relationshipWeight ?? thread.salience) >= 0.82 ||
      ((thread.relatedTopics ?? []).length >= 2) ||
      (thread.timeSpanTurns ?? 0) >= 5
        ? "core"
        : "active",
    status:
      thread.unresolvedCount > 0
        ? "active"
        : thread.lastTurn >= Math.max(0, slowBrainSnapshot.relationship.turnCount - 2)
          ? "cooling"
          : "resolved",
    sourceTopics: [...(thread.relatedTopics ?? [thread.topic])],
    semanticKeywords: [...(thread.semanticKeywords ?? [])],
    topMood: thread.topMood,
    salience: thread.salience,
    relationshipWeight: thread.relationshipWeight ?? thread.salience,
    recurrenceCount: thread.recurrenceCount,
    lastTurn: thread.lastTurn,
  }));
}

export function getLongHorizonThreadCandidates(
  slowBrainSnapshot: SlowBrainSnapshot | null | undefined,
): SnapshotThreadCandidate[] {
  if (!slowBrainSnapshot) return [];
  const hasExplicitThreads = (slowBrainSnapshot.topicThreads?.length ?? 0) > 0;
  return getSnapshotThreadCandidates(slowBrainSnapshot).filter((entry) =>
    hasExplicitThreads
      ? (
          (entry.memoryLayer ?? "active") === "core" ||
          (entry.episodeCount ?? 1) >= 2 ||
          entry.recurrenceCount >= 3 ||
          (entry.timeSpanTurns ?? 0) >= 4 ||
          ((entry.relatedTopics ?? []).length >= 2)
        )
      : (entry.episodeCount ?? 1) >= 2,
  );
}

export function buildRelationshipTexts(slowBrainSnapshot?: SlowBrainSnapshot | null): {
  summaryText: string;
  combinedText: string;
  keywords: string[];
  recentMoodText: string;
  preferredTopics: string[];
} {
  if (!slowBrainSnapshot) {
    return {
      summaryText: "",
      combinedText: "",
      keywords: [],
      recentMoodText: "",
      preferredTopics: [],
    };
  }

  const threadCandidates = getLongHorizonThreadCandidates(slowBrainSnapshot);
  const episodeCandidates = getSnapshotEpisodeCandidates(slowBrainSnapshot);

  const recentMoodText = slowBrainSnapshot.moodTrajectory
    .slice(-4)
    .map((entry) => entry.mood)
    .join(" ");

  const parts = [
    slowBrainSnapshot.conversationSummary,
    ...slowBrainSnapshot.relationship.preferredTopics,
    ...slowBrainSnapshot.proactiveTopics,
    ...threadCandidates
      .slice(0, 4)
      .map((entry) =>
        `${entry.topic} ${entry.summary} ${entry.bridgeSummary ?? ""} ${(entry.relatedTopics ?? []).join(" ")} ${(entry.semanticKeywords ?? []).join(" ")} ${entry.topMood}`.trim()
      ),
    ...episodeCandidates
      .slice(0, 4)
      .map((entry) =>
        `${entry.title} ${entry.summary} ${entry.sourceTopics.join(" ")} ${entry.semanticKeywords.join(" ")} ${entry.topMood}`.trim()
      ),
    ...slowBrainSnapshot.sharedMoments
      .slice(0, 3)
      .map((entry) =>
        `${entry.topic} ${entry.summary} ${entry.hook} ${(entry.semanticKeywords ?? []).join(" ")}`.trim()
      ),
    ...slowBrainSnapshot.topicHistory
      .slice()
      .sort((a, b) => b.lastTurn - a.lastTurn || b.depth - a.depth)
      .slice(0, 4)
      .map((entry) => entry.topic),
    ...slowBrainSnapshot.moodTrajectory.slice(-4).map((entry) => entry.mood),
  ].filter(Boolean);

  const combinedText = parts.join(" ");
  return {
    summaryText: slowBrainSnapshot.conversationSummary,
    combinedText,
    keywords: extractKeywords(combinedText),
    recentMoodText,
    preferredTopics: [...slowBrainSnapshot.relationship.preferredTopics],
  };
}

export function keywordOverlapScore(
  haystack: string,
  keywords: string[],
  weight: number,
  maxScore: number,
): number {
  let score = 0;
  for (const keyword of keywords) {
    if (!keyword || keyword.length < 2) continue;
    if (haystack.includes(keyword)) {
      score += weight;
      if (score >= maxScore) return maxScore;
    }
  }
  return score;
}
