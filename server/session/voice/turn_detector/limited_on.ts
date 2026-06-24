/**
 * limited_on — PR5d asymmetric turn-END adjustment.
 *
 * Given the legacy decision and a real-model EOU probability, return a possibly
 * adjusted decision under STRICT one-directional rules. This is the only place
 * a real provider may influence live behavior, and it is provably safe:
 *
 *   - LOW EOU (< eouLow): the model thinks the user is very likely NOT done.
 *     Used ONLY to extend patience — downgrade legacy CONFIRMED_END → LIKELY_END
 *     so we wait one more cycle. NEVER cuts earlier. Bounded by a hard safety cap
 *     (lowEouMaxExtraHoldMs) so a persistently-low EOU cannot hang the turn.
 *
 *   - HIGH EOU (>= eouHigh): the model is confident the user finished. Used ONLY
 *     to upgrade legacy LIKELY_END → CONFIRMED_END (commit a complete sentence
 *     sooner). NEVER promotes HOLD (so an utterance legacy considers unfinished
 *     is never cut), never touches an already-CONFIRMED decision.
 *
 *   - MIDDLE (eouLow..eouHigh): no intervention, pure legacy.
 *
 * Barge-in is never touched here. This function is pure and side-effect free.
 */
import type {
  TurnTakingDecision,
  TurnTakingDecisionInput,
} from "../../turn_taking";

export interface LimitedOnConfig {
  eouLow: number;
  eouHigh: number;
  lowEouMaxExtraHoldMs: number;
}

export type LimitedOnAction = "none" | "low_eou_hold" | "high_eou_commit";

export interface LimitedOnResult {
  decision: TurnTakingDecision;
  action: LimitedOnAction;
}

export function applyLimitedOnAdjustment(
  legacy: TurnTakingDecision,
  eouProb: number,
  input: TurnTakingDecisionInput,
  cfg: LimitedOnConfig,
): LimitedOnResult {
  // Guard against bad inputs — any non-finite EOU means "no signal" → legacy.
  if (!Number.isFinite(eouProb)) return { decision: legacy, action: "none" };

  // ── LOW EOU: extend patience only. Never cut earlier. ────────────────────
  if (eouProb < cfg.eouLow) {
    if (legacy.state === "CONFIRMED_END") {
      // Safety: if legacy has already held well past the confirmed threshold,
      // release — a stuck-low EOU must never hang the turn forever.
      const cap = input.confirmedStableMs + cfg.lowEouMaxExtraHoldMs;
      if (legacy.stableMs != null && legacy.stableMs >= cap) {
        return { decision: legacy, action: "none" };
      }
      return {
        decision: {
          ...legacy,
          state: "LIKELY_END",
          primaryReason: "limited_on_low_eou_hold",
          reasons: [...legacy.reasons, "limited_on_low_eou_hold"],
        },
        action: "low_eou_hold",
      };
    }
    // HOLD / LIKELY_END already do not cut — leave untouched.
    return { decision: legacy, action: "none" };
  }

  // ── HIGH EOU: commit a complete sentence sooner. Only LIKELY_END→CONFIRMED. ─
  if (eouProb >= cfg.eouHigh) {
    if (legacy.state === "LIKELY_END") {
      return {
        decision: {
          ...legacy,
          state: "CONFIRMED_END",
          primaryReason: "limited_on_high_eou_commit",
          reasons: [...legacy.reasons, "limited_on_high_eou_commit"],
        },
        action: "high_eou_commit",
      };
    }
    // HOLD stays HOLD (never cut an unfinished turn); CONFIRMED stays CONFIRMED.
    return { decision: legacy, action: "none" };
  }

  // ── MIDDLE band: no intervention. ────────────────────────────────────────
  return { decision: legacy, action: "none" };
}
