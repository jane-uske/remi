import type {} from "mocha";

const assert = require("node:assert/strict");
const {
  getRuntimeCompanionLine,
  selectChatWindowStatus,
  selectVoiceIndicatorModel,
} = require("../../src/runtime/remiRuntimeSelectors");

function makeRuntimeState(overrides = {}) {
  return {
    derivedAtMs: 10_000,
    phase: "idle",
    phaseReason: "idle_ready",
    connection: "open",
    turn: {
      serverState: "confirmed_end",
      reason: "confirmed_end",
      previewText: null,
      interruptionType: null,
      sinceAtMs: 9_950,
    },
    user: {
      recording: false,
      duplexEnabled: false,
      speaking: false,
      awaitingCommit: false,
    },
    assistant: {
      waiting: false,
      streaming: false,
      playbackActive: false,
      playbackTailActive: false,
      textOnly: false,
    },
    affect: {
      emotion: "neutral",
      intent: null,
      frame: null,
    },
    speech: {
      envelope: 0,
      active: false,
      viseme: null,
      mouthLevel: 0,
    },
    ...overrides,
  };
}

describe("remiRuntimeSelectors", () => {
  it("maps listening runtime state into a listening chat status pill", () => {
    const model = selectChatWindowStatus(
      makeRuntimeState({
        phase: "listening",
        phaseReason: "user_voice",
        turn: {
          serverState: "listening_active",
          reason: "speech_start",
          previewText: null,
          interruptionType: null,
          sinceAtMs: 9_960,
        },
      }),
    );

    assert.deepEqual(model, {
      badgeLabel: "听着",
      responseBusy: false,
    });
  });

  it("maps thinking/runtime response states into a response-busy chat status", () => {
    const model = selectChatWindowStatus(
      makeRuntimeState({
        phase: "thinking",
        phaseReason: "awaiting_model",
        turn: {
          serverState: "confirmed_end",
          reason: "confirmed_end",
          previewText: null,
          interruptionType: null,
          sinceAtMs: 9_960,
        },
      }),
    );

    assert.deepEqual(model, {
      badgeLabel: "Remi 正在回复",
      responseBusy: true,
    });
  });

  it("maps speaking runtime state into a speaking voice indicator model", () => {
    const model = selectVoiceIndicatorModel(
      makeRuntimeState({
        phase: "speaking",
        phaseReason: "assistant_audio_active",
        assistant: {
          waiting: false,
          streaming: false,
          playbackActive: true,
          playbackTailActive: false,
          textOnly: false,
        },
      }),
    );

    assert.deepEqual(model, {
      active: true,
      label: "speaking",
    });
  });

  it("keeps the voice indicator active through assistant speaking tail", () => {
    const model = selectVoiceIndicatorModel(
      makeRuntimeState({
        phase: "speaking",
        phaseReason: "assistant_audio_tail",
        assistant: {
          waiting: false,
          streaming: false,
          playbackActive: false,
          playbackTailActive: true,
          textOnly: false,
        },
      }),
    );

    assert.deepEqual(model, {
      active: true,
      label: "speaking",
    });
  });

  it("keeps companion copy consistent with the runtime reason", () => {
    const line = getRuntimeCompanionLine(
      makeRuntimeState({
        phase: "reacting",
        phaseReason: "user_interrupt",
      }),
    );

    assert.equal(line, "听到了，我先让给你。");
  });
});
