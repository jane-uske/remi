import type {} from "mocha";

const assert = require("node:assert/strict");
const { buildAvatarRenderModel } = require("../../src/runtime/avatarRenderModel");

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

describe("buildAvatarRenderModel", () => {
  it("maps speaking runtime state into mouth-open, labels, and speaking posture", () => {
    const model = buildAvatarRenderModel(makeRuntimeState({
      phase: "speaking",
      phaseReason: "assistant_audio_active",
      affect: {
        emotion: "happy",
        intent: {
          emotion: "happy",
          gesture: "none",
          gestureIntensity: 0,
          facialAccent: "soft_smile",
          energy: 3,
          holdMs: 820,
          source: "server",
        },
        frame: null,
      },
      speech: {
        envelope: 0.72,
        active: true,
        viseme: "aa",
        mouthLevel: 0.72,
      },
    }));

    assert.equal(model.presenceLabel, "说话中");
    assert.equal(model.motionPhase, "speaking_active");
    assert.match(model.companionLine, /不会让对话掉下去|我在这里/);
    assert.ok(model.mouthOpen > 0.6);
    assert.ok(model.smile > 0.2);
    assert.ok(model.posture.scale > 1);
  });

  it("maps thinking and sad/shy moods into a more downcast render target", () => {
    const model = buildAvatarRenderModel(makeRuntimeState({
      phase: "thinking",
      phaseReason: "awaiting_model",
      affect: {
        emotion: "sad",
        intent: {
          emotion: "sad",
          gesture: "shrink_in",
          gestureIntensity: 2,
          facialAccent: "brow_furrow",
          energy: 0,
          holdMs: 700,
          source: "server",
        },
        frame: null,
      },
    }));

    assert.equal(model.presenceLabel, "思考中");
    assert.equal(model.motionPhase, "thinking");
    assert.ok(model.gazeY > 0);
    assert.ok(model.headPitch > 0);
    assert.ok(model.breath < 0.9);
  });

  it("differentiates user hold, open-mic idle, and audio tail posture targets", () => {
    const hold = buildAvatarRenderModel(makeRuntimeState({
      phase: "listening",
      phaseReason: "user_hold",
      affect: {
        emotion: "curious",
        intent: {
          emotion: "curious",
          gesture: "tilt_head",
          gestureIntensity: 1,
          facialAccent: "brow_raise",
          energy: 2,
          holdMs: 700,
          source: "server",
        },
        frame: null,
      },
    }));
    const openMic = buildAvatarRenderModel(makeRuntimeState({
      phase: "listening",
      phaseReason: "open_mic_idle",
      user: {
        recording: true,
        duplexEnabled: true,
        speaking: false,
        awaitingCommit: false,
      },
    }));
    const tail = buildAvatarRenderModel(makeRuntimeState({
      phase: "speaking",
      phaseReason: "assistant_audio_tail",
      speech: {
        envelope: 0.12,
        active: false,
        viseme: null,
        mouthLevel: 0.12,
      },
    }));

    assert.notEqual(hold.headYaw, openMic.headYaw);
    assert.notEqual(hold.posture.rotateDeg, openMic.posture.rotateDeg);
    assert.equal(hold.motionPhase, "listening");
    assert.equal(openMic.motionPhase, "open_mic_idle");
    assert.equal(tail.motionPhase, "speaking_tail");
    assert.ok(tail.mouthOpen > 0);
    assert.equal(tail.presenceLabel, "说话中");
  });

  it("keeps listening breath more open than thinking while leaving idle neutral", () => {
    const listening = buildAvatarRenderModel(makeRuntimeState({
      phase: "listening",
      phaseReason: "user_voice",
    }));
    const thinking = buildAvatarRenderModel(makeRuntimeState({
      phase: "thinking",
      phaseReason: "awaiting_model",
    }));
    const idle = buildAvatarRenderModel(makeRuntimeState({
      phase: "idle",
      phaseReason: "idle_ready",
    }));

    assert.ok(listening.breath > thinking.breath);
    assert.ok(idle.breath > 0);
    assert.equal(listening.motionPhase, "listening");
    assert.equal(idle.motionPhase, "idle");
    assert.equal(idle.presenceLabel, "在这里");
  });

  it("maps prepare and yield phases into portrait-facing motion phases", () => {
    const prepare = buildAvatarRenderModel(makeRuntimeState({
      phase: "speaking",
      phaseReason: "assistant_audio_prepare",
    }));
    const yieldState = buildAvatarRenderModel(makeRuntimeState({
      phase: "reacting",
      phaseReason: "user_interrupt",
      turn: {
        serverState: "interrupted_by_user",
        reason: "user_interrupt",
        previewText: null,
        interruptionType: "continuation",
        sinceAtMs: 9_990,
      },
    }));

    assert.equal(prepare.motionPhase, "speaking_prepare");
    assert.equal(yieldState.motionPhase, "yield");
    assert.match(yieldState.companionLine, /听到了|让给你/);
  });
});
