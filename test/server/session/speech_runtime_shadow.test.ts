const assert = require("assert").strict;
const { SpeechRuntime } = require("../../../server/session/voice/speech_runtime");

describe("SpeechRuntime (phase 1 shadow)", () => {
  it("mode 恒为 shadow，初始 idle", () => {
    const sr = new SpeechRuntime("t1");
    assert.equal(sr.mode, "shadow");
    assert.equal(sr.getState(), "idle");
  });

  it("duplex / vad / turn-state 事件驱动派生状态", () => {
    const sr = new SpeechRuntime("t2");
    sr.observeDuplexStart();
    assert.equal(sr.getState(), "listening");

    sr.observeEvent("vad.speech_start", { mode: "strict" });
    assert.equal(sr.getState(), "user_speaking");

    sr.observeTurnState("assistant_entering", "tts_prepare");
    assert.equal(sr.getState(), "responding");

    sr.observeTurnState("assistant_speaking", "playback_start");
    assert.equal(sr.getState(), "speaking");

    sr.observeTurnState("interrupted_by_user", "user_interrupt");
    assert.equal(sr.getState(), "interrupted");

    // confirmed_end while duplex still active → back to listening (not idle)
    sr.observeTurnState("confirmed_end", "confirmed_end");
    assert.equal(sr.getState(), "listening");

    sr.observeDuplexStop();
    assert.equal(sr.getState(), "idle");
  });

  it("user.barge_in 记录 baseline 延迟数字", () => {
    const sr = new SpeechRuntime("t3");
    sr.observeDuplexStart();
    sr.observeEvent("user.barge_in", { bargeInLatencyMs: 312, speechMs: 300 });
    assert.equal(sr.getState(), "interrupted");
    assert.equal(sr.getLastBargeInLatencyMs(), 312);
    const snap = sr.snapshot();
    assert.equal(snap.lastBargeInLatencyMs, 312);
    assert.ok(snap.recentEvents.some((e) => e.type === "user.barge_in"));
  });

  it("observe 永不抛错（shadow 安全保证）", () => {
    const sr = new SpeechRuntime("t4");
    assert.doesNotThrow(() => sr.observeEvent("vad.speech_start", null));
    assert.doesNotThrow(() => sr.observeTurnState("nonsense_state", "x"));
    assert.doesNotThrow(() => sr.observeEvent("totally.unknown.type"));
    // 未知 turn-state 不产生迁移
    const before = sr.getState();
    sr.observeTurnState("nonsense_state", "x");
    assert.equal(sr.getState(), before);
  });

  it("事件环形缓冲有上限，但累计计数不丢", () => {
    const sr = new SpeechRuntime("t5");
    for (let i = 0; i < 200; i++) sr.observeEvent("response.token", { i });
    assert.ok(sr.getEvents().length <= 64);
    assert.equal(sr.snapshot().eventCount, 200);
  });
});
