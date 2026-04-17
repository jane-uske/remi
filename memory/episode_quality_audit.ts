import type { DbMessage } from "../storage/types";
import type { DbEpisode } from "../storage/repositories/episode_repository";
import {
  extractKeywords,
  normalizeText,
} from "./prompt_memory_support";

export interface EpisodeRecallAuditSample {
  messageId: string;
  content: string;
  topEpisodeId: string | null;
  topEpisodeTitle?: string;
  topScore?: number;
}

export interface EpisodeMergeSuspect {
  episodeId: string;
  title: string;
  recurrenceCount: number;
  cohesionScore: number;
  topicCount: number;
  reason: string;
}

export interface EpisodeDuplicateSuspect {
  leftEpisodeId: string;
  leftTitle: string;
  rightEpisodeId: string;
  rightTitle: string;
  overlapScore: number;
  reason: string;
}

export interface EpisodeCoverageSuspect {
  messageId: string;
  createdAt: string;
  preview: string;
  reason: string;
}

export interface EpisodeResurfaceSuspect {
  episodeId: string;
  title: string;
  dominantCount: number;
  distinctQueryCount: number;
  reason: string;
}

export interface EpisodeQualityAuditReport {
  generatedAt: string;
  sampleWindow: {
    totalEpisodes: number;
    auditedMessages: number;
    auditedRecallSamples: number;
  };
  episodeStats: {
    recurringEpisodes: number;
    unresolvedEpisodes: number;
    recurringWithOrigins: number;
  };
  qualitySignals: {
    mergeSuspectRate: number;
    duplicateLineRate: number;
    unresolvedHitRate: number | null;
    repeatedResurfaceRate: number | null;
  };
  suspects: {
    merge: EpisodeMergeSuspect[];
    duplicateLines: EpisodeDuplicateSuspect[];
    unresolvedCoverage: EpisodeCoverageSuspect[];
    repeatedResurface: EpisodeResurfaceSuspect[];
  };
  notes: string[];
}

function overlapScore(leftKeywords: string[], rightKeywords: string[]): number {
  if (leftKeywords.length === 0 || rightKeywords.length === 0) return 0;
  const leftSet = new Set(leftKeywords);
  const rightSet = new Set(rightKeywords);
  let overlap = 0;
  for (const keyword of leftSet) {
    if (rightSet.has(keyword)) overlap += 1;
  }
  return overlap / Math.max(1, Math.min(leftSet.size, rightSet.size));
}

function episodeKeywords(episode: Pick<DbEpisode, "title" | "summary" | "topics" | "origin_moment_summaries">): string[] {
  return [
    ...extractKeywords(episode.title),
    ...extractKeywords(episode.summary),
    ...episode.topics.flatMap((topic) => extractKeywords(topic)),
    ...episode.origin_moment_summaries.flatMap((summary) => extractKeywords(summary)),
  ];
}

function pairwiseAverage(values: number[]): number {
  if (values.length === 0) return 1;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildMergeSuspects(episodes: DbEpisode[]): EpisodeMergeSuspect[] {
  const suspects: EpisodeMergeSuspect[] = [];

  for (const episode of episodes) {
    if (episode.recurrence_count < 2 || episode.origin_moment_summaries.length < 2) {
      continue;
    }

    const summaryKeywords = episode.origin_moment_summaries.map((summary) => extractKeywords(summary));
    const pairScores: number[] = [];
    const anchorKeywords = [
      ...extractKeywords(episode.title),
      ...episode.topics.flatMap((topic) => extractKeywords(topic)),
    ];
    const anchorCoverage = pairwiseAverage(
      summaryKeywords.map((keywords) => overlapScore(keywords, anchorKeywords)),
    );
    for (let index = 0; index < summaryKeywords.length; index += 1) {
      for (let cursor = index + 1; cursor < summaryKeywords.length; cursor += 1) {
        pairScores.push(overlapScore(summaryKeywords[index], summaryKeywords[cursor]));
      }
    }
    const cohesionScore = pairwiseAverage(pairScores);
    const topicCount = new Set(episode.topics.filter(Boolean)).size;
    const wideTopicSpread = topicCount >= 3;

    const shouldFlag =
      (wideTopicSpread && cohesionScore < 0.28) ||
      (episode.origin_moment_summaries.length >= 3 && cohesionScore < 0.12 && anchorCoverage < 0.45);
    if (shouldFlag) {
      suspects.push({
        episodeId: episode.id,
        title: episode.title,
        recurrenceCount: episode.recurrence_count,
        cohesionScore: Number(cohesionScore.toFixed(3)),
        topicCount,
        reason:
          wideTopicSpread
            ? "topic spread is wide while summary cohesion stays weak; inspect for mixed lines"
            : "multi-turn line has weak summary cohesion and weak anchor coverage; inspect for over-merge",
      });
    }
  }

  return suspects;
}

function buildDuplicateSuspects(episodes: DbEpisode[]): EpisodeDuplicateSuspect[] {
  const suspects: EpisodeDuplicateSuspect[] = [];

  for (let index = 0; index < episodes.length; index += 1) {
    for (let cursor = index + 1; cursor < episodes.length; cursor += 1) {
      const left = episodes[index];
      const right = episodes[cursor];
      const leftKeywords = episodeKeywords(left);
      const rightKeywords = episodeKeywords(right);
      const score = overlapScore(leftKeywords, rightKeywords);
      const sameTopics =
        left.topics.length > 0 &&
        right.topics.length > 0 &&
        left.topics.every((topic) => right.topics.includes(topic));
      const titleOverlap =
        normalizeText(left.title).includes(normalizeText(right.title)) ||
        normalizeText(right.title).includes(normalizeText(left.title));
      const summaryOverlap =
        normalizeText(left.summary).includes(normalizeText(right.title)) ||
        normalizeText(right.summary).includes(normalizeText(left.title));
      const nearDuplicate =
        score >= 0.38 ||
        (sameTopics && (titleOverlap || summaryOverlap)) ||
        (titleOverlap && score >= 0.22);
      if (!nearDuplicate) continue;
      suspects.push({
        leftEpisodeId: left.id,
        leftTitle: left.title,
        rightEpisodeId: right.id,
        rightTitle: right.title,
        overlapScore: Number(score.toFixed(3)),
        reason: "two separate episodes share unusually similar title/summary/topic keywords",
      });
    }
  }

  return suspects;
}

function looksSalientUserMessage(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed.length < 8) return false;
  return /最近|一直|昨晚|今天|因为|结果|工作|睡眠|失眠|焦虑|难过|委屈|关系|朋友|家人|想|打算|计划/u.test(
    trimmed,
  );
}

function buildCoverageSuspects(
  episodes: DbEpisode[],
  messages: DbMessage[],
): {
  coveredCount: number;
  salientCount: number;
  suspects: EpisodeCoverageSuspect[];
} {
  const unresolvedEpisodes = episodes.filter((episode) => episode.unresolved);
  const unresolvedKeywordSets = unresolvedEpisodes.map((episode) => ({
    episode,
    keywords: episodeKeywords(episode),
  }));
  const suspects: EpisodeCoverageSuspect[] = [];
  let coveredCount = 0;
  let salientCount = 0;

  for (const message of messages) {
    if (message.role !== "user" || !looksSalientUserMessage(message.content)) {
      continue;
    }
    salientCount += 1;
    const keywords = extractKeywords(message.content);
    const covered = unresolvedKeywordSets.some((entry) =>
      overlapScore(keywords, entry.keywords) >= 0.18 ||
      keywords.some((keyword) => entry.keywords.includes(keyword)) ||
      normalizeText(entry.episode.title).includes(normalizeText(message.content)) ||
      normalizeText(message.content).includes(normalizeText(entry.episode.title)) ||
      keywords.some((keyword) => normalizeText(entry.episode.summary).includes(keyword)),
    );
    if (covered) {
      coveredCount += 1;
      continue;
    }
    suspects.push({
      messageId: message.id,
      createdAt: message.created_at.toISOString(),
      preview: message.content.slice(0, 120),
      reason: "recent salient user line has no obvious unresolved-episode coverage",
    });
  }

  return { coveredCount, salientCount, suspects };
}

function buildRepeatedResurfaceSuspects(
  recallSamples: EpisodeRecallAuditSample[],
): {
  suspiciousSampleCount: number;
  suspects: EpisodeResurfaceSuspect[];
} {
  const grouped = new Map<string, EpisodeRecallAuditSample[]>();
  for (const sample of recallSamples) {
    if (!sample.topEpisodeId) continue;
    const list = grouped.get(sample.topEpisodeId) ?? [];
    list.push(sample);
    grouped.set(sample.topEpisodeId, list);
  }

  const suspects: EpisodeResurfaceSuspect[] = [];
  let suspiciousSampleCount = 0;

  for (const [episodeId, samples] of grouped.entries()) {
    if (samples.length < 3) continue;
    const distinctQueries = samples.reduce((count, sample, index) => {
      if (index === 0) return count + 1;
      const previous = extractKeywords(samples[index - 1].content);
      const current = extractKeywords(sample.content);
      return overlapScore(previous, current) < 0.18 ? count + 1 : count;
    }, 0);
    if (distinctQueries < 3) continue;
    suspiciousSampleCount += samples.length;
    suspects.push({
      episodeId,
      title: samples[0].topEpisodeTitle || episodeId,
      dominantCount: samples.length,
      distinctQueryCount: distinctQueries,
      reason: "same top recall dominates multiple weakly related user queries; inspect repeat resurfacing",
    });
  }

  return { suspiciousSampleCount, suspects };
}

export function buildEpisodeQualityAuditReport(input: {
  episodes: DbEpisode[];
  messages: DbMessage[];
  recallSamples?: EpisodeRecallAuditSample[];
}): EpisodeQualityAuditReport {
  const episodes = input.episodes.slice();
  const messages = input.messages.slice();
  const recallSamples = input.recallSamples ?? [];
  const mergeSuspects = buildMergeSuspects(episodes);
  const duplicateLines = buildDuplicateSuspects(episodes);
  const coverage = buildCoverageSuspects(episodes, messages);
  const repeatedResurface = buildRepeatedResurfaceSuspects(recallSamples);

  const recurringEpisodes = episodes.filter((episode) => episode.recurrence_count >= 2);
  const recurringWithOrigins = recurringEpisodes.filter(
    (episode) => episode.origin_moment_summaries.length >= 2,
  );
  const mergeDenominator = Math.max(1, recurringWithOrigins.length);
  const duplicateDenominator = Math.max(1, episodes.length);
  const unresolvedHitRate =
    coverage.salientCount > 0
      ? Number((coverage.coveredCount / coverage.salientCount).toFixed(3))
      : null;
  const repeatedResurfaceRate =
    recallSamples.length > 0
      ? Number((repeatedResurface.suspiciousSampleCount / recallSamples.length).toFixed(3))
      : null;

  const notes = [
    "All quality signals here are heuristic suspects for observation, not production-grade acceptance proof.",
    "Use merge/duplicate suspects to drive manual spot-checks against real conversations before changing thresholds.",
  ];
  if (coverage.salientCount === 0) {
    notes.push("No salient recent user messages were found, so unresolved coverage stayed unscored.");
  }
  if (recallSamples.length === 0) {
    notes.push("No recall samples were audited; repeated-resurface analysis is skipped when embedding recall is unavailable.");
  }

  return {
    generatedAt: new Date().toISOString(),
    sampleWindow: {
      totalEpisodes: episodes.length,
      auditedMessages: messages.length,
      auditedRecallSamples: recallSamples.length,
    },
    episodeStats: {
      recurringEpisodes: recurringEpisodes.length,
      unresolvedEpisodes: episodes.filter((episode) => episode.unresolved).length,
      recurringWithOrigins: recurringWithOrigins.length,
    },
    qualitySignals: {
      mergeSuspectRate: Number((mergeSuspects.length / mergeDenominator).toFixed(3)),
      duplicateLineRate: Number((duplicateLines.length / duplicateDenominator).toFixed(3)),
      unresolvedHitRate,
      repeatedResurfaceRate,
    },
    suspects: {
      merge: mergeSuspects,
      duplicateLines,
      unresolvedCoverage: coverage.suspects,
      repeatedResurface: repeatedResurface.suspects,
    },
    notes,
  };
}

export function renderEpisodeQualityAuditMarkdown(
  report: EpisodeQualityAuditReport,
  extra?: { embeddingStatus?: string; embeddingDetail?: string },
): string {
  const mergeLines =
    report.suspects.merge.length > 0
      ? report.suspects.merge.map((entry) =>
          `- ${entry.title} (${entry.episodeId}) cohesion=${entry.cohesionScore}, recurrence=${entry.recurrenceCount}, topics=${entry.topicCount} — ${entry.reason}`,
        )
      : ["- none"];
  const duplicateLines =
    report.suspects.duplicateLines.length > 0
      ? report.suspects.duplicateLines.map((entry) =>
          `- ${entry.leftTitle} <-> ${entry.rightTitle} overlap=${entry.overlapScore} — ${entry.reason}`,
        )
      : ["- none"];
  const coverageLines =
    report.suspects.unresolvedCoverage.length > 0
      ? report.suspects.unresolvedCoverage.map((entry) =>
          `- ${entry.createdAt} ${entry.preview} — ${entry.reason}`,
        )
      : ["- none"];
  const resurfacingLines =
    report.suspects.repeatedResurface.length > 0
      ? report.suspects.repeatedResurface.map((entry) =>
          `- ${entry.title} (${entry.episodeId}) dominant=${entry.dominantCount}, distinct_queries=${entry.distinctQueryCount} — ${entry.reason}`,
        )
      : ["- none"];

  const lines = [
    "# Memory V2 Episode Audit",
    "",
    `- generated_at: ${report.generatedAt}`,
    `- total_episodes: ${report.sampleWindow.totalEpisodes}`,
    `- audited_messages: ${report.sampleWindow.auditedMessages}`,
    `- audited_recall_samples: ${report.sampleWindow.auditedRecallSamples}`,
    `- embedding_status: ${extra?.embeddingStatus ?? "unknown"}`,
    `- embedding_detail: ${extra?.embeddingDetail ?? "n/a"}`,
    "",
    "## Signals",
    "",
    `- merge_suspect_rate: ${report.qualitySignals.mergeSuspectRate}`,
    `- duplicate_line_rate: ${report.qualitySignals.duplicateLineRate}`,
    `- unresolved_hit_rate: ${report.qualitySignals.unresolvedHitRate ?? "n/a"}`,
    `- repeated_resurface_rate: ${report.qualitySignals.repeatedResurfaceRate ?? "n/a"}`,
    "",
    "## Merge Suspects",
    ...mergeLines,
    "",
    "## Duplicate Line Suspects",
    ...duplicateLines,
    "",
    "## Unresolved Coverage Gaps",
    ...coverageLines,
    "",
    "## Repeated Resurface Suspects",
    ...resurfacingLines,
    "",
    "## Notes",
    ...report.notes.map((note) => `- ${note}`),
    "",
  ];

  return `${lines.join("\n")}`;
}
