const assert = require("assert").strict;

const { LatencyTracer } = require("../../infra/latency_tracer");

describe("latency tracer", () => {
  it("computes the comparison metrics with a stable snapshot shape", () => {
    const tracer = new LatencyTracer("conn-1");
    const traceId = "trace-1";

    tracer.startTrace(traceId, { generationId: 7, source: "voice" });
    tracer.set("input_received", 120, traceId);
    tracer.set("vad_speech_end", 100, traceId);
    tracer.set("stt_final", 150, traceId);
    tracer.set("memory_recall_start", 160, traceId);
    tracer.set("memory_recall_end", 185, traceId);
    tracer.set("turn_analysis_start", 162, traceId);
    tracer.set("turn_analysis_end", 190, traceId);
    tracer.set("llm_request_start", 195, traceId);
    tracer.set("llm_first_token", 200, traceId);
    tracer.set("tts_first_audio", 250, traceId);
    tracer.set("playback_start", 310, traceId);

    const metrics = tracer.computeMetrics(traceId);
    assert.deepEqual(metrics, {
      input_to_llm_request: 75,
      input_to_llm_first_token: 80,
      pre_llm_overhead: 45,
      memory_recall_ms: 25,
      structured_turn_analysis_ms: 28,
      stt_latency: 50,
      llm_first_token: 50,
      tts_latency: 50,
      total_response: 150,
      speech_end_to_stt_final: 50,
      stt_final_to_llm_first: 50,
      llm_first_to_tts_first: 50,
      tts_first_to_playback: 60,
    });

    const snapshot = LatencyTracer.normalizeMetrics(metrics);
    assert.deepEqual(snapshot, {
      input_to_llm_request: 75,
      input_to_llm_first_token: 80,
      pre_llm_overhead: 45,
      memory_recall_ms: 25,
      structured_turn_analysis_ms: 28,
      stt_latency: 50,
      llm_first_token: 50,
      tts_latency: 50,
      total_response: 150,
      speech_end_to_stt_final: 50,
      stt_final_to_llm_first: 50,
      llm_first_to_tts_first: 50,
      tts_first_to_playback: 60,
    });
  });

  it("keeps missing metrics explicit in the regression snapshot", () => {
    const snapshot = LatencyTracer.normalizeMetrics({});
    assert.deepEqual(snapshot, {
      input_to_llm_request: null,
      input_to_llm_first_token: null,
      pre_llm_overhead: null,
      memory_recall_ms: null,
      structured_turn_analysis_ms: null,
      stt_latency: null,
      llm_first_token: null,
      tts_latency: null,
      total_response: null,
      speech_end_to_stt_final: null,
      stt_final_to_llm_first: null,
      llm_first_to_tts_first: null,
      tts_first_to_playback: null,
    });
  });
});
