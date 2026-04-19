const assert = require("assert").strict;

const {
  loadSessionHarness,
  waitFor,
} = require("../../helpers/session_harness");
const {
  makeSineFrame,
  repeatFrames,
} = require("../../helpers/pcm");

function emitDuplexStart(ws, sampleRate = 16_000, mode = "duplex") {
  ws.emitMessage(JSON.stringify({ type: "duplex_start", sampleRate, mode }));
}

describe("realtime stt partial integration", () => {
  it("externalizes live streaming partials during active duplex speech", async () => {
    const { ws, session, restore } = loadSessionHarness();
    try {
      emitDuplexStart(ws);
      session.lastVadStartMode = "strict";
      session.duplexSampleRate = 16_000;
      Object.defineProperty(session.vad, "speaking", {
        configurable: true,
        get: () => true,
      });
      session.speechBuffer = [Buffer.concat(repeatFrames(makeSineFrame(0.18), 18))];
      session.speechBufferBytes = session.speechBuffer[0].length;
      session.utteranceFrameCount = 18;
      session.utteranceStrongFrames = 16;
      session.utteranceMaxRms = 0.18;
      session.utteranceMaxPeak = 0.2;

      session.stt.emit("streaming_partial", {
        content: "你好Remi",
        itemId: "item_1",
        provider: "openai-realtime",
        sequence: 1,
        stability: "interim",
      });

      await waitFor(
        () =>
          ws
            .parsedMessages()
            .some(
              (message) =>
                message &&
                message.type === "stt_partial" &&
                message.content === "你好Remi",
            ),
        300,
      );

      const partial = ws
        .parsedMessages()
        .find(
          (message) =>
            message &&
            message.type === "stt_partial" &&
            message.content === "你好Remi",
        );
      assert.ok(partial, `messages=${JSON.stringify(ws.parsedMessages())}`);
      assert.equal(partial.source, "openai-realtime");
      assert.equal(partial.stability, "interim");
      assert.equal(partial.sequence, 1);
    } finally {
      restore();
    }
  });
});
