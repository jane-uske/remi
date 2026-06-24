/**
 * VoiceEngine 抽象层测试（Phase 1 — VE-1~VE-6）
 *
 * 验收要点：
 *   - resolveVoiceEngine 默认 legacy；REMI_VOICE_ENGINE / 显式 id 可切。
 *   - 未知 id / 显式 bogus → 回退 legacy（item 8）。
 *   - 两个引擎都声明 finalReplyAuthority="brain"（item 7 的门只会放行 brain）。
 *   - legacy.observe 是 no-op：喂任何 observation 都不 emit、不触发 listener
 *     （legacy 模式与改动前等价）。
 *   - realtime_shadow.observe 把 observation 映射成统一事件并交付 listener，
 *     origin 正确（耳朵/嘴=shell，回复文本=brain）。
 *   - item 12 守卫：brain-only 事件 + origin "shell" 一律拒绝。
 */
const assert = require("assert").strict;
const { withConfigEnv } = require("../../helpers/config_test_utils");
const {
  resolveVoiceEngine,
  LegacyPipelineEngine,
  RealtimeVoiceEngine,
} = require("../../../server/session/voice/engine");
const {
  isAllowedEventOrigin,
  BRAIN_OR_SIDEBAND_ONLY_EVENTS,
} = require("../../../server/session/voice/engine/types");
const { SpeechRuntime } = require("../../../server/session/voice/speech_runtime");

function makeRuntime(connId = "test-conn") {
  return new SpeechRuntime(connId);
}

// ─── resolveVoiceEngine ──────────────────────────────────────────────────────

describe("resolveVoiceEngine (VE)", () => {
  it("默认（未设 REMI_VOICE_ENGINE）→ legacy passthrough", () => {
    withConfigEnv({ REMI_VOICE_ENGINE: undefined }, () => {
      const e = resolveVoiceEngine("c1", makeRuntime());
      assert.equal(e.id, "legacy");
      assert.ok(e instanceof LegacyPipelineEngine);
      assert.equal(e.snapshot().mode, "passthrough");
    });
  });

  it("REMI_VOICE_ENGINE=legacy → legacy", () => {
    withConfigEnv({ REMI_VOICE_ENGINE: "legacy" }, () => {
      const e = resolveVoiceEngine("c2", makeRuntime());
      assert.equal(e.id, "legacy");
    });
  });

  it("REMI_VOICE_ENGINE=realtime_shadow → realtime_shadow（shadow 模式）", () => {
    withConfigEnv({ REMI_VOICE_ENGINE: "realtime_shadow" }, () => {
      const e = resolveVoiceEngine("c3", makeRuntime());
      assert.equal(e.id, "realtime_shadow");
      assert.ok(e instanceof RealtimeVoiceEngine);
      assert.equal(e.snapshot().mode, "shadow");
    });
  });

  it("未知 REMI_VOICE_ENGINE=foobar → 回退 legacy（item 8）", () => {
    withConfigEnv({ REMI_VOICE_ENGINE: "foobar" }, () => {
      const e = resolveVoiceEngine("c4", makeRuntime());
      assert.equal(e.id, "legacy");
    });
  });

  it("显式 id 覆盖 config（set_voice_engine 路径）", () => {
    withConfigEnv({ REMI_VOICE_ENGINE: "legacy" }, () => {
      const e = resolveVoiceEngine("c5", makeRuntime(), "realtime_shadow");
      assert.equal(e.id, "realtime_shadow");
    });
  });

  it("显式 bogus id → 回退 legacy（item 8）", () => {
    withConfigEnv({ REMI_VOICE_ENGINE: "realtime_shadow" }, () => {
      const e = resolveVoiceEngine("c6", makeRuntime(), "definitely-not-an-engine");
      assert.equal(e.id, "legacy");
    });
  });

  it("显式空串 → 落回 config 值", () => {
    withConfigEnv({ REMI_VOICE_ENGINE: "realtime_shadow" }, () => {
      const e = resolveVoiceEngine("c7", makeRuntime(), "");
      assert.equal(e.id, "realtime_shadow");
    });
  });

  it("两个引擎都声明 finalReplyAuthority='brain'（item 7 的门只放行 brain）", () => {
    const legacy = resolveVoiceEngine("c8", makeRuntime(), "legacy");
    const shadow = resolveVoiceEngine("c9", makeRuntime(), "realtime_shadow");
    assert.equal(legacy.capabilities.finalReplyAuthority, "brain");
    assert.equal(shadow.capabilities.finalReplyAuthority, "brain");
  });
});

// ─── legacy = no-op（与改动前等价）─────────────────────────────────────────

describe("LegacyPipelineEngine — observe 是 no-op", () => {
  it("喂任何 observation 都不 emit、不触发 listener", () => {
    const e = new LegacyPipelineEngine("c", makeRuntime());
    let fired = 0;
    e.on("turn_committed", () => { fired += 1; });
    e.on("partial_user_text", () => { fired += 1; });
    e.observe({ kind: "duplex_start" });
    e.observe({ kind: "partial_user_text", text: "你好" });
    e.observe({ kind: "turn_state", state: "confirmed_end", reason: "confirmed_end" });
    e.observe({ kind: "turn_state", state: "assistant_speaking", reason: "playback_start" });
    e.observe({ kind: "duplex_stop" });
    assert.equal(fired, 0, "legacy 不应交付任何统一事件");
    assert.equal(e.snapshot().emittedEventCount, 0);
    assert.equal(e.snapshot().rejectedEventCount, 0);
  });

  it("薄封装：持有传入的 speechRuntime 引用", () => {
    const sr = makeRuntime();
    const e = new LegacyPipelineEngine("c", sr);
    assert.equal(e.speechRuntime, sr);
  });
});

// ─── realtime_shadow = 映射 + emit（只 log，不发客户端）────────────────────

describe("RealtimeVoiceEngine — observe 映射成统一事件", () => {
  it("turn_state confirmed_end → turn_committed (origin shell)", () => {
    const e = new RealtimeVoiceEngine("c", makeRuntime());
    const got: any[] = [];
    e.on("turn_committed", (ev: any) => got.push(ev));
    e.observe({ kind: "turn_state", state: "confirmed_end", reason: "confirmed_end" });
    assert.equal(got.length, 1);
    assert.equal(got[0].type, "turn_committed");
    assert.equal(got[0].origin, "shell");
  });

  it("turn_state assistant_entering → assistant_partial_text (origin brain，回复文本永远属于 Brain)", () => {
    const e = new RealtimeVoiceEngine("c", makeRuntime());
    const got: any[] = [];
    e.on("assistant_partial_text", (ev: any) => got.push(ev));
    e.observe({ kind: "turn_state", state: "assistant_entering", reason: "tts_prepare" });
    assert.equal(got.length, 1);
    assert.equal(got[0].origin, "brain");
  });

  it("turn_state assistant_speaking → assistant_audio_chunk (origin shell，嘴)", () => {
    const e = new RealtimeVoiceEngine("c", makeRuntime());
    const got: any[] = [];
    e.on("assistant_audio_chunk", (ev: any) => got.push(ev));
    e.observe({ kind: "turn_state", state: "assistant_speaking", reason: "playback_start" });
    assert.equal(got.length, 1);
    assert.equal(got[0].origin, "shell");
  });

  it("turn_state interrupted_by_user → interruption_detected (origin shell)", () => {
    const e = new RealtimeVoiceEngine("c", makeRuntime());
    const got: any[] = [];
    e.on("interruption_detected", (ev: any) => got.push(ev));
    e.observe({ kind: "turn_state", state: "interrupted_by_user", reason: "user_interrupt" });
    assert.equal(got.length, 1);
    assert.equal(got[0].origin, "shell");
  });

  it("partial_user_text observation → partial_user_text (origin shell，耳朵)", () => {
    const e = new RealtimeVoiceEngine("c", makeRuntime());
    const got: any[] = [];
    e.on("partial_user_text", (ev: any) => got.push(ev));
    e.observe({ kind: "partial_user_text", text: "我想说" });
    assert.equal(got.length, 1);
    assert.equal(got[0].origin, "shell");
  });

  it("listening_active / likely_end 等中间态不产生统一事件", () => {
    const e = new RealtimeVoiceEngine("c", makeRuntime());
    let fired = 0;
    e.on("turn_committed", () => { fired += 1; });
    e.observe({ kind: "turn_state", state: "listening_active", reason: "speech_start" });
    e.observe({ kind: "turn_state", state: "likely_end", reason: "likely_end" });
    assert.equal(fired, 0);
  });

  it("一轮正常对话不触发 origin 守卫（stub 始终遵守契约）", () => {
    const e = new RealtimeVoiceEngine("c", makeRuntime());
    e.observe({ kind: "duplex_start" });
    e.observe({ kind: "partial_user_text", text: "你好" });
    e.observe({ kind: "turn_state", state: "confirmed_end", reason: "confirmed_end" });
    e.observe({ kind: "turn_state", state: "assistant_entering", reason: "tts_prepare" });
    e.observe({ kind: "turn_state", state: "assistant_speaking", reason: "playback_start" });
    e.observe({ kind: "duplex_stop" });
    assert.equal(e.snapshot().rejectedEventCount, 0, "正常对话不应有事件被守卫拒绝");
    assert.ok(e.snapshot().emittedEventCount >= 4);
  });

  it("listener 抛错不影响 observe（不向上抛）", () => {
    const e = new RealtimeVoiceEngine("c", makeRuntime());
    e.on("turn_committed", () => { throw new Error("boom"); });
    assert.doesNotThrow(() => {
      e.observe({ kind: "turn_state", state: "confirmed_end", reason: "confirmed_end" });
    });
  });
});

// ─── item 12 守卫：brain-only 事件不能由语音模型(shell)产生 ──────────────────

describe("isAllowedEventOrigin (item 12 守卫)", () => {
  it("brain-only 事件集 = {assistant_partial_text, tool_request, memory_write_candidate, user_emotion_hint}", () => {
    assert.ok(BRAIN_OR_SIDEBAND_ONLY_EVENTS.has("assistant_partial_text"));
    assert.ok(BRAIN_OR_SIDEBAND_ONLY_EVENTS.has("tool_request"));
    assert.ok(BRAIN_OR_SIDEBAND_ONLY_EVENTS.has("memory_write_candidate"));
    assert.ok(BRAIN_OR_SIDEBAND_ONLY_EVENTS.has("user_emotion_hint"));
  });

  it("brain-only 事件 + origin shell → 拒绝", () => {
    assert.equal(isAllowedEventOrigin("tool_request", "shell"), false);
    assert.equal(isAllowedEventOrigin("memory_write_candidate", "shell"), false);
    assert.equal(isAllowedEventOrigin("assistant_partial_text", "shell"), false);
    assert.equal(isAllowedEventOrigin("user_emotion_hint", "shell"), false);
  });

  it("brain-only 事件 + origin brain/sideband → 放行", () => {
    assert.equal(isAllowedEventOrigin("tool_request", "brain"), true);
    assert.equal(isAllowedEventOrigin("memory_write_candidate", "brain"), true);
    assert.equal(isAllowedEventOrigin("user_emotion_hint", "sideband"), true);
  });

  it("shell 可以产生耳朵/嘴类事件", () => {
    assert.equal(isAllowedEventOrigin("partial_user_text", "shell"), true);
    assert.equal(isAllowedEventOrigin("assistant_audio_chunk", "shell"), true);
    assert.equal(isAllowedEventOrigin("interruption_detected", "shell"), true);
    assert.equal(isAllowedEventOrigin("turn_committed", "shell"), true);
    assert.equal(isAllowedEventOrigin("user_audio_frame", "shell"), true);
  });
});
