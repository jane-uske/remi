import { embed } from "../llm/embedding_client";
import { getConfig } from "../server/config";
import { extractKeywords, normalizeText } from "./prompt_memory_support";
import { toEpisodeV3StorageFields } from "./episode_v3";
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
const RECENT_REFERENCE_BASE_PENALTY = 0.18;
const RECENT_REFERENCE_STRONG_PENALTY = 0.32;
const WIDE_EPISODE_RELEVANCE_PENALTY = 0.12;
const MAX_MERGEABLE_TOPICS = 3;
const WIDE_EPISODE_RECURRENCE_FLOOR = 6;
const WIDE_EPISODE_SUMMARY_FLOOR = 3;
const LOW_COHESION_SCORE = 0.12;
const LOW_ANCHOR_COVERAGE = 0.45;

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

function buildEpisodeV3Source(
  base: {
    id: string;
    title: string;
    summary: string;
    topics: string[];
    mood: string;
    kind: string;
    salience: number;
    unresolved: boolean;
    status: string;
    recurrence_count: number;
    origin_moment_summaries: string[];
  },
): DbEpisode {
  return {
    id: base.id,
    user_id: "",
    title: base.title,
    summary: base.summary,
    topics: base.topics,
    mood: base.mood,
    kind: base.kind,
    salience: base.salience,
    recurrence_count: base.recurrence_count,
    unresolved: base.unresolved,
    first_seen_at: new Date(0),
    last_seen_at: new Date(0),
    last_referenced_at: null,
    centroid_embedding: [],
    origin_moment_summaries: base.origin_moment_summaries,
    relationship_weight: 0,
    status: base.status,
    v3_domain: null,
    v3_pressure_source: null,
    v3_relational_impact: null,
    v3_user_stance: null,
    v3_unresolved_level: null,
    v3_event_summary: null,
    v3_evidence_turns: [],
    v3_last_user_position: null,
  };
}

function episodeLifecycleEnabled(): boolean {
  return getConfig().REMI_EPISODE_LIFECYCLE_ENABLED;
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

function buildEpisodeAnchorText(
  episode: Pick<DbEpisode, "title" | "summary" | "topics" | "origin_moment_summaries">,
): string {
  return [
    episode.title,
    episode.summary,
    ...(episode.topics ?? []),
    ...((episode.origin_moment_summaries ?? []).slice(-3)),
  ]
    .map((value) => value.trim())
    .filter(Boolean)
    .join(" ");
}

function uniqueNormalizedTexts(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => normalizeText(value ?? ""))
        .filter(Boolean),
    ),
  );
}

function overlapScore(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let overlap = 0;
  for (const keyword of leftSet) {
    if (rightSet.has(keyword)) overlap += 1;
  }
  return overlap / Math.max(1, Math.min(leftSet.size, rightSet.size));
}

function pairwiseAverage(values: number[]): number {
  if (values.length === 0) return 1;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function introducesDiscreteTopic(existing: DbEpisode, moment: MomentInput): boolean {
  const nextTopic = normalizeText(moment.topic);
  if (!nextTopic) return false;
  const knownTopics = new Set(uniqueNormalizedTexts([existing.title, ...(existing.topics ?? [])]));
  return !knownTopics.has(nextTopic);
}

function isTooWideForCrossTopicMerge(existing: DbEpisode): boolean {
  const topicCount = uniqueNormalizedTexts([existing.title, ...(existing.topics ?? [])]).length;
  const summaryCount = existing.origin_moment_summaries?.length ?? 0;
  return (
    topicCount > MAX_MERGEABLE_TOPICS ||
    (topicCount >= 3 && (
      existing.recurrence_count >= WIDE_EPISODE_RECURRENCE_FLOOR ||
      summaryCount >= WIDE_EPISODE_SUMMARY_FLOOR
    ))
  );
}

function hasWeakAnchor(existing: DbEpisode): boolean {
  const summaries = existing.origin_moment_summaries ?? [];
  if (summaries.length < 3) return false;

  const summaryKeywords = summaries.map((summary) => extractKeywords(summary));
  const anchorKeywords = [
    ...extractKeywords(existing.title),
    ...(existing.topics ?? []).flatMap((topic) => extractKeywords(topic)),
  ];

  if (anchorKeywords.length === 0) return true;

  const pairScores: number[] = [];
  for (let index = 0; index < summaryKeywords.length; index += 1) {
    for (let cursor = index + 1; cursor < summaryKeywords.length; cursor += 1) {
      pairScores.push(overlapScore(summaryKeywords[index], summaryKeywords[cursor]));
    }
  }

  const cohesionScore = pairwiseAverage(pairScores);
  const anchorCoverage = pairwiseAverage(
    summaryKeywords.map((keywords) => overlapScore(keywords, anchorKeywords)),
  );
  return cohesionScore < LOW_COHESION_SCORE && anchorCoverage < LOW_ANCHOR_COVERAGE;
}

function matchesEpisodeAnchor(existing: DbEpisode, moment: MomentInput): boolean {
  const anchorKeywords = [
    ...extractKeywords(existing.title),
    ...(existing.topics ?? []).flatMap((topic) => extractKeywords(topic)),
  ];
  const momentKeywords = extractKeywords([moment.topic, moment.summary].filter(Boolean).join(" "));
  return overlapScore(momentKeywords, anchorKeywords) > 0;
}

function shouldMergeIntoExisting(existing: DbEpisode, moment: MomentInput): boolean {
  if (!introducesDiscreteTopic(existing, moment)) {
    return true;
  }

  if (isTooWideForCrossTopicMerge(existing) || hasWeakAnchor(existing)) {
    return false;
  }

  return matchesEpisodeAnchor(existing, moment);
}

function textIncludesAnchor(
  text: string,
  anchors: Array<string | null | undefined>,
): boolean {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  return uniqueNormalizedTexts(anchors).some((anchor) => normalized.includes(anchor));
}

function getRecallAnchorStrength(episode: DbEpisode, userMessage: string): {
  lexicalOverlap: number;
  topicAnchorHit: boolean;
} {
  const anchorKeywords = extractKeywords(buildEpisodeAnchorText(episode));
  const messageKeywords = extractKeywords(userMessage);
  return {
    lexicalOverlap: overlapScore(anchorKeywords, messageKeywords),
    topicAnchorHit: textIncludesAnchor(userMessage, [episode.title, ...(episode.topics ?? [])]),
  };
}

export async function ingest(moment: MomentInput): Promise<DbEpisode> {
  const momentEmbedding = await embed(buildEmbeddingText(moment));
  const similarEpisodes = await findSimilarEpisodes(moment.userId, momentEmbedding, 3);
  const topEpisode = similarEpisodes[0];

  if (!topEpisode) {
    return createNewEpisode(moment, momentEmbedding);
  }

  const similarity = cosineSimilarity(momentEmbedding, topEpisode.centroid_embedding);
  if (similarity >= MERGE_THRESHOLD && shouldMergeIntoExisting(topEpisode, moment)) {
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
  const v3Fields = toEpisodeV3StorageFields(
    buildEpisodeV3Source({
      id: existing.id,
      title: existing.title,
      summary: buildEpisodeSummary(moment),
      topics: mergedTopics,
      mood: moment.mood,
      kind: existing.kind,
      salience: Math.max(existing.salience, moment.salience),
      unresolved: status === "active",
      status,
      recurrence_count: existing.recurrence_count + 1,
      origin_moment_summaries: originMomentSummaries,
    }),
  );
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
    v3Domain: v3Fields.v3Domain,
    v3PressureSource: v3Fields.v3PressureSource,
    v3RelationalImpact: v3Fields.v3RelationalImpact,
    v3UserStance: v3Fields.v3UserStance,
    v3UnresolvedLevel: v3Fields.v3UnresolvedLevel,
    v3EventSummary: v3Fields.v3EventSummary,
    v3EvidenceTurns: v3Fields.v3EvidenceTurns,
    v3LastUserPosition: v3Fields.v3LastUserPosition,
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
  const v3Fields = toEpisodeV3StorageFields(
    buildEpisodeV3Source({
      id: "episode-v3-create",
      title: titleSource.slice(0, 30),
      summary,
      topics: moment.topic ? [moment.topic] : [],
      mood: moment.mood,
      kind: moment.kind,
      salience: moment.salience,
      unresolved: status === "active",
      status,
      recurrence_count: 1,
      origin_moment_summaries: [moment.summary],
    }),
  );
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
    v3Domain: v3Fields.v3Domain,
    v3PressureSource: v3Fields.v3PressureSource,
    v3RelationalImpact: v3Fields.v3RelationalImpact,
    v3UserStance: v3Fields.v3UserStance,
    v3UnresolvedLevel: v3Fields.v3UnresolvedLevel,
    v3EventSummary: v3Fields.v3EventSummary,
    v3EvidenceTurns: v3Fields.v3EvidenceTurns,
    v3LastUserPosition: v3Fields.v3LastUserPosition,
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
      const { lexicalOverlap, topicAnchorHit } = getRecallAnchorStrength(episode, userMessage);
      const lexicalBoost = Math.min(
        0.12,
        (lexicalOverlap * 0.08) + (topicAnchorHit ? 0.04 : 0),
      );
      const recentReferencePenalty =
        lastReferencedAtMs > 0 && now - lastReferencedAtMs < RECENT_REFERENCE_WINDOW_MS
          ? topicAnchorHit || lexicalOverlap >= 0.34
            ? RECENT_REFERENCE_BASE_PENALTY
            : RECENT_REFERENCE_STRONG_PENALTY
          : 0;
      const breadthPenalty =
        (isTooWideForCrossTopicMerge(episode) || hasWeakAnchor(episode)) &&
        !topicAnchorHit &&
        lexicalOverlap < 0.34
          ? WIDE_EPISODE_RELEVANCE_PENALTY
          : 0;
      const score =
        (0.6 * cosine) +
        (0.2 * episode.salience) +
        (0.1 * recencyScore) +
        (0.1 * unresolvedBoost) +
        lexicalBoost -
        recentReferencePenalty -
        breadthPenalty;
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
