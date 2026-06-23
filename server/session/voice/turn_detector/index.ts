/**
 * Turn detector resolver — Phase 1.
 *
 * Returns the active TurnDetectorProvider. This round only `legacy` exists; any
 * other value (env `REMI_TURN_DETECTOR`) falls back to legacy with a one-time
 * warning. Future providers (livekit_v1mini / pipecat_smartturn) plug in here
 * and MUST keep legacy as the fallback when their runtime is unavailable.
 */
import { createLogger } from "../../../../infra/logger";
import { LegacyVadTurnDetector } from "./legacy_vad_turn_detector";
import type { TurnDetectorId, TurnDetectorProvider } from "./types";

const logger = createLogger("turn_detector");

let cached: TurnDetectorProvider | null = null;
let warnedUnsupported = false;

function requestedId(): string {
  return (process.env.REMI_TURN_DETECTOR ?? "legacy").trim().toLowerCase();
}

export function resolveTurnDetector(): TurnDetectorProvider {
  if (cached) return cached;
  const requested = requestedId();
  if (requested && requested !== "legacy" && !warnedUnsupported) {
    warnedUnsupported = true;
    logger.warn(
      "non-legacy turn detector requested but not available in phase 1; using legacy",
      { requested },
    );
  }
  cached = new LegacyVadTurnDetector();
  return cached;
}

/** Test-only: drop the cached provider so env changes take effect. */
export function __resetTurnDetectorForTest(): void {
  cached = null;
  warnedUnsupported = false;
}

export type { TurnDetectorProvider, TurnDetectorId };
export { LegacyVadTurnDetector };
