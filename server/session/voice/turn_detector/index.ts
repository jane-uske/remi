/**
 * Turn detector resolver — PR1 + PR5 + PR5b.
 *
 * Returns the active TurnDetectorProvider:
 *   - Default: LegacyVadTurnDetector (cached singleton, stateless).
 *   - Shadow mode (REMI_TURN_DETECTOR_SHADOW=1): ShadowTurnDetector wrapping
 *     legacy (primary) + a sync stub shadow, and OPTIONALLY a real async
 *     provider (PR5b) when REMI_TURN_DETECTOR_ENDPOINT is set and the chosen
 *     shadow provider is a real one. Primary always wins; shadows only log.
 *
 * The primary (legacy) instance IS cached. Shadow wrapper is NOT cached
 * (one per session) to carry the per-connection id.
 */
import { getConfig } from "../../../../server/config";
import { createLogger } from "../../../../infra/logger";
import { LegacyVadTurnDetector } from "./legacy_vad_turn_detector";
import { SmartTurnStub } from "./smartturn_stub";
import { ShadowTurnDetector } from "./shadow_turn_detector";
import { LiveKitTurnDetectorAdapter } from "./livekit_turn_detector_adapter";
import type {
  AsyncTurnDetectorProvider,
  TurnDetectorId,
  TurnDetectorProvider,
} from "./types";

const logger = createLogger("turn_detector");

/** Shared legacy primary — stateless, safe to cache across sessions. */
let cachedLegacy: LegacyVadTurnDetector | null = null;
let warnedUnsupported = false;

function requestedId(): string {
  return (process.env.REMI_TURN_DETECTOR ?? "legacy").trim().toLowerCase();
}

/**
 * Effective mode (PR5d). Explicit REMI_TURN_DETECTOR_MODE wins; otherwise it is
 * derived from the legacy REMI_TURN_DETECTOR_SHADOW boolean for back-compat.
 */
function effectiveMode(): "off" | "shadow" | "limited_on" {
  const explicit = getConfig().REMI_TURN_DETECTOR_MODE;
  if (explicit) return explicit;
  return getConfig().REMI_TURN_DETECTOR_SHADOW === true ? "shadow" : "off";
}

function getLegacy(): LegacyVadTurnDetector {
  if (!cachedLegacy) cachedLegacy = new LegacyVadTurnDetector();
  return cachedLegacy;
}

/**
 * Returns the turn detector provider for the given session (connId).
 * - off:        the cached legacy singleton (no behavior change).
 * - shadow:     ShadowTurnDetector, log-only comparison.
 * - limited_on: ShadowTurnDetector that may adjust turn-END via the real EOU,
 *   asymmetrically and safely. Requires a real endpoint; without one it has no
 *   EOU source and stays fully legacy.
 */
export function resolveTurnDetector(connId?: string): TurnDetectorProvider {
  const requested = requestedId();
  if (requested && requested !== "legacy" && !warnedUnsupported) {
    warnedUnsupported = true;
    logger.warn(
      "non-legacy turn detector requested but not available; using legacy (shadow/limited_on via REMI_TURN_DETECTOR_MODE)",
      { requested },
    );
  }

  const mode = effectiveMode();
  if (mode === "off") {
    return getLegacy();
  }

  // shadow / limited_on: new wrapper per session, carries connId for logging.
  // Sync stub always present (cheap, deterministic). Real async provider only
  // when an endpoint is configured AND a real provider is selected.
  const stub = new SmartTurnStub();
  const asyncShadow = buildAsyncShadow();
  if (mode === "limited_on" && !asyncShadow) {
    logger.warn(
      "[TurnDetector] limited_on requested but no real provider/endpoint; staying fully legacy",
      { connId },
    );
  }
  logger.info("[TurnDetector] active", {
    connId,
    mode,
    syncShadowId: stub.id,
    realShadowId: asyncShadow?.id ?? null,
    realEndpoint: getConfig().REMI_TURN_DETECTOR_ENDPOINT ?? null,
  });
  return new ShadowTurnDetector(
    getLegacy(),
    stub,
    connId,
    asyncShadow,
    mode === "limited_on" ? "limited_on" : "shadow",
  );
}

/**
 * Build the real async shadow provider if configured. Returns undefined when:
 *   - the selected shadow provider is the stub, or
 *   - no endpoint is configured.
 * A built adapter still self-degrades to "unavailable" (→ legacy) if the
 * sidecar can't be reached; this only decides whether to *attempt* it.
 */
function buildAsyncShadow(): AsyncTurnDetectorProvider | undefined {
  const provider = getConfig().REMI_TURN_DETECTOR_SHADOW_PROVIDER;
  const endpoint = getConfig().REMI_TURN_DETECTOR_ENDPOINT;
  if (provider === "stub" || !endpoint) return undefined;
  const id: TurnDetectorId =
    provider === "pipecat_smartturn" ? "pipecat_smartturn" : "livekit_v1mini";
  return new LiveKitTurnDetectorAdapter(endpoint.replace(/\/+$/, ""), id);
}

/** Test-only: drop the cached legacy provider so env changes take effect. */
export function __resetTurnDetectorForTest(): void {
  cachedLegacy = null;
  warnedUnsupported = false;
}

export type { TurnDetectorProvider, TurnDetectorId };
export { applyLimitedOnAdjustment } from "./limited_on";
export type { LimitedOnConfig, LimitedOnAction, LimitedOnResult } from "./limited_on";
export {
  LegacyVadTurnDetector,
  SmartTurnStub,
  ShadowTurnDetector,
  LiveKitTurnDetectorAdapter,
};
