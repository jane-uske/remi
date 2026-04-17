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
    tracer.set("llm_first_raw_chunk", 196, traceId);
    tracer.set("llm_first_reasoning_chunk", 197, traceId);
    tracer.set("llm_first_visible_content", 200, traceId);
    tracer.set("llm_stream_first_chunk", 198, traceId);
    tracer.set("llm_first_token", 200, traceId);
    tracer.set("tts_first_audio", 250, traceId);
    tracer.set("playback_start", 310, traceId);

    const metrics = tracer.computeMetrics(traceId);
    assert.deepEqual(metrics, {
      input_to_llm_request: 75,
      input_to_llm_first_token: 80,
      llm_request_to_first_raw_chunk: 1,
      llm_request_to_first_reasoning_chunk: 2,
      llm_request_to_first_visible_content: 5,
      llm_request_to_stream_first_chunk: 3,
      raw_chunk_to_first_reasoning_chunk: 1,
      raw_chunk_to_first_visible_content: 4,
      reasoning_chunk_to_first_visible_content: 3,
      stream_first_chunk_to_llm_first_token: 2,
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
      llm_request_to_first_raw_chunk: 1,
      llm_request_to_first_reasoning_chunk: 2,
      llm_request_to_first_visible_content: 5,
      llm_request_to_stream_first_chunk: 3,
      raw_chunk_to_first_reasoning_chunk: 1,
      raw_chunk_to_first_visible_content: 4,
      reasoning_chunk_to_first_visible_content: 3,
      stream_first_chunk_to_llm_first_token: 2,
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
      llm_request_to_first_raw_chunk: null,
      llm_request_to_first_reasoning_chunk: null,
      llm_request_to_first_visible_content: null,
      llm_request_to_stream_first_chunk: null,
      raw_chunk_to_first_reasoning_chunk: null,
      raw_chunk_to_first_visible_content: null,
      reasoning_chunk_to_first_visible_content: null,
      stream_first_chunk_to_llm_first_token: null,
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

  it("keeps trace context for sample attribution and turn-state transitions", () => {
    const tracer = new LatencyTracer("conn-ctx");
    const traceId = "trace-ctx";

    tracer.startTrace(traceId, {
      generationId: 3,
      source: "voice",
      sessionId: "session-1",
      scenarioKey: "voice_roundtrip_baseline",
      previewText: "我先说一个重点，",
    });
    tracer.annotateTrace(traceId, {
      finalTranscript: "我先说一个重点，然后再补完整。",
      rejectedReason: "noise_phrase_rejected",
      rejectedTranscript: "谢谢观看!",
      rejectedSource: "duplex_stop_suppressed_fallback",
      interruptionType: "correction",
      releaseReason: "semantic_release",
      releaseStableMs: 420,
      prosodyApplied: "prosody_release_falling_tail",
    });
    tracer.recordTurnState(traceId, {
      state: "likely_end",
      reason: "semantic_hold",
      preview: "我先说一个重点，",
      interruptionType: "correction",
      generationId: 3,
      at: 123,
    });

    assert.deepEqual(tracer.getContext(traceId), {
      generationId: 3,
      source: "voice",
      sessionId: "session-1",
      scenarioKey: "voice_roundtrip_baseline",
      previewText: "我先说一个重点，",
      finalTranscript: "我先说一个重点，然后再补完整。",
      rejectedReason: "noise_phrase_rejected",
      rejectedTranscript: "谢谢观看!",
      rejectedSource: "duplex_stop_suppressed_fallback",
      interruptionType: "correction",
      releaseReason: "semantic_release",
      releaseStableMs: 420,
      prosodyApplied: "prosody_release_falling_tail",
      turnStateTransitions: [
        {
          state: "likely_end",
          reason: "semantic_hold",
          at: 123,
          generationId: 3,
          preview: "我先说一个重点，",
          interruptionType: "correction",
        },
      ],
    });
  });
});
