import { embed } from "../llm/embedding_client";
import {
  insertEpisode,
  updateEpisode,
  findSimilarEpisodes,
  getUnresolvedEpisodes,
  DbEpisode,
} from "../storage/repositories/episode_repository";

const MERGE_THRESHOLD = 0.85;
const MAX_ORIGIN_SUMMARIES = 8;
const RELEVANCE_TOP_K = 5;
const RECENT_REFERENCE_WINDOW_MS = 6 * 60 * 60 * 1000;

export type EpisodeLifecycleStatus = "active" | "cooling" | "resolved";

export interface MomentInput {
  userId: string;
  summary: string;
  topic: string;
  mood: string;
  kind: string;
  salience: number;
  unresolved: boolean;
  statusHint?: EpisodeLifecycleStatus;
}

export interface RankedEpisode {
  episode: DbEpisode;
  score: number;
}

function buildEmbeddingText(moment: Pick<MomentInput, "summary" | "topic" | "mood">): string {
  return [moment.summary, moment.topic, moment.mood]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}

function buildEpisodeSummary(moment: Pick<MomentInput, "summary" | "topic">): string {
  return moment.topic ? `${moment.topic}：${moment.summary}` : moment.summary;
}

function inferRelationshipWeight(moment: Pick<MomentInput, "salience">): number {
  return moment.salience;
}

function episodeLifecycleEnabled(): boolean {
  const raw = (process.env.REMI_EPISODE_LIFECYCLE_ENABLED ?? "0").trim().toLowerCase();
  return raw === "1" || raw === "true";
}

function normalizeLifecycleStatus(status: string | null | undefined): EpisodeLifecycleStatus {
  if (status === "active" || status === "cooling" || status === "resolved") {
    return status;
  }
  return "cooling";
}

function resolveLifecycleStatus(
  existing: DbEpisode | null,
  moment: MomentInput,
): EpisodeLifecycleStatus {
  if (!episodeLifecycleEnabled()) {
    return moment.unresolved ? "active" : normalizeLifecycleStatus(existing?.status);
  }

  const hint = moment.statusHint;
  if (hint === "resolved") return "resolved";
  if (hint === "active" || moment.unresolved) return "active";

  const existingStatus = normalizeLifecycleStatus(existing?.status);
  if (!existing) return "cooling";
  if (existingStatus === "active") return "cooling";
  if (existingStatus === "resolved") return "cooling";
  return "cooling";
}

function clampOriginMomentSummaries(originMomentSummaries: string[]): string[] {
  if (originMomentSummaries.length <= MAX_ORIGIN_SUMMARIES) {
    return originMomentSummaries;
  }
  return originMomentSummaries.slice(originMomentSummaries.length - MAX_ORIGIN_SUMMARIES);
}

function computeUpdatedCentroid(
  existingEmbedding: number[],
  existingCount: number,
  momentEmbedding: number[],
): number[] {
  const oldCount = Math.max(1, existingCount);
  const nextCount = oldCount + 1;
  const dimensions = Math.max(existingEmbedding.length, momentEmbedding.length);
  const centroid: number[] = [];

  for (let index = 0; index < dimensions; index += 1) {
    const oldValue = existingEmbedding[index] ?? 0;
    const newValue = momentEmbedding[index] ?? 0;
    centroid.push(((oldValue * oldCount) + newValue) / nextCount);
  }

  return centroid;
}

export async function ingest(moment: MomentInput): Promise<DbEpisode> {
  const momentEmbedding = await embed(buildEmbeddingText(moment));
  const similarEpisodes = await findSimilarEpisodes(moment.userId, momentEmbedding, 3);
  const topEpisode = similarEpisodes[0];

  if (!topEpisode) {
    return createNewEpisode(moment, momentEmbedding);
  }

  const similarity = cosineSimilarity(momentEmbedding, topEpisode.centroid_embedding);
  if (similarity >= MERGE_THRESHOLD) {
    return mergeIntoEpisode(topEpisode, moment, momentEmbedding);
  }

  return createNewEpisode(moment, momentEmbedding);
}

async function mergeIntoEpisode(
  existing: DbEpisode,
  moment: MomentInput,
  momentEmbedding: number[],
): Promise<DbEpisode> {
  const originMomentSummaries = clampOriginMomentSummaries([
    ...(existing.origin_moment_summaries ?? []),
    moment.summary,
  ]);
  const centroidEmbedding = computeUpdatedCentroid(
    existing.centroid_embedding ?? [],
    existing.recurrence_count,
    momentEmbedding,
  );
  const mergedTopics = Array.from(
    new Set([
      ...(existing.topics ?? []),
      moment.topic,
    ].filter(Boolean)),
  );
  const status = resolveLifecycleStatus(existing, moment);
  const updated = await updateEpisode(existing.id, {
    summary: buildEpisodeSummary(moment),
    topics: mergedTopics,
    mood: moment.mood,
    salience: Math.max(existing.salience, moment.salience),
    recurrenceCount: existing.recurrence_count + 1,
    unresolved: status === "active",
    status,
    lastSeenAt: new Date(),
    centroidEmbedding,
    originMomentSummaries,
    relationshipWeight: Math.max(existing.relationship_weight, inferRelationshipWeight(moment)),
  });

  if (!updated) {
    throw new Error(`Episode not found during merge: ${existing.id}`);
  }

  return updated;
}

async function createNewEpisode(
  moment: MomentInput,
  momentEmbedding: number[],
): Promise<DbEpisode> {
  const summary = buildEpisodeSummary(moment);
  const titleSource = moment.topic || moment.summary;
  const status = resolveLifecycleStatus(null, moment);
  return insertEpisode({
    userId: moment.userId,
    title: titleSource.slice(0, 30),
    summary,
    topics: moment.topic ? [moment.topic] : [],
    mood: moment.mood,
    kind: moment.kind,
    salience: moment.salience,
    unresolved: status === "active",
    status,
    centroidEmbedding: momentEmbedding,
    originMomentSummaries: [moment.summary],
    relationshipWeight: inferRelationshipWeight(moment),
  });
}

export async function findRelevant(
  userId: string,
  userMessage: string,
  topK?: number,
): Promise<RankedEpisode[]> {
  const messageEmbedding = await embed(userMessage);
  const episodes = await findSimilarEpisodes(userId, messageEmbedding, topK ?? RELEVANCE_TOP_K);
  const now = Date.now();

  return episodes
    .map((episode) => {
      const cosine = cosineSimilarity(messageEmbedding, episode.centroid_embedding);
      const lastSeenAtMs = episode.last_seen_at instanceof Date
        ? episode.last_seen_at.getTime()
        : new Date(episode.last_seen_at).getTime();
      const daysSinceLastSeen = Math.max(0, (now - lastSeenAtMs) / 86400000);
      const recencyScore = 1 / (1 + daysSinceLastSeen);
      const unresolvedBoost = episode.unresolved ? 1 : 0;
      const lastReferencedAtMs = episode.last_referenced_at instanceof Date
        ? episode.last_referenced_at.getTime()
        : episode.last_referenced_at
          ? new Date(episode.last_referenced_at).getTime()
          : 0;
      const recentReferencePenalty =
        lastReferencedAtMs > 0 && now - lastReferencedAtMs < RECENT_REFERENCE_WINDOW_MS
          ? 0.18
          : 0;
      const score =
        (0.6 * cosine) +
        (0.2 * episode.salience) +
        (0.1 * recencyScore) +
        (0.1 * unresolvedBoost) -
        recentReferencePenalty;
      return {
        episode,
        score,
      };
    })
    .sort((a, b) => b.score - a.score);
}

export async function listUnresolved(userId: string): Promise<DbEpisode[]> {
  return getUnresolvedEpisodes(userId);
}

export async function markReferenced(episodeId: string): Promise<void> {
  await updateEpisode(episodeId, { lastReferencedAt: new Date() });
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) {
    return 0;
  }

  const dimensions = Math.max(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let index = 0; index < dimensions; index += 1) {
    const valueA = a[index] ?? 0;
    const valueB = b[index] ?? 0;
    dot += valueA * valueB;
    normA += valueA * valueA;
    normB += valueB * valueB;
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
