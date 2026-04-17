const assert = require("assert").strict;
const { loadSessionHarness, waitFor } = require("../../helpers/session_harness");

function messageTypes(ws) {
  return ws.parsedMessages().map((msg) => (msg && typeof msg === "object" ? msg.type : null));
}

describe("turn lifecycle protocol", () => {
  it("does not emit interrupt for a normal idle text send", async () => {
    const { ws, restore, pipelineCalls } = loadSessionHarness();
    try {
      ws.emitMessage(
        Buffer.from(
          JSON.stringify({
            type: "chat",
            content: "你好，先正常开始这一轮吧",
          }),
        ),
      );

      await waitFor(() => pipelineCalls.length === 1);

      const types = messageTypes(ws);
      assert.equal(types.includes("interrupt"), false, `messages=${JSON.stringify(ws.parsedMessages())}`);
      assert.ok(
        ws.parsedMessages().some((msg) => msg?.type === "turn_state" && msg.state === "assistant_entering"),
        `messages=${JSON.stringify(ws.parsedMessages())}`,
      );
    } finally {
      restore();
    }
  });

  it("emits exactly one interrupt when a live generation is preempted by new text", async () => {
    const { ws, session, restore, pipelineCalls } = loadSessionHarness();
    try {
      session.interrupt.begin();
      session.brain.currentAssistantDraft = "我刚才还在说上一轮。";
      session.activeGenerationId = 7;

      ws.emitMessage(
        Buffer.from(
          JSON.stringify({
            type: "chat",
            content: "打断一下，换个问题",
          }),
        ),
      );

      await waitFor(() => pipelineCalls.length === 1);

      const interrupts = ws.parsedMessages().filter((msg) => msg?.type === "interrupt");
      assert.equal(interrupts.length, 1, `messages=${JSON.stringify(ws.parsedMessages())}`);
      assert.equal(interrupts[0].generationId, 7);
    } finally {
      restore();
    }
  });

  it("confirms end when playback_end arrives for the active playback generation", () => {
    const { ws, session, restore } = loadSessionHarness();
    try {
      session.turnState = "assistant_speaking";
      session.activeGenerationId = 11;

      ws.emitMessage(
        Buffer.from(
          JSON.stringify({
            type: "playback_start",
            generationId: 11,
          }),
        ),
      );
      ws.emitMessage(
        Buffer.from(
          JSON.stringify({
            type: "playback_end",
            generationId: 11,
          }),
        ),
      );

      assert.equal(session.assistantPlaybackActive, false);
      assert.equal(session.playbackGenerationId, null);
      assert.equal(
        ws.parsedMessages().some(
          (msg) => msg?.type === "turn_state" && msg.state === "confirmed_end",
        ),
        true,
        `messages=${JSON.stringify(ws.parsedMessages())}`,
      );
    } finally {
      restore();
    }
  });

  it("ignores playback_end when it belongs to another generation", () => {
    const { ws, session, restore } = loadSessionHarness();
    try {
      session.turnState = "assistant_speaking";
      session.activeGenerationId = 11;

      ws.emitMessage(
        Buffer.from(
          JSON.stringify({
            type: "playback_start",
            generationId: 11,
          }),
        ),
      );
      ws.emitMessage(
        Buffer.from(
          JSON.stringify({
            type: "playback_end",
            generationId: 12,
          }),
        ),
      );

      assert.equal(session.assistantPlaybackActive, true);
      assert.equal(session.playbackGenerationId, 11);
      assert.equal(
        ws.parsedMessages().some(
          (msg) => msg?.type === "turn_state" && msg.state === "confirmed_end",
        ),
        false,
        `messages=${JSON.stringify(ws.parsedMessages())}`,
      );
    } finally {
      restore();
    }
  });
});
