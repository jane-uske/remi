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
import type {
  TurnTakingDecision,
  TurnTakingDecisionInput,
  TurnTakingState,
} from "../../turn_taking";

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
  /** PR5: whether a meaningful partial transcript exists for the current utterance. */
  hasPartial?: boolean;
  /** PR5: current partial/preview text (for shadow logging only, not for decisions). */
  partialText?: string;
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
  /**
   * PR5d: notify the detector of a fresh real partial transcript so it can
   * (async, off the fast path) compute & cache an EOU score for limited_on.
   * Optional — only ShadowTurnDetector in limited_on mode acts on it; legacy
   * ignores it. Never throws.
   */
  notePartial?(text: string): void;
}

// ── PR5b: real (async) provider seam ────────────────────────────────────────

/** Raw model output for a turn-end query (LiveKit/SmartTurn style). */
export interface AsyncTurnEndResult {
  /** Mapped state, so the comparator can diff against legacy directly. */
  state: TurnTakingState;
  /** Probability that the user has finished their turn (end-of-utterance). */
  endOfTurnProb: number;
  /** Provider that produced this. */
  source: TurnDetectorId;
  /** Wall-clock the provider call took (ms), for latency distribution. */
  latencyMs: number;
}

export interface AsyncBargeInResult {
  decision: BargeInDecision;
  source: TurnDetectorId;
  latencyMs: number;
}

/**
 * Async (real-model) turn detector. Runs OFF the synchronous fast path — its
 * results are consumed only by the shadow comparator for logging. ANY of these
 * may resolve to `null` to mean "provider unavailable" (sidecar down, probe
 * failed, timeout); the caller must then keep the legacy result. Implementations
 * MUST NOT throw — they resolve null instead.
 */
export interface AsyncTurnDetectorProvider {
  readonly id: TurnDetectorId;
  /** Cheap, cached availability probe. False → comparator skips this provider. */
  isAvailable(): Promise<boolean>;
  evaluateTurnEndAsync(
    input: TurnTakingDecisionInput,
  ): Promise<AsyncTurnEndResult | null>;
  evaluateBargeInAsync(
    input: BargeInEvaluationInput,
  ): Promise<AsyncBargeInResult | null>;
}
