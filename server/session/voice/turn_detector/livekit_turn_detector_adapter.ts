/**
 * LiveKitTurnDetectorAdapter — PR5b real (async) shadow provider.
 *
 * Talks over HTTP to a local turn-detector sidecar (e.g. a Python service
 * serving the LiveKit turn-detector v2 multilingual model, or a Pipecat
 * SmartTurn model). The sidecar contract:
 *
 *   GET  {endpoint}/health        → 200 {"ok":true,"model":"..."}
 *   POST {endpoint}/turn-end      → 200 {"eou_probability":0.0-1.0}
 *        body: {"text": "<partial transcript>", "language":"zh"}
 *   POST {endpoint}/barge-in      → 200 {"is_barge_in":bool,"confidence":0.0-1.0}
 *        body: {"text","speech_ms","has_partial"}
 *
 * Hard constraints (PR5b):
 *   - Pure shadow. Never feeds the live turn-taking or barge-in trigger.
 *   - Provider unavailable / slow / erroring → resolves null (never throws),
 *     so the caller keeps the legacy decision. This is the fallback.
 *   - Runs OFF the synchronous fast path (callers fire-and-forget).
 *   - No VAD / barge-in / TTS / STT thresholds touched.
 */
import { getConfig } from "../../../../server/config";
import { createLogger } from "../../../../infra/logger";
import type {
  TurnTakingDecisionInput,
  TurnTakingState,
} from "../../turn_taking";
import type {
  AsyncBargeInResult,
  AsyncTurnDetectorProvider,
  AsyncTurnEndResult,
  BargeInEvaluationInput,
  TurnDetectorId,
} from "./types";

const logger = createLogger("turn_detector_real");

/** Availability probe cache TTL — avoid hammering a down sidecar. */
const PROBE_TTL_MS = 10_000;

interface ProbeState {
  available: boolean;
  checkedAt: number;
  model?: string;
}

export class LiveKitTurnDetectorAdapter implements AsyncTurnDetectorProvider {
  readonly id: TurnDetectorId;
  private probe: ProbeState | null = null;
  private inFlightProbe: Promise<boolean> | null = null;

  constructor(
    private readonly endpoint: string,
    id: TurnDetectorId = "livekit_v1mini",
    private readonly nowFn: () => number = () => Date.now(),
  ) {
    this.id = id;
  }

  async isAvailable(): Promise<boolean> {
    const now = this.nowFn();
    if (this.probe && now - this.probe.checkedAt < PROBE_TTL_MS) {
      return this.probe.available;
    }
    if (this.inFlightProbe) return this.inFlightProbe;
    this.inFlightProbe = this.runProbe(now).finally(() => {
      this.inFlightProbe = null;
    });
    return this.inFlightProbe;
  }

  private async runProbe(now: number): Promise<boolean> {
    try {
      const res = await this.fetchJson("/health", undefined, "GET");
      const available = !!res && res.ok !== false;
      this.probe = {
        available,
        checkedAt: now,
        model: typeof res?.model === "string" ? res.model : undefined,
      };
      if (available) {
        logger.info("[TurnDetectorReal] sidecar available", {
          endpoint: this.endpoint,
          model: this.probe.model,
        });
      }
      return available;
    } catch (err) {
      this.probe = { available: false, checkedAt: now };
      logger.debug("[TurnDetectorReal] sidecar unavailable", {
        endpoint: this.endpoint,
        err: String(err),
      });
      return false;
    }
  }

  async evaluateTurnEndAsync(
    input: TurnTakingDecisionInput,
  ): Promise<AsyncTurnEndResult | null> {
    if (!(await this.isAvailable())) return null;
    const text = (input.previewText ?? "").trim();
    const t0 = this.nowFn();
    try {
      const res = await this.fetchJson("/turn-end", {
        text,
        language: "zh",
      });
      const latencyMs = this.nowFn() - t0;
      const prob = clamp01(Number(res?.eou_probability));
      if (!Number.isFinite(prob)) return null;
      return {
        state: probToState(prob),
        endOfTurnProb: prob,
        source: this.id,
        latencyMs,
      };
    } catch (err) {
      logger.debug("[TurnDetectorReal] turn-end call failed", {
        endpoint: this.endpoint,
        err: String(err),
      });
      // Mark unavailable so we stop trying until the TTL re-probes.
      this.probe = { available: false, checkedAt: this.nowFn() };
      return null;
    }
  }

  async evaluateBargeInAsync(
    input: BargeInEvaluationInput,
  ): Promise<AsyncBargeInResult | null> {
    if (!(await this.isAvailable())) return null;
    const t0 = this.nowFn();
    try {
      const res = await this.fetchJson("/barge-in", {
        text: (input.partialText ?? "").trim(),
        speech_ms: Math.round(input.speechDurationMs),
        has_partial: input.hasPartial ?? false,
      });
      const latencyMs = this.nowFn() - t0;
      if (res == null || typeof res.is_barge_in !== "boolean") return null;
      const confidence = clamp01(Number(res.confidence));
      const decision = res.is_barge_in
        ? confidence >= 0.6
          ? "confirmed"
          : "candidate"
        : "none";
      return { decision, source: this.id, latencyMs };
    } catch (err) {
      logger.debug("[TurnDetectorReal] barge-in call failed", {
        endpoint: this.endpoint,
        err: String(err),
      });
      this.probe = { available: false, checkedAt: this.nowFn() };
      return null;
    }
  }

  private async fetchJson(
    path: string,
    body?: Record<string, unknown>,
    method: "GET" | "POST" = "POST",
  ): Promise<any> {
    const timeoutMs = getConfig().REMI_TURN_DETECTOR_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.endpoint}${path}`, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return NaN;
  return Math.max(0, Math.min(1, n));
}

/** Map end-of-turn probability to a turn-taking state via the config threshold. */
function probToState(prob: number): TurnTakingState {
  const threshold = getConfig().REMI_TURN_DETECTOR_EOU_THRESHOLD;
  if (prob >= threshold) return "CONFIRMED_END";
  // A soft band below threshold reads as "likely" (model leaning toward end).
  if (prob >= threshold * 0.7) return "LIKELY_END";
  return "HOLD";
}
