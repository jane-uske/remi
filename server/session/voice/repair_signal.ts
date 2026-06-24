/**
 * repair_signal — PR7 low-confidence (would-repair) assessment.
 *
 * Remi has no numeric STT confidence, so we derive a "this transcript is
 * low-confidence / likely-misheard" signal from existing heuristics already in
 * the turn-taking layer plus the STT final disambiguator outcome.
 *
 * SHADOW ONLY: the result is fed to SpeechRuntime as a `repair.requested` event
 * for measurement (how often Remi WOULD ask for clarification). It does NOT send
 * a clarification, gate the reply, or change any behavior. The behavioral
 * version (actually entering `repairing` + asking) is a future flag-gated step.
 */
import {
  getMeaningfulTurnPreview,
  isTentativeSpeechText,
} from "../turn_taking";
import { classifyNonSpeechTranscript } from "../turn_taking_predictor";

export interface SttDisambiguationInfo {
  changed: boolean;
  matchedRuleIds: string[];
}

export type RepairReason =
  | "empty"
  | "non_speech"
  | "tentative"
  | "disambiguated"
  | "too_short";

export interface RepairAssessment {
  lowConfidence: boolean;
  reason: RepairReason | null;
}

/**
 * Assess a committed STT final for low confidence. Ordered most-certain signal
 * first; the matched `reason` lets the shadow telemetry break down WHY.
 */
export function assessTranscriptConfidence(
  rawText: string,
  disambiguation: SttDisambiguationInfo,
): RepairAssessment {
  const text = (rawText ?? "").trim();
  if (!text) return { lowConfidence: true, reason: "empty" };
  if (classifyNonSpeechTranscript(text).reject) {
    return { lowConfidence: true, reason: "non_speech" };
  }
  if (isTentativeSpeechText(text)) {
    return { lowConfidence: true, reason: "tentative" };
  }
  if (disambiguation.changed) {
    // The STT raw output had to be rule-rewritten → the recognizer was unsure.
    return { lowConfidence: true, reason: "disambiguated" };
  }
  const meaningfulChars = getMeaningfulTurnPreview(text).replace(/\s+/g, "").length;
  if (meaningfulChars <= 1) {
    return { lowConfidence: true, reason: "too_short" };
  }
  return { lowConfidence: false, reason: null };
}
