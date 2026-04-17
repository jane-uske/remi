const assert = require("assert").strict;

const {
  loadSoakSessionHarness,
  emitDuplexStart,
  emitDuplexStop,
  emitFrames,
  waitFor,
} = require("./soak_session_harness");
const {
  makeBroadbandNoiseFrame,
  makeSineFrame,
  repeatFrames,
} = require("./pcm");

describe("soak session harness", () => {
  it("auto-emits playback_start and captures a complete latency trace", async () => {
    const harness = loadSoakSessionHarness({
      transcript: "你好，我在这里。",
    });

    try {
      const frames = [
        ...repeatFrames(makeSineFrame(0.18), 14),
        ...repeatFrames(makeBroadbandNoiseFrame(0.05, 320, 11), 2),
        ...repeatFrames(makeSineFrame(0.18), 4),
      ];

      emitDuplexStart(harness.ws);
      emitFrames(harness.ws, frames);
      emitDuplexStop(harness.ws);

      await waitFor(
        () =>
          harness.latencyLogs.some(
            (log) => log.metrics.tts_first_to_playback !== null,
          ),
        1500,
      );

      const playbackStart = harness.ws
        .parsedMessages()
        .find((msg) => msg?.type === "turn_state" && msg.state === "assistant_speaking");
      const trace = harness.latencyLogs.find(
        (log) => log.metrics.tts_first_to_playback !== null,
      );

      assert.ok(playbackStart, `messages=${JSON.stringify(harness.ws.parsedMessages())}`);
      assert.ok(trace, `latencyLogs=${JSON.stringify(harness.latencyLogs)}`);
      assert.equal(typeof trace.metrics.speech_end_to_stt_final, "number");
      assert.equal(typeof trace.metrics.stt_final_to_llm_first, "number");
      assert.equal(typeof trace.metrics.llm_first_to_tts_first, "number");
      assert.equal(typeof trace.metrics.tts_first_to_playback, "number");
      assert.equal(typeof trace.traceId, "string");
      assert.equal(Array.isArray(trace.turnStateTransitions), true);
      assert.equal(trace.finalTranscript, "你好，我在这里。");
    } finally {
      harness.restore();
    }
  });
});
