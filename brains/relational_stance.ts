import type { SlowBrainSnapshot } from "./slow_brain_store";
import type { RelationalStance } from "../persona";

const NEGATIVE_MOOD_CUES = [
  "难过",
  "伤心",
  "低落",
  "委屈",
  "疲惫",
  "烦躁",
  "焦虑",
  "崩溃",
  "累",
  "烦",
  "失眠",
];

const POSITIVE_MOOD_CUES = [
  "开心",
  "放松",
  "轻松",
  "高兴",
  "踏实",
  "期待",
  "平静",
];

function includesAny(text: string, cues: string[]): boolean {
  return cues.some((cue) => text.includes(cue));
}

function countRecentNegativeMoods(snapshot: SlowBrainSnapshot): number {
  return snapshot.moodTrajectory
    .slice(-4)
    .map((entry) => entry.mood)
    .filter((mood) => includesAny(mood, NEGATIVE_MOOD_CUES)).length;
}

function hasRecentPositiveMood(snapshot: SlowBrainSnapshot): boolean {
  return snapshot.moodTrajectory
    .slice(-3)
    .some((entry) => includesAny(entry.mood, POSITIVE_MOOD_CUES));
}

function hasSalientUnresolvedCareLine(snapshot: SlowBrainSnapshot): boolean {
  return snapshot.sharedMoments.some((entry) =>
    entry.unresolved &&
    (entry.kind === "support" || entry.kind === "stress") &&
    (entry.salience ?? 0) >= 0.62,
  );
}

export function deriveRelationalStance(
  snapshot: Pick<
    SlowBrainSnapshot,
    "relationship" | "moodTrajectory" | "sharedMoments" | "topicBoundaryState" | "proactiveStrategyState"
  >,
): RelationalStance {
  const familiarity = snapshot.relationship?.familiarity ?? 0;
  const emotionalBond = snapshot.relationship?.emotionalBond ?? 0;
  const closenessScore = (familiarity * 0.55) + (emotionalBond * 0.45);
  const negativeMoodCount = countRecentNegativeMoods(snapshot as SlowBrainSnapshot);
  const positiveMood = hasRecentPositiveMood(snapshot as SlowBrainSnapshot);
  const careLineActive = hasSalientUnresolvedCareLine(snapshot as SlowBrainSnapshot);
  const retreatLevel = snapshot.proactiveStrategyState?.retreatLevel ?? 0;
  const hasBoundary = Boolean(snapshot.topicBoundaryState);

  if (hasBoundary || retreatLevel >= 2 || closenessScore < 0.18) {
    return {
      mode: "light_presence",
      boundary: "light",
      soothingStyle: "listen_first",
      proactiveCadence: "low",
      expressionDirectness: "soft",
    };
  }

  if ((negativeMoodCount >= 2 || careLineActive) && closenessScore >= 0.52) {
    return {
      mode: "anchored_care",
      boundary: closenessScore >= 0.72 ? "close" : "steady",
      soothingStyle: "grounded_reassurance",
      proactiveCadence: "guarded",
      expressionDirectness: "clear",
    };
  }

  if (closenessScore >= 0.64 && negativeMoodCount === 0 && positiveMood) {
    return {
      mode: "close_warmth",
      boundary: "close",
      soothingStyle: "easy_banter",
      proactiveCadence: "balanced",
      expressionDirectness: "balanced",
    };
  }

  return {
    mode: "steady_companion",
    boundary: "steady",
    soothingStyle: "gentle_checkin",
    proactiveCadence: "guarded",
    expressionDirectness: "balanced",
  };
}
