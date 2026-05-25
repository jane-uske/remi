import type { SlowBrainSnapshot } from "../brains/background_analysis_store";
import { extractKeywords } from "./text_utils";
import { getLongHorizonThreadCandidates, getSnapshotEpisodeCandidates } from "./snapshot_ranking";

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
