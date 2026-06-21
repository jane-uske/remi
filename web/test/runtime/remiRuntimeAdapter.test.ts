import type {} from "mocha";

const assert = require("node:assert/strict");
const {
  adaptRemiRuntimeState,
  AUDIO_ACTIVE_TAIL_MS,
  USER_INTERRUPT_REACT_MS,
} = require("../../src/runtime/remiRuntimeAdapter");

function makeInput(overrides = {}) {
  return {
    nowMs: 10_000,
    connection: "open",
    turnState: "confirmed_end",
    turnReason: "confirmed_end",
    turnPreviewText: null,
    turnInterruptionType: null,
    turnSinceAtMs: 9_900,
    recording: false,
    duplexEnabled: false,
    userSpeaking: false,
    awaitingCommit: false,
    waiting: false,
    typing: false,
    streamingText: "",
    voiceActive: false,
    emotion: "neutral",
    avatarIntent: null,
    avatarFrame: null,
    lipSignal: {
      envelope: 0,
      active: false,
      viseme: null,
    },
    ...overrides,
  };
}

describe("adaptRemiRuntimeState", () => {
  it("maps listening_active -> listening_hold -> confirmed_end into listening then thinking", () => {
    const listening = adaptRemiRuntimeState(makeInput({
      turnState: "listening_active",
      turnReason: "speech_start",
      turnSinceAtMs: 9_980,
    }));
    assert.equal(listening.phase, "listening");
    assert.equal(listening.phaseReason, "user_voice");

    const hold = adaptRemiRuntimeState(makeInput({
      nowMs: 10_080,
      turnState: "listening_hold",
      turnReason: "semantic_hold",
      turnSinceAtMs: 10_040,
    }), listening);
    assert.equal(hold.phase, "listening");
    assert.equal(hold.phaseReason, "user_hold");

    const thinking = adaptRemiRuntimeState(makeInput({
      nowMs: 10_140,
      turnState: "confirmed_end",
      turnReason: "confirmed_end",
      turnSinceAtMs: 10_120,
      waiting: true,
    }), hold);
    assert.equal(thinking.phase, "thinking");
    assert.equal(thinking.phaseReason, "awaiting_model");
  });

  it("maps assistant entering to prepare, speaking to active, then tail, then idle", () => {
    const prepare = adaptRemiRuntimeState(makeInput({
      turnState: "assistant_entering",
      turnReason: "tts_prepare",
      turnSinceAtMs: 9_960,
    }));
    assert.equal(prepare.phase, "speaking");
    assert.equal(prepare.phaseReason, "assistant_audio_prepare");

    const active = adaptRemiRuntimeState(makeInput({
      nowMs: 10_080,
      turnState: "assistant_speaking",
      turnReason: "playback_start",
      turnSinceAtMs: 10_060,
      voiceActive: true,
      avatarFrame: {
        lipSync: {
          time: 10_080,
          viseme: "aa",
          weight: 0.68,
        },
        lipSyncAtMs: 10_080,
      },
    }), prepare);
    assert.equal(active.phase, "speaking");
    assert.equal(active.phaseReason, "assistant_audio_active");
    assert.equal(active.assistant.playbackActive, true);

    const tail = adaptRemiRuntimeState(makeInput({
      nowMs: 10_080 + Math.floor(AUDIO_ACTIVE_TAIL_MS / 2),
      turnState: "assistant_speaking",
      turnReason: "playback_start",
      turnSinceAtMs: 10_060,
      voiceActive: false,
    }), active);
    assert.equal(tail.phase, "speaking");
    assert.equal(tail.phaseReason, "assistant_audio_tail");
    assert.equal(tail.assistant.playbackTailActive, true);

    const idle = adaptRemiRuntimeState(makeInput({
      nowMs: 10_080 + AUDIO_ACTIVE_TAIL_MS + 32,
      turnState: "assistant_speaking",
      turnReason: "playback_start",
      turnSinceAtMs: 10_060,
      voiceActive: false,
    }), tail);
    assert.equal(idle.phase, "idle");
    assert.equal(idle.phaseReason, "idle_ready");
    assert.equal(idle.assistant.playbackTailActive, false);
  });

  it("maps interrupt to reacting and then returns to listening when user speaks again", () => {
    const reacting = adaptRemiRuntimeState(makeInput({
      turnState: "interrupted_by_user",
      turnReason: "user_interrupt",
      turnInterruptionType: "continuation",
      turnSinceAtMs: 10_000,
    }));
    assert.equal(reacting.phase, "reacting");
    assert.equal(reacting.phaseReason, "user_interrupt");

    const listening = adaptRemiRuntimeState(makeInput({
      nowMs: 10_000 + Math.floor(USER_INTERRUPT_REACT_MS / 2),
      turnState: "listening_active",
      turnReason: "speech_start",
      turnSinceAtMs: 10_040,
      userSpeaking: true,
    }), reacting);
    assert.equal(listening.phase, "listening");
    assert.equal(listening.phaseReason, "user_voice");
  });

  it("resets stale speaking state on reconnect or disconnect", () => {
    const prev = adaptRemiRuntimeState(makeInput({
      turnState: "assistant_speaking",
      turnReason: "playback_start",
      voiceActive: true,
    }));
    const disconnected = adaptRemiRuntimeState(makeInput({
      connection: "closed",
      turnState: "assistant_speaking",
      turnReason: "playback_start",
      voiceActive: true,
    }), prev);

    assert.equal(disconnected.phase, "idle");
    assert.equal(disconnected.phaseReason, "disconnected");
    assert.equal(disconnected.assistant.playbackActive, false);
  });

  it("falls back to text streaming instead of speaking when audio never starts", () => {
    const textOnly = adaptRemiRuntimeState(makeInput({
      nowMs: 10_800,
      turnState: "assistant_entering",
      turnReason: "tts_prepare",
      turnSinceAtMs: 10_000,
      streamingText: "我先用文字接住这句。",
      waiting: true,
      typing: false,
      voiceActive: false,
    }));

    assert.equal(textOnly.phase, "thinking");
    assert.equal(textOnly.phaseReason, "assistant_text_streaming");
    assert.equal(textOnly.assistant.textOnly, true);
  });

  it("prioritizes awaiting reply over open-mic recording state", () => {
    const awaiting = adaptRemiRuntimeState(makeInput({
      recording: true,
      duplexEnabled: true,
      waiting: true,
      typing: true,
      streamingText: "",
      turnState: "confirmed_end",
      turnReason: "confirmed_end",
    }));

    assert.equal(awaiting.phase, "thinking");
    assert.equal(awaiting.phaseReason, "awaiting_model");
  });

  it("keeps duplex open-mic idle separate from active user speech", () => {
    const duplexIdle = adaptRemiRuntimeState(makeInput({
      recording: true,
      duplexEnabled: true,
      turnState: "confirmed_end",
      turnReason: "confirmed_end",
    }));
    assert.equal(duplexIdle.phase, "listening");
    assert.equal(duplexIdle.phaseReason, "open_mic_idle");

    const pushToTalkIdle = adaptRemiRuntimeState(makeInput({
      recording: false,
      duplexEnabled: false,
      turnState: "confirmed_end",
      turnReason: "confirmed_end",
    }), duplexIdle);
    assert.equal(pushToTalkIdle.phase, "idle");
    assert.equal(pushToTalkIdle.phaseReason, "idle_ready");
  });
});
