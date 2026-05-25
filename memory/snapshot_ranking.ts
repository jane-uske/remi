import type { SlowBrainSnapshot } from "../brains/background_analysis_store";
import { extractKeywords } from "./text_utils";
import { getConfig } from "../server/config";

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

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

export function episodeLongHorizonRankingEnabled(): boolean {
  return getConfig().REMI_EPISODE_LONG_HORIZON_RANKING_ENABLED;
}

export function episodeStorePromptEnabled(): boolean {
  return getConfig().REMI_EPISODE_STORE_PROMPT_ENABLED;
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
