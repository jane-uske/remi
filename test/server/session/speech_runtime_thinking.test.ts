/**
 * PR6 — SpeechRuntime thinking_while_listening (SHADOW ONLY).
 *
 * Verifies the FSM reaches `thinking_while_listening` when pre-generation runs
 * during user speech, measures the window, and remains a pure observer
 * (never throws, returns to the prior state, no control-flow effect).
 */
const assert = require("assert").strict;
const { SpeechRuntime } = require("../../../server/session/voice/speech_runtime");

function fresh() {
  const sr = new SpeechRuntime("conn-think");
  sr.observeDuplexStart(); // duplexActive = true, state → listening
  return sr;
}

describe("SpeechRuntime thinking_while_listening (PR6)", () => {
  it("用户说话中 thinking.start → 进入 thinking_while_listening", () => {
    const sr = fresh();
    sr.observeEvent("vad.speech_start", { mode: "strict" });
    assert.equal(sr.getState(), "user_speaking");
    sr.observeEvent("thinking.start", { textLen: 6, mode: "full" });
    assert.equal(sr.getState(), "thinking_while_listening");
  });

  it("listening 中 thinking.start 也进入 thinking_while_listening", () => {
    const sr = fresh();
    assert.equal(sr.getState(), "listening");
    sr.observeEvent("thinking.start", {});
    assert.equal(sr.getState(), "thinking_while_listening");
  });

  it("thinking.done → 回到思考前状态 + 记录窗口与 outcome=completed", () => {
    const sr = fresh();
    sr.observeEvent("vad.speech_start", {});
    sr.observeEvent("thinking.start", {});
    assert.equal(sr.getState(), "thinking_while_listening");
    sr.observeEvent("thinking.done", { replyLen: 12 });
    assert.equal(sr.getState(), "user_speaking", "应回到思考前的 user_speaking");
    const snap = sr.snapshot();
    assert.equal(snap.lastThinkingOutcome, "completed");
    assert.equal(typeof snap.lastThinkingWindowMs, "number");
    assert.ok(snap.lastThinkingWindowMs >= 0);
    assert.equal(typeof sr.getLastThinkingWindowMs(), "number");
  });

  it("thinking.aborted → 回到思考前状态 + outcome=aborted", () => {
    const sr = fresh();
    sr.observeEvent("vad.speech_start", {});
    sr.observeEvent("thinking.start", {});
    sr.observeEvent("thinking.aborted", { reason: "aborted" });
    assert.equal(sr.getState(), "user_speaking");
    assert.equal(sr.snapshot().lastThinkingOutcome, "aborted");
  });

  it("idle（用户不在线）时 thinking.start 不改状态，仅记录", () => {
    const sr = new SpeechRuntime("conn-idle");
    // no duplex start → state idle
    assert.equal(sr.getState(), "idle");
    sr.observeEvent("thinking.start", {});
    assert.equal(sr.getState(), "idle", "idle 下不应进入 thinking_while_listening");
    // the event is still recorded
    assert.ok(sr.getEvents().some((e) => e.type === "thinking.start"));
  });

  it("thinking_while_listening 中收到 vad.speech_end / barge_in 仍正常迁移", () => {
    const sr = fresh();
    sr.observeEvent("vad.speech_start", {});
    sr.observeEvent("thinking.start", {});
    assert.equal(sr.getState(), "thinking_while_listening");
    // a real barge-in during thinking must still flip to interrupted
    sr.observeEvent("user.barge_in", { bargeInLatencyMs: 300 });
    assert.equal(sr.getState(), "interrupted");
    assert.equal(sr.getLastBargeInLatencyMs(), 300);
  });

  it("observe 永不抛错（坏数据 / 乱序 done 无 start）", () => {
    const sr = fresh();
    assert.doesNotThrow(() => sr.observeEvent("thinking.done", null));
    assert.doesNotThrow(() => sr.observeEvent("thinking.aborted"));
    assert.doesNotThrow(() => sr.observeEvent("thinking.start", { x: undefined }));
  });

  it("仍是 shadow：mode=shadow，事件环形缓冲封顶 64", () => {
    const sr = fresh();
    for (let i = 0; i < 200; i++) {
      sr.observeEvent("thinking.start", { i });
      sr.observeEvent("thinking.done", { i });
    }
    assert.equal(sr.snapshot().mode, "shadow");
    assert.ok(sr.getEvents().length <= 64);
  });

  it("连续多轮预判：每轮 done 都刷新 window/outcome", () => {
    const sr = fresh();
    sr.observeEvent("vad.speech_start", {});
    sr.observeEvent("thinking.start", {});
    sr.observeEvent("thinking.aborted", {}); // 上一轮被新 partial 取消
    assert.equal(sr.snapshot().lastThinkingOutcome, "aborted");
    sr.observeEvent("thinking.start", {});
    sr.observeEvent("thinking.done", {});
    assert.equal(sr.snapshot().lastThinkingOutcome, "completed");
  });
});
