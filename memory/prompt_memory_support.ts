/**
 * Re-export barrel — preserves all existing import paths.
 *
 * Actual implementations live in focused modules:
 *   text_utils.ts          — normalizeText, extractKeywords, escapeRegExp, keywordOverlapScore, sanitizeMemoryEvidenceText
 *   recall_filters.ts      — isLightAcknowledgementTurn, isExplicitMemoryRecallRequest, isVolatileMemoryKey, hasDirectTextOverlap
 *   snapshot_ranking.ts    — getSnapshotThreadCandidates, getSnapshotEpisodeCandidates, getLongHorizonThreadCandidates, episodeLongHorizonRankingEnabled, episodeStorePromptEnabled
 *   relationship_builder.ts — buildRelationshipTexts
 */

export {
  normalizeText,
  extractKeywords,
  escapeRegExp,
  keywordOverlapScore,
  sanitizeMemoryEvidenceText,
} from "./text_utils";

export {
  isLightAcknowledgementTurn,
  isExplicitMemoryRecallRequest,
  isVolatileMemoryKey,
  hasDirectTextOverlap,
} from "./recall_filters";

export type {
  SnapshotThreadCandidate,
  SnapshotEpisodeCandidate,
} from "./snapshot_ranking";

export {
  episodeLongHorizonRankingEnabled,
  episodeStorePromptEnabled,
  getSnapshotThreadCandidates,
  getSnapshotEpisodeCandidates,
  getLongHorizonThreadCandidates,
} from "./snapshot_ranking";

export { buildRelationshipTexts } from "./relationship_builder";
