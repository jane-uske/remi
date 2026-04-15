const assert = require("assert").strict;
const {
  loadSessionHarness,
} = require("../../helpers/session_harness");
const {
  makeBroadbandNoiseFrame,
  makeRaudFrame,
  makeSilenceFrame,
  makeSineFrame,
  makeSparseClickFrame,
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

function messageTypes(ws) {
  return ws.parsedMessages().map((msg) => (msg && typeof msg === "object" ? msg.type : null));
}

function messageCount(ws, type) {
  return ws.parsedMessages().filter((msg) => msg && typeof msg === "object" && msg.type === type).length;
}

describe("duplex ws+pcm regression", () => {
  it("does not enter assistant_entering or stt_final on sparse noise input", async () => {
    const { ws, restore } = loadSessionHarness({ transcript: "词曲 李宗盛" });
    try {
      emitDuplexStart(ws);
      emitFrames(ws, repeatFrames(makeSparseClickFrame(), 12));
      emitDuplexStop(ws);

      await new Promise((resolve) => setTimeout(resolve, 80));

      const types = messageTypes(ws);
      assert.equal(types.includes("assistant_entering"), false, `messages=${JSON.stringify(types)}`);
      assert.equal(types.includes("stt_final"), false, `messages=${JSON.stringify(types)}`);
    } finally {
      restore();
    }
  });

  it("does enter assistant_entering and stt_final on speech-like PCM", async () => {
    const { ws, restore } = loadSessionHarness({ transcript: "你好，我在这里。" });
    try {
      emitDuplexStart(ws);
      emitFrames(ws, repeatFrames(makeSineFrame(0.18), 14));
      emitFrames(ws, repeatFrames(makeSilenceFrame(), 8));
      emitDuplexStop(ws);

      await new Promise((resolve) => setTimeout(resolve, 450));

      const messages = ws.parsedMessages();
      const sttFinal = messages.find((msg) => msg && msg.type === "stt_final");
      const assistantEntering = messages.find((msg) => msg && msg.type === "turn_state" && msg.state === "assistant_entering");

      assert.ok(sttFinal, `messages=${JSON.stringify(messages)}`);
      assert.ok(assistantEntering, `messages=${JSON.stringify(messages)}`);
      assert.equal(sttFinal.content, "你好，我在这里。");
    } finally {
      restore();
    }
  });

  it("falls back to stop-time STT when audio arrived but VAD never fired", async () => {
    const { ws, session, restore } = loadSessionHarness({ transcript: "我在按住说话。" });
    try {
      session.vad.feed = () => {};

      emitDuplexStart(ws, 16_000);
      emitFrames(ws, repeatFrames(makeSineFrame(0.065), 14));
      emitDuplexStop(ws);

      await new Promise((resolve) => setTimeout(resolve, 450));

      const messages = ws.parsedMessages();
      const sttFinal = messages.find((msg) => msg && msg.type === "stt_final");
      const assistantEntering = messages.find((msg) => msg && msg.type === "turn_state" && msg.state === "assistant_entering");

      assert.ok(sttFinal, `messages=${JSON.stringify(messages)}`);
      assert.ok(assistantEntering, `messages=${JSON.stringify(messages)}`);
      assert.equal(sttFinal.content, "我在按住说话。");
    } finally {
      restore();
    }
  });

  it("does not force no-vad fallback on silence-only input", async () => {
    const { ws, session, restore } = loadSessionHarness({ transcript: "这句不该出来" });
    try {
      session.vad.feed = () => {};

      emitDuplexStart(ws, 16_000);
      emitFrames(ws, repeatFrames(makeSilenceFrame(), 18));
      emitDuplexStop(ws);

      await new Promise((resolve) => setTimeout(resolve, 120));

      const types = messageTypes(ws);
      assert.equal(types.includes("assistant_entering"), false, `messages=${JSON.stringify(ws.parsedMessages())}`);
      assert.equal(types.includes("stt_final"), false, `messages=${JSON.stringify(ws.parsedMessages())}`);
    } finally {
      restore();
    }
  });

  it("tolerates mixed noise but still does not promote to assistant_entering", async () => {
    const { ws, restore } = loadSessionHarness({ transcript: "词曲 李宗盛" });
    try {
      emitDuplexStart(ws);
      emitFrames(ws, [
        makeBroadbandNoiseFrame(0.14, 320, 7),
        makeSparseClickFrame(0.95, 320, 80),
        makeBroadbandNoiseFrame(0.12, 320, 17),
      ]);
      emitDuplexStop(ws);

      await new Promise((resolve) => setTimeout(resolve, 80));

      const types = messageTypes(ws);
      assert.equal(types.includes("assistant_entering"), false, `messages=${JSON.stringify(types)}`);
      assert.equal(types.includes("stt_final"), false, `messages=${JSON.stringify(types)}`);
    } finally {
      restore();
    }
  });

  it("suppresses long low-energy hum that hallucinates a long transcript", async () => {
    const { ws, restore } = loadSessionHarness({
      transcript: "请不吝点赞 订阅 转发 打赏支持明镜与点点栏目",
    });
    try {
      emitDuplexStart(ws);
      emitFrames(ws, repeatFrames(makeSineFrame(0.03), 140));
      emitDuplexStop(ws);

      await new Promise((resolve) => setTimeout(resolve, 120));

      const types = messageTypes(ws);
      const vadStarts = messageCount(ws, "vad_start");
      assert.equal(types.includes("assistant_entering"), false, `messages=${JSON.stringify(types)}`);
      assert.equal(types.includes("stt_final"), false, `messages=${JSON.stringify(types)}`);
      assert.ok(vadStarts <= 1, `expected <=1 vad_start, got ${vadStarts}, messages=${JSON.stringify(ws.parsedMessages())}`);
    } finally {
      restore();
    }
  });
});
