const assert = require("assert").strict;

const { loadSessionHarness } = require("../../helpers/session_harness");
const {
  makeRaudFrame,
  makeSineFrame,
  repeatFrames,
} = require("../../helpers/pcm");

function emitDuplexStart(ws, sampleRate = 16_000) {
  ws.emitMessage(JSON.stringify({ type: "duplex_start", sampleRate }));
}

function emitDuplexStop(ws) {
  ws.emitMessage(JSON.stringify({ type: "duplex_stop" }));
}

function emitFrames(ws, frames, sampleRate = 16_000) {
  for (const frame of frames) {
    ws.emitMessage(makeRaudFrame(frame, sampleRate));
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsedMessages(ws) {
  return ws.parsedMessages().filter((msg) => msg && typeof msg === "object");
}

describe("duplex queue regressions", () => {
  it("does not hold a later STT final behind an earlier blocked pipeline turn", async () => {
    let releasePipeline;
    const pipelineGate = new Promise((resolve) => {
      releasePipeline = resolve;
    });

    const { ws, restore, pipelineCalls } = loadSessionHarness({
      sttEndPcmImpl: async () => "第一句语音",
      runPipelineImpl: async () => {
        await pipelineGate;
      },
    });

    try {
      const speechFrames = repeatFrames(makeSineFrame(0.18), 14);

      emitDuplexStart(ws);
      emitFrames(ws, speechFrames);
      emitDuplexStop(ws);

      await new Promise((resolve) => {
        const startedAt = Date.now();
        const poll = () => {
          if (parsedMessages(ws).some((msg) => msg.type === "stt_final")) {
            resolve(null);
            return;
          }
          if (Date.now() - startedAt > 500) {
            resolve(null);
            return;
          }
          setTimeout(poll, 10);
        };
        poll();
      });

      emitDuplexStart(ws);
      emitFrames(ws, speechFrames);
      emitDuplexStop(ws);

      await sleep(80);

      const sttFinals = parsedMessages(ws).filter((msg) => msg.type === "stt_final");
      assert.ok(
        sttFinals.length >= 2,
        `expected the later STT final to complete before the blocked pipeline turn released, messages=${JSON.stringify(ws.parsedMessages())}`,
      );
      assert.equal(
        pipelineCalls.length,
        1,
        `expected the second pipeline turn to remain queued behind the first one, calls=${JSON.stringify(pipelineCalls)}`,
      );
    } finally {
      releasePipeline();
      await sleep(10);
      restore();
    }
  });

  it("drops a stale utterance that finishes after a newer speech start", async () => {
    let sttCalls = 0;
    const { ws, restore } = loadSessionHarness({
      sttEndPcmImpl: async () => {
        sttCalls += 1;
        if (sttCalls === 1) {
          await sleep(140);
          return "旧的回合";
        }
        return "新的回合";
      },
    });

    try {
      const speechFrames = repeatFrames(makeSineFrame(0.18), 14);

      emitDuplexStart(ws);
      emitFrames(ws, speechFrames);
      emitDuplexStop(ws);

      await sleep(20);
      emitDuplexStart(ws);
      emitFrames(ws, speechFrames);

      await sleep(220);

      const sttFinals = parsedMessages(ws).filter((msg) => msg.type === "stt_final");
      assert.equal(
        sttFinals.length,
        0,
        `expected the stale first utterance to be dropped after the newer speech start, messages=${JSON.stringify(ws.parsedMessages())}`,
      );
    } finally {
      restore();
    }
  });

  it("records normalized ingress context for non-16k duplex audio", async () => {
    const logs = [];
    const sampleRates = [];
    const { ws, session, restore } = loadSessionHarness({
      captureLogs: logs,
    });

    try {
      session.stt.setSampleRate = (rate) => {
        sampleRates.push(rate);
      };
      const frame = makeSineFrame(0.18);

      emitDuplexStart(ws, 48_000);
      emitFrames(ws, [frame], 48_000);
      emitDuplexStop(ws);

      await sleep(30);

      const unexpectedRateLog = logs.find(
        (entry) => entry.message === "[Duplex] unexpected_sample_rate",
      );

      assert.ok(
        unexpectedRateLog,
        `expected a high-signal unexpected sample-rate log, logs=${JSON.stringify(logs)}`,
      );
      assert.equal(unexpectedRateLog.module, "session");
      assert.equal(unexpectedRateLog.data?.ingressSampleRate, 48_000);
      assert.equal(unexpectedRateLog.data?.normalizedSampleRate, 16_000);
      assert.equal(unexpectedRateLog.data?.frameBytes, frame.length);
      assert.equal(unexpectedRateLog.data?.transport, "binary");
      assert.ok(
        typeof unexpectedRateLog.data?.utteranceSeq === "number",
        `expected utteranceSeq in sample-rate log, data=${JSON.stringify(unexpectedRateLog.data)}`,
      );
      assert.equal(
        sampleRates.includes(16_000),
        true,
        `expected duplex ingress to normalize to 16k before STT, sampleRates=${JSON.stringify(sampleRates)}`,
      );
    } finally {
      restore();
    }
  });
});
