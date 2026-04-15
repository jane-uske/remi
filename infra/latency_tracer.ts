import { createLogger } from "./logger";

const logger = createLogger("latency");

export interface LatencyTimestamps {
  input_received?: number;
  vad_speech_start?: number;
  vad_speech_end?: number;
  stt_partial?: number;
  stt_final?: number;
  memory_recall_start?: number;
  memory_recall_end?: number;
  turn_analysis_start?: number;
  turn_analysis_end?: number;
  llm_request_start?: number;
  llm_first_token?: number;
  llm_end?: number;
  tts_start?: number;
  tts_first_audio?: number;
  tts_end?: number;
  playback_start?: number;
}

export interface LatencyMetrics {
  input_to_llm_request?: number;
  input_to_llm_first_token?: number;
  pre_llm_overhead?: number;
  memory_recall_ms?: number;
  structured_turn_analysis_ms?: number;
  stt_latency?: number;
  llm_first_token?: number;
  tts_latency?: number;
  total_response?: number;
  speech_end_to_stt_final?: number;
  stt_final_to_llm_first?: number;
  llm_first_to_tts_first?: number;
  tts_first_to_playback?: number;
}

export interface LatencyMetricSnapshot {
  input_to_llm_request: number | null;
  input_to_llm_first_token: number | null;
  pre_llm_overhead: number | null;
  memory_recall_ms: number | null;
  structured_turn_analysis_ms: number | null;
  stt_latency: number | null;
  llm_first_token: number | null;
  tts_latency: number | null;
  total_response: number | null;
  speech_end_to_stt_final: number | null;
  stt_final_to_llm_first: number | null;
  llm_first_to_tts_first: number | null;
  tts_first_to_playback: number | null;
}

export interface LatencyTraceContext {
  generationId?: number;
  source?: "voice" | "text" | "silence_nudge";
}

type TraceState = {
  timestamps: LatencyTimestamps;
  completed: boolean;
  context?: LatencyTraceContext;
};

/**
 * Latency Tracer for tracking pipeline stage timestamps and computing durations.
 *
 * Tracks these timestamps:
 * - vad_speech_start
 * - vad_speech_end
 * - stt_partial
 * - stt_final
 * - llm_request_start
 * - llm_first_token
 * - llm_end
 * - tts_start
 * - tts_first_audio
 * - tts_end
 * - playback_start
 *
 * Computes these durations:
 * - speech_end → stt_final
 * - stt_final → llm_first_token
 * - llm_first_token → tts_first_audio
 * - tts_first_audio → playback
 */
export class LatencyTracer {
  private traces = new Map<string, TraceState>();
  private readonly defaultTraceId = "legacy";
  private connId: string;

  constructor(connId: string) {
    this.connId = connId;
  }

  private ensureTrace(traceId: string): TraceState {
    let trace = this.traces.get(traceId);
    if (!trace) {
      trace = {
        timestamps: {},
        completed: false,
      };
      this.traces.set(traceId, trace);
    }
    return trace;
  }

  startTrace(traceId: string, context?: LatencyTraceContext): void {
    if (!traceId) return;
    const trace = this.ensureTrace(traceId);
    if (trace.completed) {
      trace.timestamps = {};
      trace.completed = false;
    }
    if (context) {
      trace.context = {
        ...(trace.context ?? {}),
        ...context,
      };
    }
  }

  /** Mark a timestamp with the current time. */
  mark(key: keyof LatencyTimestamps, traceId: string = this.defaultTraceId): void {
    const trace = this.ensureTrace(traceId);
    if (trace.completed) return;
    trace.timestamps[key] = Date.now();
  }

  /** Set a timestamp with a specific value (for external events). */
  set(key: keyof LatencyTimestamps, value: number, traceId: string = this.defaultTraceId): void {
    const trace = this.ensureTrace(traceId);
    if (trace.completed) return;
    trace.timestamps[key] = value;
  }

  /** Get a specific timestamp. */
  get(key: keyof LatencyTimestamps, traceId: string = this.defaultTraceId): number | undefined {
    return this.traces.get(traceId)?.timestamps[key];
  }

  /** Get all timestamps. */
  getAllTimestamps(traceId: string = this.defaultTraceId): LatencyTimestamps {
    return { ...(this.traces.get(traceId)?.timestamps ?? {}) };
  }

  /**
   * Compute duration between two timestamps in milliseconds.
   * Returns undefined if either timestamp is missing.
   */
  private duration(
    startKey: keyof LatencyTimestamps,
    endKey: keyof LatencyTimestamps,
    timestamps: LatencyTimestamps,
  ): number | undefined {
    const start = timestamps[startKey];
    const end = timestamps[endKey];
    if (start === undefined || end === undefined) return undefined;
    if (end < start) return undefined;
    return end - start;
  }

  private firstDefinedTimestamp(
    keys: Array<keyof LatencyTimestamps>,
    timestamps: LatencyTimestamps,
  ): number | undefined {
    for (const key of keys) {
      const value = timestamps[key];
      if (value !== undefined) return value;
    }
    return undefined;
  }

  findActiveTraceIdByGenerationId(generationId: number): string | null {
    let candidate: string | null = null;
    for (const [traceId, trace] of this.traces) {
      if (trace.completed) continue;
      if (trace.context?.generationId !== generationId) continue;
      candidate = traceId;
    }
    return candidate;
  }

  /** Compute all latency metrics from the current timestamps. */
  computeMetrics(traceId: string = this.defaultTraceId): LatencyMetrics {
    const timestamps = this.traces.get(traceId)?.timestamps ?? {};
    const preLlmBaseline = this.firstDefinedTimestamp(
      ["stt_final", "input_received", "vad_speech_end"],
      timestamps,
    );
    const llmRequestStart = timestamps.llm_request_start;
    const preLlmOverhead =
      preLlmBaseline !== undefined &&
      llmRequestStart !== undefined &&
      llmRequestStart >= preLlmBaseline
        ? llmRequestStart - preLlmBaseline
        : undefined;

    return {
      input_to_llm_request: this.duration("input_received", "llm_request_start", timestamps),
      input_to_llm_first_token: this.duration("input_received", "llm_first_token", timestamps),
      pre_llm_overhead: preLlmOverhead,
      memory_recall_ms: this.duration("memory_recall_start", "memory_recall_end", timestamps),
      structured_turn_analysis_ms: this.duration(
        "turn_analysis_start",
        "turn_analysis_end",
        timestamps,
      ),
      // Legacy metrics for backward compatibility
      stt_latency: this.duration("vad_speech_end", "stt_final", timestamps),
      llm_first_token: this.duration("stt_final", "llm_first_token", timestamps),
      tts_latency: this.duration("llm_first_token", "tts_first_audio", timestamps),
      total_response: this.duration("vad_speech_end", "tts_first_audio", timestamps),

      // Detailed metrics
      speech_end_to_stt_final: this.duration("vad_speech_end", "stt_final", timestamps),
      stt_final_to_llm_first: this.duration("stt_final", "llm_first_token", timestamps),
      llm_first_to_tts_first: this.duration("llm_first_token", "tts_first_audio", timestamps),
      tts_first_to_playback: this.duration("tts_first_audio", "playback_start", timestamps),
    };
  }

  /**
   * Normalize a metrics object into a stable, regression-friendly snapshot.
   * Missing values are preserved explicitly as `null` so the log shape stays fixed.
   */
  static normalizeMetrics(metrics: LatencyMetrics): LatencyMetricSnapshot {
    return {
      input_to_llm_request: metrics.input_to_llm_request ?? null,
      input_to_llm_first_token: metrics.input_to_llm_first_token ?? null,
      pre_llm_overhead: metrics.pre_llm_overhead ?? null,
      memory_recall_ms: metrics.memory_recall_ms ?? null,
      structured_turn_analysis_ms: metrics.structured_turn_analysis_ms ?? null,
      stt_latency: metrics.stt_latency ?? null,
      llm_first_token: metrics.llm_first_token ?? null,
      tts_latency: metrics.tts_latency ?? null,
      total_response: metrics.total_response ?? null,
      speech_end_to_stt_final: metrics.speech_end_to_stt_final ?? null,
      stt_final_to_llm_first: metrics.stt_final_to_llm_first ?? null,
      llm_first_to_tts_first: metrics.llm_first_to_tts_first ?? null,
      tts_first_to_playback: metrics.tts_first_to_playback ?? null,
    };
  }

  /**
   * Log the latency metrics as structured JSON.
   * Call this after all stages are complete.
   */
  log(traceId: string = this.defaultTraceId): void {
    const trace = this.traces.get(traceId);
    if (!trace || trace.completed) return;
    trace.completed = true;

    const metrics = this.computeMetrics(traceId);
    const hasAnyMetric = Object.values(metrics).some((v) => v !== undefined);

    if (!hasAnyMetric) {
      logger.debug("[Latency] No metrics available", { connId: this.connId, traceId });
      return;
    }

    const metricSnapshot = LatencyTracer.normalizeMetrics(metrics);

    logger.info("[Latency]", {
      connId: this.connId,
      traceId,
      generationId: trace.context?.generationId,
      source: trace.context?.source,
      metrics: metricSnapshot,
      timestamps: trace.timestamps,
    });
  }

  /** Reset the tracer for reuse. */
  reset(traceId?: string): void {
    if (traceId) {
      this.traces.delete(traceId);
      return;
    }
    this.traces.clear();
  }
}

/**
 * Global store for active latency tracers by connection ID.
 */
const activeTracers = new Map<string, LatencyTracer>();

/** Get or create a latency tracer for a connection. */
export function getLatencyTracer(connId: string): LatencyTracer {
  let tracer = activeTracers.get(connId);
  if (!tracer) {
    tracer = new LatencyTracer(connId);
    activeTracers.set(connId, tracer);
  }
  return tracer;
}

/** Remove a latency tracer when a connection closes. */
export function removeLatencyTracer(connId: string): void {
  activeTracers.delete(connId);
}

/** Mark a timestamp on the tracer for a connection. */
export function markLatency(connId: string, key: keyof LatencyTimestamps): void {
  getLatencyTracer(connId).mark(key);
}

/** Log latency metrics for a connection. */
export function logLatency(connId: string): void {
  getLatencyTracer(connId).log();
}
