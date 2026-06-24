/**
 * SmartTurnStub — PR5 shadow provider.
 *
 * A LOCAL heuristic that approximates what a SmartTurn / LiveKit Turn Detector
 * model would produce, given only the data already available in the session.
 * This is NOT a real SmartTurn integration. It never calls any external
 * endpoint.
 *
 * Purpose: run in shadow mode alongside LegacyVadTurnDetector. Its result is
 * ALWAYS discarded; only the divergence log matters.
 *
 * Key differences vs legacy:
 *   Turn-end:
 *     - Faster release when sentence-ending punctuation is detected + short gap
 *     - Uses semanticCompletionStreak more aggressively
 *     - Less sensitive to pure gap without text (avoids false-trigger on silence)
 *   Barge-in:
 *     - Cuts in at 280ms (vs 320ms) when a meaningful partial exists
 *     - Still requires hasReliableEvidence — does not change acoustic gate
 */
import { SENTENCE_END } from "../../../../utils/sentence_chunker";
import type {
  TurnTakingDecision,
  TurnTakingDecisionInput,
} from "../../turn_taking";
import type {
  BargeInEvaluation,
  BargeInEvaluationInput,
  TurnDetectorProvider,
} from "./types";

/** Minimum gap before SmartTurn considers a sentence-end release. */
const SMARTTURN_SENTENCE_END_GAP_MS = 180;
/** Minimum gap for semantic-completion-driven release. */
const SMARTTURN_SEMANTIC_GAP_MS = 280;
/** Minimum gap when preview is stable (slightly shorter than legacy). */
const SMARTTURN_STABLE_GAP_MS_RATIO = 0.78;
/** Barge-in cut-in with partial evidence (faster than legacy 320ms). */
const SMARTTURN_BARGE_IN_WITH_PARTIAL_MS = 280;

function endsWithSentenceMark(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && SENTENCE_END.test(t[t.length - 1]);
}

export class SmartTurnStub implements TurnDetectorProvider {
  readonly id = "pipecat_smartturn" as const;

  evaluateTurnEnd(input: TurnTakingDecisionInput): TurnTakingDecision {
    const {
      baseGapMs,
      previewText,
      nowMs,
      lastGrowthAt,
      semanticCompletionStreak,
      likelyStableMs,
      confirmedStableMs,
      releaseMs,
      minGapMs,
    } = input;

    const sinceGrowth = lastGrowthAt > 0 ? nowMs - lastGrowthAt : baseGapMs;
    const text = (previewText ?? "").trim();
    const hasText = text.length >= 2;
    const base = {
      gapMs: baseGapMs,
      previewText: text || undefined,
      usedFallback: false,
      sentenceClosed: false,
      semanticallyComplete: false,
      incompleteTail: false,
      recentGrowth: sinceGrowth < 200,
      stableMs: null as number | null,
    };

    // Guard: still growing → hold
    if (base.recentGrowth) {
      return { ...base, state: "HOLD", primaryReason: "stub_recent_growth", reasons: ["stub_recent_growth"] };
    }

    if (baseGapMs < minGapMs) {
      return { ...base, state: "HOLD", primaryReason: "stub_min_gap", reasons: ["stub_min_gap"] };
    }

    // Fast path: sentence-ending punctuation + short gap (SmartTurn strength)
    if (hasText && endsWithSentenceMark(text) && baseGapMs >= SMARTTURN_SENTENCE_END_GAP_MS) {
      return {
        ...base,
        state: "CONFIRMED_END",
        primaryReason: "stub_sentence_end",
        reasons: ["stub_sentence_end"],
        sentenceClosed: true,
        semanticallyComplete: true,
        stableMs: baseGapMs,
      };
    }

    // Semantic completion signal: streak >= 2
    const streak = semanticCompletionStreak ?? 0;
    if (hasText && streak >= 2 && baseGapMs >= SMARTTURN_SEMANTIC_GAP_MS) {
      return {
        ...base,
        state: "CONFIRMED_END",
        primaryReason: "stub_semantic_streak",
        reasons: ["stub_semantic_streak"],
        semanticallyComplete: true,
        stableMs: baseGapMs,
      };
    }

    // Stability-driven: same concept as legacy but shorter thresholds when text present
    const stableThreshold = hasText
      ? Math.round(likelyStableMs * SMARTTURN_STABLE_GAP_MS_RATIO)
      : likelyStableMs;
    const confirmedThreshold = hasText
      ? Math.round(confirmedStableMs * SMARTTURN_STABLE_GAP_MS_RATIO)
      : confirmedStableMs;

    if (baseGapMs >= confirmedThreshold) {
      return {
        ...base,
        state: "CONFIRMED_END",
        primaryReason: "stub_confirmed_stable",
        reasons: ["stub_confirmed_stable"],
        stableMs: baseGapMs,
      };
    }

    if (baseGapMs >= stableThreshold) {
      return {
        ...base,
        state: "LIKELY_END",
        primaryReason: "stub_likely_stable",
        reasons: ["stub_likely_stable"],
        stableMs: baseGapMs,
      };
    }

    // Release gate (silence after very short text)
    if (baseGapMs >= releaseMs && !hasText) {
      return { ...base, state: "HOLD", primaryReason: "stub_no_text_hold", reasons: ["stub_no_text_hold"] };
    }

    return { ...base, state: "HOLD", primaryReason: "stub_hold", reasons: ["stub_hold"] };
  }

  evaluateBargeIn(input: BargeInEvaluationInput): BargeInEvaluation {
    if (!input.assistantActive) {
      return { decision: "none", source: this.id };
    }

    // With partial transcript: lower the time gate to 280ms (vs legacy 320ms)
    const minMs = input.hasPartial
      ? SMARTTURN_BARGE_IN_WITH_PARTIAL_MS
      : input.minSpeechMs;

    if (input.speechDurationMs < minMs) {
      return { decision: "candidate", source: this.id };
    }

    return {
      decision: input.hasReliableEvidence ? "confirmed" : "candidate",
      source: this.id,
    };
  }
}
