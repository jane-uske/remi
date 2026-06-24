/**
 * PR4 集成测试：真实 interim STT / partial transcript
 *
 * 1. streaming partial 事件 → speechRuntime 中有 transcript.partial
 * 2. [IntermSTT] duplex_start 日志含 interimSttActive 字段
 * 3. barge-in 门槛对比：无 partial → 900ms 门限；有 partial → 320ms 门限
 *    baseline: no-partial 下 500ms 不触发，with-partial 下 500ms 可触发
 */
const assert = require("assert").strict;
const {
  loadSessionHarness,
  waitFor,
} = require("../../helpers/session_harness");
const { makeSineFrame, repeatFrames } = require("../../helpers/pcm");

function emit(ws, obj) {
  ws.emitMessage(JSON.stringify(obj));
}

describe("PR4 — interim STT integration", () => {
  // -----------------------------------------------------------------------
  // Test 1: streaming_partial → speechRuntime.getEvents() has transcript.partial
  // -----------------------------------------------------------------------
  it("streaming partial → speechRuntime 收到 transcript.partial 事件", async () => {
    const { ws, session, restore } = loadSessionHarness();
    try {
      emit(ws, { type: "duplex_start", sampleRate: 16_000 });

      // Simulate active voice state (mirrors realtime_stt_partial.test.ts)
      session.lastVadStartMode = "strict";
      session.duplexSampleRate = 16_000;
      session.speechBuffer = [Buffer.concat(repeatFrames(makeSineFrame(0.18), 18))];
      session.speechBufferBytes = session.speechBuffer[0].length;
      session.utteranceFrameCount = 18;
      session.utteranceStrongFrames = 16;
      session.utteranceMaxRms = 0.18;

      session.stt.emit("streaming_partial", {
        content: "你好Remi",
        itemId: "item_pr4",
        provider: "openai-realtime",
        sequence: 1,
        stability: "interim",
      });

      await waitFor(
        () =>
          session.speechRuntime
            .getEvents()
            .some((e) => e.type === "transcript.partial"),
        500,
      );

      const events = session.speechRuntime.getEvents();
      const ev = events.find((e) => e.type === "transcript.partial");
      assert.ok(ev, `speechRuntime events: ${JSON.stringify(events.map((e) => e.type))}`);
      assert.equal(ev.data?.text, "你好Remi");
      assert.equal(ev.data?.source, "openai-realtime");
    } finally {
      restore();
    }
  });

  // -----------------------------------------------------------------------
  // Test 2: [IntermSTT] duplex_start log contains interimSttActive boolean
  // -----------------------------------------------------------------------
  it("[IntermSTT] duplex_start 日志含 interimSttActive 字段", async () => {
    const captureLogs: Array<{
      module: string;
      level: string;
      message: string;
      data?: Record<string, unknown>;
    }> = [];
    const { ws, session, restore } = loadSessionHarness({ captureLogs });
    try {
      // Default: no sherpa models → canStreamPartials() = false
      emit(ws, { type: "duplex_start", sampleRate: 16_000 });

      // The log is synchronous in handleDuplexStart, so no waitFor needed
      const log = captureLogs.find((l) =>
        l.message.includes("[IntermSTT] duplex_start"),
      );
      assert.ok(log, `captureLogs: ${captureLogs.map((l) => l.message).join(", ")}`);
      assert.equal(typeof log.data?.interimSttActive, "boolean",
        `data: ${JSON.stringify(log.data)}`);
      // In test environment without sherpa, canStreamPartials() returns false
      assert.equal(log.data?.interimSttActive, false);
      console.log(`INTERIM_STT_ACTIVE_DEFAULT=${log.data?.interimSttActive}`);
    } finally {
      restore();
    }
  });

  // -----------------------------------------------------------------------
  // Test 3: barge-in 门槛差异
  //
  //   无 partial (lastPreviewText = ""):
  //     minSpeechMs = DUPLEX_ASSISTANT_NO_PREVIEW_INTERRUPT_MIN_SPEECH_MS = 900ms
  //     → hasReliableDuplexInterruptEvidence(500) = false
  //
  //   有 partial (lastPreviewText = "你好Remi"):
  //     minSpeechMs = DUPLEX_FALLBACK_INTERRUPT_MIN_SPEECH_MS = 320ms
  //     → hasReliableDuplexInterruptEvidence(500) = true (acoustics OK)
  //
  //   目的：记录 baseline 门槛数值，供后续 PR 对比使用。
  // -----------------------------------------------------------------------
  it("无 partial 500ms 不触发 barge-in；有 partial 500ms 触发（门槛 900ms→320ms）", async () => {
    const { ws, session, restore } = loadSessionHarness();
    try {
      emit(ws, { type: "duplex_start", sampleRate: 16_000 });
      emit(ws, { type: "playback_start", generationId: 42 });
      await waitFor(() => session.assistantPlaybackActive === true, 500);

      // 设置足够的声学特征（高 RMS + 高强帧比例）
      session.utteranceFrameCount = 20;
      session.utteranceStrongFrames = 18;  // strongRatio = 0.9
      session.utteranceMaxRms = 0.1;       // > 0.045 (duplexFallbackInterruptMinRms)
      session.duplexSampleRate = 16_000;

      // ---- 无 partial ----
      session.lastPreviewText = "";
      session.lastMeaningfulPartialText = "";
      const resultNoPartial = session.hasReliableDuplexInterruptEvidence(500);
      assert.equal(
        resultNoPartial,
        false,
        "无 partial 时 500ms 应受 900ms 门槛阻断",
      );

      // ---- 有 partial（meaningful Chinese text >= 3 chars） ----
      session.lastPreviewText = "你好Remi";
      session.lastMeaningfulPartialText = "";
      const resultWithPartial = session.hasReliableDuplexInterruptEvidence(500);
      assert.equal(
        resultWithPartial,
        true,
        "有 partial 时 500ms 应通过 320ms 门槛（声学指标充分）",
      );

      // Baseline report
      console.log("BARGE_IN_GATE_NO_PARTIAL_MIN_MS=900");
      console.log("BARGE_IN_GATE_WITH_PARTIAL_MIN_MS=320");
      console.log(`BARGE_IN_NO_PARTIAL_500ms=${resultNoPartial}`);
      console.log(`BARGE_IN_WITH_PARTIAL_500ms=${resultWithPartial}`);
    } finally {
      restore();
    }
  });

  // -----------------------------------------------------------------------
  // Test 4: maybeConfirmPendingDuplexInterrupt 在 320ms 有 partial 时触发 interrupt
  //         验证端到端控制流（不改任何生产条件，仅注入声学证据 + partial text）
  // -----------------------------------------------------------------------
  it("有 partial + 320ms speech → maybeConfirmPendingDuplexInterrupt 触发 interrupt", async () => {
    const captureLogs: Array<{
      module: string;
      level: string;
      message: string;
      data?: Record<string, unknown>;
    }> = [];
    const { ws, session, restore } = loadSessionHarness({ captureLogs });
    try {
      emit(ws, { type: "duplex_start", sampleRate: 16_000 });
      emit(ws, { type: "playback_start", generationId: 99 });
      await waitFor(() => session.assistantPlaybackActive === true, 500);

      session.pendingDuplexInterrupt = true;
      session.duplexSampleRate = 16_000;

      // 320ms 的 PCM 字节数 (16kHz × 2 bytes × 0.32s)
      const speechMs = 325;
      session.speechBufferBytes = Math.ceil(16_000 * 2 * (speechMs / 1000));

      // 提供 partial text + 好的声学状态
      session.lastPreviewText = "你好Remi";
      session.lastMeaningfulPartialText = "";
      session.utteranceFrameCount = 20;
      session.utteranceStrongFrames = 18;
      session.utteranceMaxRms = 0.1;
      session.lastSpeechStartAt = Date.now() - speechMs;

      session.maybeConfirmPendingDuplexInterrupt();

      const msgs = ws.parsedMessages().map((m) => m?.type);
      assert.ok(
        msgs.includes("interrupt"),
        `应发出 interrupt 消息；实际: ${JSON.stringify(msgs)}`,
      );
      assert.equal(session.assistantPlaybackActive, false, "interrupt 后播放态应清除");

      const latency = session.speechRuntime.getLastBargeInLatencyMs();
      assert.ok(typeof latency === "number" && Number.isFinite(latency) && latency >= 0,
        "应记录 barge-in 延迟");
      console.log(`BARGE_IN_WITH_PARTIAL_320ms_LATENCY_MS=${latency}`);
    } finally {
      restore();
    }
  });
});
