const assert = require("assert").strict;
const { loadSessionHarness, waitFor } = require("../../helpers/session_harness");
const { makeRaudFrame, makeSineFrame, repeatFrames } = require("../../helpers/pcm");

function emit(ws, obj) {
  ws.emitMessage(JSON.stringify(obj));
}

function emitFrames(ws, frames, sampleRate = 16_000) {
  for (const f of frames) {
    ws.emitMessage(makeRaudFrame(f, sampleRate));
  }
}

describe("barge-in baseline (phase 1)", () => {
  // Q1 of the audit: during TTS playback, do mic frames still reach the server
  // and get processed by VAD?
  it("播放中麦克风帧仍进入服务端并被 VAD 处理（shadow 可观测）", async () => {
    const captureLogs = [];
    const { ws, session, restore } = loadSessionHarness({
      transcript: "等一下我说个事",
      captureLogs,
    });
    try {
      emit(ws, { type: "duplex_start", sampleRate: 16_000 });
      // Assistant is mid-playback.
      emit(ws, { type: "playback_start", generationId: 1 });
      await waitFor(() => session.assistantPlaybackActive === true, 500);

      // User speaks WHILE playback is active.
      emitFrames(ws, repeatFrames(makeSineFrame(0.2), 20));
      await waitFor(
        () => session.speechRuntime.getEvents().some((e) => e.type === "vad.speech_start"),
        1000,
      );

      const snap = session.speechRuntime.snapshot();
      assert.ok(snap.duplexActive, "duplex 应处于激活");
      assert.ok(
        snap.recentEvents.some((e) => e.type === "vad.speech_start"),
        "播放期间应观测到 vad.speech_start（帧确实进入服务端并被 VAD 处理）",
      );
      // 现有实现在播放期间检测到语音会登记 pending interrupt（不改触发条件，仅验证可观测）
      assert.ok(
        captureLogs.some((l) => l.message.includes("pending duplex interrupt")),
        "播放期间检测到语音应登记 pending duplex interrupt",
      );
    } finally {
      restore();
    }
  });

  // Q2: once barge-in is confirmed, does it actually interrupt/stop, and do we
  // record the baseline latency? This isolates the downstream interrupt+metric
  // wiring by stubbing ONLY the acoustic evidence gate in-test — it does NOT
  // change any production threshold or trigger condition.
  it("barge-in 确认后触发 interrupt/stop 并记录 baseline 延迟", async () => {
    const captureLogs = [];
    const { ws, session, restore } = loadSessionHarness({
      transcript: "x",
      captureLogs,
    });
    try {
      emit(ws, { type: "duplex_start", sampleRate: 16_000 });
      emit(ws, { type: "playback_start", generationId: 7 });
      await waitFor(() => session.assistantPlaybackActive === true, 500);

      // Set up a confirmable barge-in using the real control flow; stub only the
      // evidence gate so the test is deterministic without changing thresholds.
      session.pendingDuplexInterrupt = true;
      session.duplexSampleRate = 16_000;
      session.speechBufferBytes = Math.ceil(16_000 * 2 * 0.3); // ~300ms of speech
      session.hasReliableDuplexInterruptEvidence = () => true;
      const syntheticSpeechMs = 300;
      session.lastSpeechStartAt = Date.now() - syntheticSpeechMs;

      session.maybeConfirmPendingDuplexInterrupt();

      const msgs = ws.parsedMessages().map((m) => m && m.type);
      assert.ok(
        msgs.includes("interrupt"),
        "barge-in 确认应发出 interrupt 消息",
      );
      assert.equal(
        session.assistantPlaybackActive,
        false,
        "barge-in 应停止播放态（assistantPlaybackActive=false）",
      );

      const latency = session.speechRuntime.getLastBargeInLatencyMs();
      assert.equal(typeof latency, "number", "baseline 延迟应为数字");
      assert.ok(
        Number.isFinite(latency) && latency >= 0,
        "baseline 延迟应为有限非负数",
      );
      assert.ok(
        captureLogs.some((l) =>
          l.message.includes("barge_in_speech_start_to_stop"),
        ),
        "应记录 barge_in_speech_start_to_stop 基线日志",
      );

      // Surfaced for the runner: a synthetic (test-clock) baseline number.
      // The real acoustic baseline must be captured via the manual procedure in
      // docs/voice/FULL_DUPLEX_SPEECH_RUNTIME_PLAN.md.
      console.log(`BARGE_IN_BASELINE_SYNTHETIC_MS=${latency}`);
    } finally {
      restore();
    }
  });
});
