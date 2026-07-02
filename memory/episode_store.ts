import { embed } from "../llm/embedding_client";
import { getConfig } from "../server/config";
import { extractKeywords, normalizeText } from "./prompt_memory_support";
import { toEpisodeV3StorageFields } from "./episode_v3";
import { isDatabaseReady } from "../storage/database";
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
/**
 * P0 反复读修复：当本轮消息与某 episode 的余弦相似度是本批次最高且过阈值时，
 * 视为用户主动跟进该话题（"对了，上次说的那个事..."），而非闲聊漂移带出的复读。
 * 此时最近引用惩罚从 STRONG 降到这里（弱惩罚，非全免），保留少量抑制避免同一句话
 * 秒级反复触发。仅对"结构上可信"的 episode 生效——宽泛/弱锚点 episode 的高余弦
 * 往往是多话题质心稀释的假象，不豁免（见 isTooWideForCrossTopicMerge/hasWeakAnchor）。
 */
const RECENT_REFERENCE_FOLLOWUP_PENALTY = 0.08;
const FOLLOWUP_COSINE_THRESHOLD = 0.55;
const WIDE_EPISODE_RELEVANCE_PENALTY = 0.12;
const MAX_MERGEABLE_TOPICS = 3;
const WIDE_EPISODE_RECURRENCE_FLOOR = 6;
const WIDE_EPISODE_SUMMARY_FLOOR = 3;
const LOW_COHESION_SCORE = 0.12;
const LOW_ANCHOR_COVERAGE = 0.45;

export type EpisodeLifecycleStatus = "active" | "cooling" | "resolved";

/**
 * DL-P0-5: episode 记忆归属。core=本体记忆（Remi 永久记得）；
 * performance=演出/剧情记忆（退出后保留为剧情，但不进 Core 人格基线）。
 * 设计见 docs/design/DIGITAL_LIFE_NORTH_STAR.md §2c / ROLEPLAY_LAYER_DESIGN.md §5。
 */
export type EpisodeScope = "core" | "performance";

export interface MomentInput {
  userId: string;
  summary: string;
  topic: string;
  mood: string;
  kind: string;
  salience: number;
  unresolved: boolean;
  statusHint?: EpisodeLifecycleStatus;
  /**
   * DL-P0-5: 记忆归属，默认 core。performance=演出期写入，与本体隔离。
   * 运行时写入路径暂未消费此字段（P0 无运行时行为变更）；待 ROLEPLAY 实现接入。
   */
  scope?: EpisodeScope;
}

export interface RankedEpisode {
  episode: DbEpisode;
  score: number;
  /**
   * 调参用诊断信息，不参与业务逻辑消费。记录本条 episode 在本轮打分中
   * 触发了哪种最近引用惩罚路径，便于日后回放/调参时判断豁免是否生效。
   */
  diagnostics?: RankedEpisodeDiagnostics;
}

export interface RankedEpisodeDiagnostics {
  cosine: number;
  isBatchTopCosine: boolean;
  followUpExemptionApplied: boolean;
  recentReferencePenaltyKind: "none" | "followup" | "base" | "strong";
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
  if (!isDatabaseReady()) {
    throw new Error("Database not available for episode ingest");
  }
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
  if (!isDatabaseReady()) return [];
  const messageEmbedding = await embed(userMessage);
  const episodes = await findSimilarEpisodes(userId, messageEmbedding, topK ?? RELEVANCE_TOP_K);
  const now = Date.now();

  // 先算好本批次每个候选的余弦，取批内最大值：判断"是否本轮最相关候选之一"
  // 必须相对同批次其他候选定义，不能逐条独立判断。
  const cosineByEpisodeId = new Map<string, number>();
  for (const episode of episodes) {
    cosineByEpisodeId.set(episode.id, cosineSimilarity(messageEmbedding, episode.centroid_embedding));
  }
  const batchTopCosine = Math.max(0, ...Array.from(cosineByEpisodeId.values()));

  return episodes
    .map((episode) => {
      const cosine = cosineByEpisodeId.get(episode.id) ?? 0;
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

      // "跟进召回" vs "闲聊漂移复读"：本轮消息与该 episode 的余弦是批内最高
      // 且过绝对阈值，同时该 episode 结构上不是宽泛/弱锚点合集（否则高余弦
      // 可能只是多话题质心稀释的假象，不构成"用户主动提起"的可信信号）。
      const isBatchTopCosine = cosine >= FOLLOWUP_COSINE_THRESHOLD && cosine >= batchTopCosine;
      const isStructurallyTrustworthy =
        !isTooWideForCrossTopicMerge(episode) && !hasWeakAnchor(episode);
      const followUpExemptionEligible = isBatchTopCosine && isStructurallyTrustworthy;

      const withinRecentWindow =
        lastReferencedAtMs > 0 && now - lastReferencedAtMs < RECENT_REFERENCE_WINDOW_MS;
      const lexicalPathHit = topicAnchorHit || lexicalOverlap >= 0.34;

      let recentReferencePenalty = 0;
      let recentReferencePenaltyKind: RankedEpisodeDiagnostics["recentReferencePenaltyKind"] = "none";
      if (withinRecentWindow) {
        if (followUpExemptionEligible) {
          // 跟进信号最强，优先生效，即使词面锚点没命中。
          recentReferencePenalty = RECENT_REFERENCE_FOLLOWUP_PENALTY;
          recentReferencePenaltyKind = "followup";
        } else if (lexicalPathHit) {
          recentReferencePenalty = RECENT_REFERENCE_BASE_PENALTY;
          recentReferencePenaltyKind = "base";
        } else {
          recentReferencePenalty = RECENT_REFERENCE_STRONG_PENALTY;
          recentReferencePenaltyKind = "strong";
        }
      }

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

      if (process.env.REMI_DEBUG_EPISODE_RECALL === "1") {
        console.log(
          `[episode_store] recall diagnostics id=${episode.id} cosine=${cosine.toFixed(3)} ` +
            `batchTop=${isBatchTopCosine} trustworthy=${isStructurallyTrustworthy} ` +
            `penaltyKind=${recentReferencePenaltyKind} penalty=${recentReferencePenalty} score=${score.toFixed(3)}`,
        );
      }

      return {
        episode,
        score,
        diagnostics: {
          cosine,
          isBatchTopCosine,
          followUpExemptionApplied: recentReferencePenaltyKind === "followup",
          recentReferencePenaltyKind,
        },
      };
    })
    .sort((a, b) => b.score - a.score);
}

export async function listUnresolved(userId: string): Promise<DbEpisode[]> {
  if (!isDatabaseReady()) return [];
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
