/**
 * TurnDetectorProvider — Phase 1 seam for turn-end / barge-in classification.
 *
 * This interface encapsulates the existing turn-taking and barge-in logic so it
 * can be made pluggable later (LiveKit Turn Detector v1-mini, Pipecat SmartTurn,
 * etc.) WITHOUT touching the live session control flow each time.
 *
 * Phase 1 contract (see docs/voice/FULL_DUPLEX_SPEECH_RUNTIME_PLAN.md):
 *   - Only `LegacyVadTurnDetector` exists. It delegates 1:1 to the current
 *     `decideTurnTaking()` and mirrors the current barge-in predicate. Behavior
 *     is identical to pre-seam code.
 *   - No third-party model is wired in this round.
 *
 * Code-is-source-of-truth note: the plan doc sketched an async, richer output
 * shape. The real `decideTurnTaking` is synchronous and returns
 * `TurnTakingDecision`, so this interface mirrors the real types instead of the
 * idealized doc shape.
 */
import type { TurnTakingDecision, TurnTakingDecisionInput } from "../../turn_taking";

export type TurnDetectorMode = "off" | "shadow" | "on";
export type TurnDetectorId = "legacy" | "livekit_v1mini" | "pipecat_smartturn";

/** Barge-in classification result. Only `confirmed` should trigger a stop. */
export type BargeInDecision = "none" | "candidate" | "confirmed";

export interface BargeInEvaluationInput {
  /** Assistant is producing audio / pipeline active (barge-in context). */
  assistantActive: boolean;
  /** Duration of the in-progress user utterance. */
  speechDurationMs: number;
  /** Minimum speech duration gate (existing `duplexInterruptMinSpeechMs()`). */
  minSpeechMs: number;
  /**
   * Result of the session's existing reliable-evidence gate
   * (`hasReliableDuplexInterruptEvidence`). This provider does NOT recompute or
   * change that gate — it only classifies given the pre-computed boolean, so the
   * live barge-in trigger condition is unchanged.
   */
  hasReliableEvidence: boolean;
}

export interface BargeInEvaluation {
  decision: BargeInDecision;
  source: TurnDetectorId;
}

export interface TurnDetectorProvider {
  readonly id: TurnDetectorId;
  /** Turn-end detection: decides whether the user has finished their turn. */
  evaluateTurnEnd(input: TurnTakingDecisionInput): TurnTakingDecision;
  /**
   * Barge-in classification from pre-computed evidence. Pure: does not read or
   * mutate session state, does not change thresholds.
   */
  evaluateBargeIn(input: BargeInEvaluationInput): BargeInEvaluation;
}
