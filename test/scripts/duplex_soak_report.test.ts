const assert = require("assert").strict;

const {
  buildSoakReport,
  renderMarkdownReport,
} = require("../../scripts/duplex_soak_report");

describe("duplex soak report", () => {
  it("builds a stable report shape and markdown sections from fixed input", () => {
    const report = buildSoakReport({
      config: {
        behaviorLoops: 10,
        latencyLoops: 10,
        seed: 42,
        outputDir: "/tmp/soak",
        generatedAt: "2026-04-09T12:00:00.000Z",
        dataSource: "synthetic_harness",
      },
      behaviorScenarios: [
        {
          name: "humanSpeech",
          loops: 10,
          passCount: 10,
          failureCount: 0,
          anomalies: {
            unexpected_interrupt_count: 0,
            noise_promoted_to_assistant_count: 0,
            missing_stt_final_count: 0,
            duplicate_stt_final_count: 0,
            duplicate_assistant_entering_count: 0,
            missing_chat_end_count: 0,
            stuck_turn_state_count: 0,
          },
          messageTypeHistogram: { stt_final: 10, chat_end: 10 },
          turnStateHistogram: { assistant_entering: 10, assistant_speaking: 10 },
        },
      ],
      latencyScenarios: [
        {
          name: "voice_roundtrip_baseline",
          loops: 10,
          traceCount: 10,
          requiredTraceCount: 50,
          meetsMinimumTraceCount: false,
          incompleteReasons: ["trace_count 10 < required 50"],
          metricSummaries: {
            speech_end_to_stt_final: { count: 10, min: 40, p50: 50, p95: 60, max: 60 },
            stt_final_to_llm_first: { count: 10, min: 10, p50: 15, p95: 20, max: 20 },
            llm_first_to_tts_first: { count: 10, min: 5, p50: 10, p95: 12, max: 12 },
            tts_first_to_playback: { count: 10, min: 1, p50: 2, p95: 3, max: 3 },
          },
        },
        {
          name: "interrupt_then_new_turn",
          loops: 10,
          traceCount: 10,
          requiredTraceCount: 30,
          meetsMinimumTraceCount: false,
          incompleteReasons: ["trace_count 10 < required 30"],
          metricSummaries: {
            speech_end_to_stt_final: { count: 10, min: 45, p50: 52, p95: 58, max: 61 },
            stt_final_to_llm_first: { count: 10, min: 12, p50: 18, p95: 22, max: 24 },
            llm_first_to_tts_first: { count: 10, min: 6, p50: 10, p95: 13, max: 14 },
            tts_first_to_playback: { count: 10, min: 1, p50: 2, p95: 4, max: 5 },
          },
        },
      ],
      sampleRows: [
        {
          sampleId: "interrupt_then_new_turn#0:false_early_release",
          kind: "bad",
          category: "false_early_release",
          scenario: "interrupt_then_new_turn",
          expected: "interrupt should hand off to a complete new turn",
          actual: "preview expanded from 8 to 16 chars after release",
          previewSummary: "我先说一个重点，",
          finalSummary: "我先说一个重点，然后再补完整。",
          releaseSummary: "release=semantic_release, stable=420ms",
          userImpact: "assistant can cut in before the user finishes the clause",
        },
      ],
      failures: [],
    });

    assert.equal(report.runConfig.seed, 42);
    assert.equal(report.behaviorSummary.totals.missing_stt_final_count, 0);
    assert.equal(report.latencySummary.scenarios.length, 2);
    assert.equal(Array.isArray(report.latencySummary.warnings), true);
    assert.equal(report.latencySummary.readiness, "incomplete");
    assert.equal(report.misclassificationSummary.totalBadSamples, 1);
    assert.equal(report.recommendedAction.status, "incomplete");

    const markdown = renderMarkdownReport(report);
    assert.ok(markdown.includes("# 1. Run Config"));
    assert.ok(markdown.includes("# 2. Behavior Summary"));
    assert.ok(markdown.includes("# 3. Latency Summary"));
    assert.ok(markdown.includes("# 4. Misclassification Review"));
    assert.ok(markdown.includes("# 5. Failures / Anomalies"));
    assert.ok(markdown.includes("# 6. Recommended Action"));
    assert.ok(markdown.includes("voice_roundtrip_baseline"));
    assert.ok(markdown.includes("interrupt_then_new_turn"));
  });
});
