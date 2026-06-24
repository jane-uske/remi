/**
 * ShadowTurnDetector — PR5/PR5b shadow comparator + PR5d limited_on.
 *
 * Wraps a primary TurnDetectorProvider (always LegacyVadTurnDetector) plus:
 *   - a SYNC shadow provider (SmartTurnStub) compared inline, and/or
 *   - an optional ASYNC real provider (PR5b) compared fire-and-forget.
 *
 * Modes:
 *   - "shadow"     (default): primary result is ALWAYS returned unchanged; the
 *     real provider runs off the fast path and only LOGS a comparison.
 *   - "limited_on" (PR5d): the real EOU (computed async on partial arrival and
 *     CACHED) may adjust the TURN-END decision ONLY, asymmetrically and safely
 *     (see limited_on.ts). Requires a fresh cached EOU matching the current
 *     preview text; otherwise full legacy. Barge-in is NEVER affected.
 *
 * Constraints (hard):
 *   - shadow mode: primary result never modified.
 *   - limited_on: only turn-END, one-directional (never cuts earlier on low EOU,
 *     never promotes HOLD on high EOU), bounded patience, real-partial-gated.
 *   - No HTTP on the sync decision path: EOU is computed on notePartial() and
 *     read from cache. No cache / stale / mismatch / unavailable → legacy.
 *   - Async paths are fire-and-forget; never throw upward.
 *   - Does not change VAD thresholds, barge-in conditions, or TTS/STT.
 */
import { getConfig } from "../../../../server/config";
import { createLogger } from "../../../../infra/logger";
import type {
  TurnTakingDecision,
  TurnTakingDecisionInput,
} from "../../turn_taking";
import type {
  AsyncTurnDetectorProvider,
  BargeInEvaluation,
  BargeInEvaluationInput,
  TurnDetectorProvider,
} from "./types";
import { applyLimitedOnAdjustment, type LimitedOnConfig } from "./limited_on";

const logger = createLogger("turn_detector_shadow");

export type ShadowMode = "shadow" | "limited_on";

interface EouCacheEntry {
  prob: number;
  text: string;
  at: number;
}

export class ShadowTurnDetector implements TurnDetectorProvider {
  readonly id;

  private eouCache: EouCacheEntry | null = null;
  private noteInFlightText: string | null = null;

  constructor(
    private readonly primary: TurnDetectorProvider,
    private readonly shadow: TurnDetectorProvider,
    private readonly connId?: string,
    private readonly asyncShadow?: AsyncTurnDetectorProvider,
    private readonly mode: ShadowMode = "shadow",
    private readonly nowFn: () => number = () => Date.now(),
  ) {
    this.id = primary.id;
  }

  evaluateTurnEnd(input: TurnTakingDecisionInput): TurnTakingDecision {
    const primaryResult = this.primary.evaluateTurnEnd(input);

    try {
      const t0 = process.hrtime.bigint();
      const shadowResult = this.shadow.evaluateTurnEnd(input);
      const latencyUs = Number(process.hrtime.bigint() - t0) / 1_000;

      const diverged = primaryResult.state !== shadowResult.state;
      const hasPartial = (input.previewText ?? "").trim().length >= 2;

      logger.info("[TurnDetectorShadow] turn_end_comparison", {
        connId: this.connId,
        diverged,
        legacy: {
          state: primaryResult.state,
          primaryReason: primaryResult.primaryReason,
          sentenceClosed: primaryResult.sentenceClosed,
          semanticallyComplete: primaryResult.semanticallyComplete,
          stableMs: primaryResult.stableMs,
        },
        shadow: {
          id: this.shadow.id,
          state: shadowResult.state,
          primaryReason: shadowResult.primaryReason,
        },
        // Divergence direction: which provider ended earlier
        earlierCut: diverged
          ? shadowCutEarlier(primaryResult.state, shadowResult.state)
            ? "shadow"
            : "legacy"
          : "none",
        hasPartial,
        previewLen: (input.previewText ?? "").trim().length,
        gapMs: input.baseGapMs,
        semanticCompletionStreak: input.semanticCompletionStreak ?? 0,
        latencyUs: Math.round(latencyUs),
      });
    } catch (err) {
      logger.warn("[TurnDetectorShadow] shadow evaluateTurnEnd threw", {
        connId: this.connId,
        err: String(err),
      });
    }

    // PR5d: in limited_on, the cached real EOU may adjust the decision (turn-END
    // only). Any failure path falls through to the unmodified legacy result.
    if (this.mode === "limited_on") {
      const adjusted = this.maybeApplyLimitedOn(input, primaryResult);
      if (adjusted) {
        this.compareAsyncTurnEnd(input, primaryResult);
        return adjusted;
      }
    }

    this.compareAsyncTurnEnd(input, primaryResult);
    return primaryResult;
  }

  /**
   * PR5d: apply the asymmetric limited_on adjustment using the cached EOU.
   * Returns the adjusted decision, or null to keep legacy (no/stale/mismatched
   * cache, or no real provider). Never throws.
   */
  private maybeApplyLimitedOn(
    input: TurnTakingDecisionInput,
    legacy: TurnTakingDecision,
  ): TurnTakingDecision | null {
    try {
      if (!this.asyncShadow) return null; // provider unavailable → legacy
      const preview = (input.previewText ?? "").trim();
      if (preview.length < 2) return null; // no real partial → legacy
      const cache = this.eouCache;
      if (!cache) return null;
      const ttl = getConfig().REMI_TURN_DETECTOR_EOU_CACHE_TTL_MS;
      if (this.nowFn() - cache.at > ttl) return null; // stale → legacy
      if (cache.text !== preview) return null; // EOU is for a different text → legacy

      const cfg: LimitedOnConfig = {
        eouLow: getConfig().REMI_TURN_DETECTOR_EOU_LOW,
        eouHigh: getConfig().REMI_TURN_DETECTOR_EOU_HIGH,
        lowEouMaxExtraHoldMs:
          getConfig().REMI_TURN_DETECTOR_LOW_EOU_MAX_EXTRA_HOLD_MS,
      };
      const { decision, action } = applyLimitedOnAdjustment(
        legacy,
        cache.prob,
        input,
        cfg,
      );
      if (action === "none") return null;
      logger.info("[TurnDetectorLimitedOn] adjusted", {
        connId: this.connId,
        action,
        eouProb: Number(cache.prob.toFixed(3)),
        legacyState: legacy.state,
        adjustedState: decision.state,
        stableMs: legacy.stableMs,
        confirmedStableMs: input.confirmedStableMs,
        previewLen: preview.length,
      });
      return decision;
    } catch (err) {
      logger.debug("[TurnDetectorLimitedOn] adjustment failed → legacy", {
        connId: this.connId,
        err: String(err),
      });
      return null;
    }
  }

  /**
   * PR5d: on a fresh real partial, compute & cache the EOU async (off the fast
   * path). No-op outside limited_on / without a real provider. Never throws.
   */
  notePartial(text: string): void {
    if (this.mode !== "limited_on" || !this.asyncShadow) return;
    const preview = (text ?? "").trim();
    if (preview.length < 2) return;
    // Dedup: already have a fresh-enough cache or an in-flight request for it.
    if (this.noteInFlightText === preview) return;
    if (this.eouCache && this.eouCache.text === preview) return;
    this.noteInFlightText = preview;
    void this.asyncShadow
      .evaluateTurnEndAsync({ previewText: preview } as TurnTakingDecisionInput)
      .then((res) => {
        if (res && Number.isFinite(res.endOfTurnProb)) {
          this.eouCache = { prob: res.endOfTurnProb, text: preview, at: this.nowFn() };
        }
      })
      .catch((err) => {
        logger.debug("[TurnDetectorLimitedOn] notePartial EOU failed", {
          connId: this.connId,
          err: String(err),
        });
      })
      .finally(() => {
        if (this.noteInFlightText === preview) this.noteInFlightText = null;
      });
  }

  /** Fire-and-forget real-provider turn-end comparison (PR5b). */
  private compareAsyncTurnEnd(
    input: TurnTakingDecisionInput,
    primaryResult: TurnTakingDecision,
  ): void {
    const real = this.asyncShadow;
    if (!real) return;
    const hasPartial = (input.previewText ?? "").trim().length >= 2;
    void real
      .evaluateTurnEndAsync(input)
      .then((realResult) => {
        if (!realResult) return; // unavailable → keep legacy, log nothing
        const diverged = primaryResult.state !== realResult.state;
        logger.info("[TurnDetectorReal] turn_end_comparison", {
          connId: this.connId,
          provider: realResult.source,
          diverged,
          legacy: {
            state: primaryResult.state,
            primaryReason: primaryResult.primaryReason,
          },
          real: {
            state: realResult.state,
            endOfTurnProb: Number(realResult.endOfTurnProb.toFixed(3)),
          },
          earlierCut: diverged
            ? cutEarlier(primaryResult.state, realResult.state)
              ? "real"
              : "legacy"
            : "none",
          hasPartial,
          previewLen: (input.previewText ?? "").trim().length,
          gapMs: input.baseGapMs,
          latencyMs: Math.round(realResult.latencyMs),
        });
      })
      .catch((err) => {
        logger.debug("[TurnDetectorReal] async turn-end compare failed", {
          connId: this.connId,
          err: String(err),
        });
      });
  }

  evaluateBargeIn(input: BargeInEvaluationInput): BargeInEvaluation {
    const primaryResult = this.primary.evaluateBargeIn(input);

    try {
      const t0 = process.hrtime.bigint();
      const shadowResult = this.shadow.evaluateBargeIn(input);
      const latencyUs = Number(process.hrtime.bigint() - t0) / 1_000;

      const diverged = primaryResult.decision !== shadowResult.decision;

      logger.info("[TurnDetectorShadow] barge_in_comparison", {
        connId: this.connId,
        diverged,
        legacy: { decision: primaryResult.decision },
        shadow: { id: this.shadow.id, decision: shadowResult.decision },
        speechDurationMs: Math.round(input.speechDurationMs),
        minSpeechMs: input.minSpeechMs,
        hasPartial: input.hasPartial ?? false,
        partialLen: (input.partialText ?? "").trim().length,
        assistantActive: input.assistantActive,
        hasReliableEvidence: input.hasReliableEvidence,
        latencyUs: Math.round(latencyUs),
      });
    } catch (err) {
      logger.warn("[TurnDetectorShadow] shadow evaluateBargeIn threw", {
        connId: this.connId,
        err: String(err),
      });
    }

    this.compareAsyncBargeIn(input, primaryResult);
    return primaryResult;
  }

  /** Fire-and-forget real-provider barge-in comparison (PR5b). */
  private compareAsyncBargeIn(
    input: BargeInEvaluationInput,
    primaryResult: BargeInEvaluation,
  ): void {
    const real = this.asyncShadow;
    if (!real) return;
    void real
      .evaluateBargeInAsync(input)
      .then((realResult) => {
        if (!realResult) return; // unavailable → keep legacy, log nothing
        const diverged = primaryResult.decision !== realResult.decision;
        logger.info("[TurnDetectorReal] barge_in_comparison", {
          connId: this.connId,
          provider: realResult.source,
          diverged,
          legacy: { decision: primaryResult.decision },
          real: { decision: realResult.decision },
          speechDurationMs: Math.round(input.speechDurationMs),
          minSpeechMs: input.minSpeechMs,
          hasPartial: input.hasPartial ?? false,
          partialLen: (input.partialText ?? "").trim().length,
          assistantActive: input.assistantActive,
          hasReliableEvidence: input.hasReliableEvidence,
          latencyMs: Math.round(realResult.latencyMs),
        });
      })
      .catch((err) => {
        logger.debug("[TurnDetectorReal] async barge-in compare failed", {
          connId: this.connId,
          err: String(err),
        });
      });
  }

}

/** Returns true if `other` ended the turn earlier than `legacy` (higher state). */
function cutEarlier(
  legacyState: TurnTakingDecision["state"],
  otherState: TurnTakingDecision["state"],
): boolean {
  const rank = { HOLD: 0, LIKELY_END: 1, CONFIRMED_END: 2 };
  return (rank[otherState] ?? 0) > (rank[legacyState] ?? 0);
}

/** Alias kept for the inline sync-shadow comparison. */
const shadowCutEarlier = cutEarlier;
