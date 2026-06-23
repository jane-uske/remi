/**
 * LegacyVadTurnDetector — wraps the existing energy-VAD + heuristic turn-taking
 * and barge-in logic behind the TurnDetectorProvider seam.
 *
 * It is intentionally a thin delegator:
 *   - `evaluateTurnEnd` calls the existing pure `decideTurnTaking()` verbatim.
 *   - `evaluateBargeIn` mirrors the existing confirm predicate
 *     (`speechDurationMs >= minSpeechMs && hasReliableEvidence`) used in
 *     ConnectionSession.maybeConfirmPendingDuplexInterrupt — it adds NO new
 *     threshold and changes NO behavior.
 *
 * This is the legacy fallback that must always remain available.
 */
import {
  decideTurnTaking,
  type TurnTakingDecision,
  type TurnTakingDecisionInput,
} from "../../turn_taking";
import type {
  BargeInEvaluation,
  BargeInEvaluationInput,
  TurnDetectorProvider,
} from "./types";

export class LegacyVadTurnDetector implements TurnDetectorProvider {
  readonly id = "legacy" as const;

  evaluateTurnEnd(input: TurnTakingDecisionInput): TurnTakingDecision {
    return decideTurnTaking(input);
  }

  evaluateBargeIn(input: BargeInEvaluationInput): BargeInEvaluation {
    if (!input.assistantActive) {
      return { decision: "none", source: this.id };
    }
    if (input.speechDurationMs < input.minSpeechMs) {
      return { decision: "candidate", source: this.id };
    }
    return {
      decision: input.hasReliableEvidence ? "confirmed" : "candidate",
      source: this.id,
    };
  }
}
