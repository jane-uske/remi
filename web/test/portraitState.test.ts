import type {} from "mocha";

const assert = require("node:assert/strict");
const {
  buildPortraitDisplayModel,
  derivePortraitState,
} = require("../src/lib/portrait/portraitState");

describe("derivePortraitState", () => {
  it("falls back to a neutral idle portrait when inputs are missing or invalid", () => {
    const state = derivePortraitState({
      emotion: "unknown-emotion",
      nowMs: 10_000,
    });

    assert.deepEqual(state, {
      emotion: "neutral",
      presenceState: "idle",
      mouthLevel: 0,
      gazeMode: "soft",
      emphasis: 0,
    });
  });

  it("prioritizes listening while the user is actively speaking", () => {
    const state = derivePortraitState({
      emotion: "happy",
      turnState: "assistant_speaking",
      userSpeaking: true,
      recording: true,
      voiceActive: true,
      nowMs: 10_000,
    });

    assert.equal(state.presenceState, "listening");
    assert.equal(state.gazeMode, "attentive");
    assert.equal(state.mouthLevel, 0);
  });

  it("uses fresh lip sync for speaking and falls back to voice activity when lip sync is stale", () => {
    const fresh = derivePortraitState({
      emotion: "curious",
      turnState: "assistant_speaking",
      voiceActive: true,
      avatarFrame: {
        lipSync: {
          time: 9_950,
          viseme: "aa",
          weight: 0.66,
        },
        lipSyncAtMs: 9_950,
      },
      nowMs: 10_000,
    });

    assert.equal(fresh.presenceState, "speaking");
    assert.equal(fresh.mouthLevel, 0.66);

    const stale = derivePortraitState({
      emotion: "curious",
      turnState: "assistant_speaking",
      voiceActive: true,
      avatarFrame: {
        lipSync: {
          time: 9_000,
          viseme: "aa",
          weight: 0.66,
        },
        lipSyncAtMs: 9_000,
      },
      nowMs: 10_000,
    });

    assert.equal(stale.presenceState, "speaking");
    assert.ok(stale.mouthLevel > 0.15);
    assert.ok(stale.mouthLevel < 0.3);
  });

  it("derives a thinking state from pending assistant work and intent emphasis", () => {
    const state = derivePortraitState({
      emotion: "sad",
      turnState: "confirmed_end",
      busy: true,
      avatarIntent: {
        emotion: "sad",
        gesture: "shrink_in",
        gestureIntensity: 2,
        facialAccent: "brow_furrow",
        energy: 3,
        holdMs: 820,
        source: "server",
      },
      nowMs: 10_000,
    });

    assert.deepEqual(state, {
      emotion: "sad",
      presenceState: "thinking",
      mouthLevel: 0,
      gazeMode: "downcast",
      emphasis: 3,
    });
  });

  it("uses the render model as the primary source when compatibility fallback is present", () => {
    const state = derivePortraitState({
      emotion: "happy",
      turnState: "assistant_speaking",
      voiceActive: true,
      renderModel: {
        emotion: "curious",
        motionPhase: "idle",
        phase: "idle",
        phaseReason: "idle_ready",
        presenceLabel: "在这里",
        companionLine: "我会一直在这里接着聊。",
        mouthOpen: 0,
        blink: 0.02,
        smile: 0.14,
        gazeX: 0,
        gazeY: 0,
        headYaw: 0,
        headPitch: 0,
        breath: 1,
        posture: {
          translateX: 0,
          translateY: 0,
          scale: 1,
          rotateDeg: 0,
        },
      },
      nowMs: 10_000,
    });

    assert.deepEqual(state, {
      emotion: "curious",
      presenceState: "idle",
      mouthLevel: 0,
      gazeMode: "soft",
      emphasis: 0,
    });
  });

  it("builds portrait display data from runtime render input without letting fallback props override it", () => {
    const display = buildPortraitDisplayModel({
      emotion: "happy",
      turnState: "assistant_speaking",
      voiceActive: true,
      busy: true,
      userSpeaking: true,
      recording: true,
      renderModel: {
        emotion: "curious",
        motionPhase: "idle",
        phase: "idle",
        phaseReason: "idle_ready",
        presenceLabel: "在这里",
        companionLine: "我会一直在这里接着聊。",
        mouthOpen: 0,
        blink: 0.02,
        smile: 0.14,
        gazeX: 0,
        gazeY: 0,
        headYaw: 0,
        headPitch: 0,
        breath: 1,
        posture: {
          translateX: 0,
          translateY: 0,
          scale: 1,
          rotateDeg: 0,
        },
      },
      nowMs: 10_000,
    });

    assert.equal(display.emotion, "curious");
    assert.equal(display.presenceState, "idle");
    assert.equal(display.presenceLabel, "在这里");
    assert.equal(display.companionLine, "我会一直在这里接着聊。");
    assert.equal(display.motionPhase, "idle");
    assert.equal(display.mouthLevel, 0);
    assert.equal(display.mouthLevelFloor, 0);
    assert.match(display.motion, /translate3d\(/);
  });

  it("builds fallback portrait display data when runtime render input is absent", () => {
    const listening = buildPortraitDisplayModel({
      emotion: "happy",
      turnState: "listening_active",
      userSpeaking: true,
      recording: true,
      nowMs: 10_000,
    });
    const speaking = buildPortraitDisplayModel({
      emotion: "curious",
      turnState: "assistant_speaking",
      voiceActive: true,
      nowMs: 10_000,
    });

    assert.equal(listening.presenceState, "listening");
    assert.equal(listening.motionPhase, "listening");
    assert.equal(listening.mouthLevelFloor, 0);
    assert.deepEqual(listening.gaze, { x: 4, y: -2 });
    assert.equal(speaking.presenceState, "speaking");
    assert.equal(speaking.motionPhase, "speaking_active");
    assert.equal(speaking.mouthLevelFloor, 0);
    assert.equal(speaking.mouthLevel, 0.18);
  });

  it("samples thinking motion differently from idle and keeps it more gathered", () => {
    const idle = buildPortraitDisplayModel({
      nowMs: 10_000,
      renderModel: {
        emotion: "neutral",
        motionPhase: "idle",
        phase: "idle",
        phaseReason: "idle_ready",
        presenceLabel: "在这里",
        companionLine: "我会一直在这里接着聊。",
        mouthOpen: 0,
        blink: 0.02,
        smile: 0.08,
        gazeX: 0,
        gazeY: 0,
        headYaw: 0,
        headPitch: 0,
        breath: 1,
        posture: {
          translateX: 0,
          translateY: 0,
          scale: 1,
          rotateDeg: 0,
        },
      },
    });
    const thinking = buildPortraitDisplayModel({
      nowMs: 10_000,
      renderModel: {
        emotion: "neutral",
        motionPhase: "thinking",
        phase: "thinking",
        phaseReason: "awaiting_model",
        presenceLabel: "思考中",
        companionLine: "让我想一下，我马上接上。",
        mouthOpen: 0,
        blink: 0.16,
        smile: 0.08,
        gazeX: -1,
        gazeY: 4,
        headYaw: 0,
        headPitch: 0.12,
        breath: 0.82,
        posture: {
          translateX: 4,
          translateY: 5,
          scale: 0.985,
          rotateDeg: -1,
        },
      },
    });

    assert.equal(thinking.motionPhase, "thinking");
    assert.ok(thinking.gaze.y > idle.gaze.y);
    assert.ok(thinking.eyeScale < idle.eyeScale);
    assert.ok(thinking.breathOffset < idle.breathOffset);
    assert.notEqual(thinking.motion, idle.motion);
  });

  it("uses mouth floors for speaking prepare and tail without breaking active speaking", () => {
    const prepare = buildPortraitDisplayModel({
      nowMs: 10_000,
      renderModel: {
        emotion: "happy",
        motionPhase: "speaking_prepare",
        phase: "speaking",
        phaseReason: "assistant_audio_prepare",
        presenceLabel: "说话中",
        companionLine: "我接上了，马上开口。",
        mouthOpen: 0.05,
        blink: 0.04,
        smile: 0.2,
        gazeX: 6,
        gazeY: 0,
        headYaw: 0,
        headPitch: -0.08,
        breath: 1.08,
        posture: {
          translateX: 8,
          translateY: -1,
          scale: 1.01,
          rotateDeg: 0,
        },
      },
    });
    const tail = buildPortraitDisplayModel({
      nowMs: 10_000,
      renderModel: {
        emotion: "happy",
        motionPhase: "speaking_tail",
        phase: "speaking",
        phaseReason: "assistant_audio_tail",
        presenceLabel: "说话中",
        companionLine: "我在这里，不会让对话掉下去。",
        mouthOpen: 0.08,
        blink: 0.06,
        smile: 0.2,
        gazeX: 5,
        gazeY: 0,
        headYaw: -0.04,
        headPitch: 0,
        breath: 0.96,
        posture: {
          translateX: 8,
          translateY: 0,
          scale: 1.012,
          rotateDeg: 0.4,
        },
      },
    });
    const active = buildPortraitDisplayModel({
      nowMs: 10_000,
      renderModel: {
        emotion: "happy",
        motionPhase: "speaking_active",
        phase: "speaking",
        phaseReason: "assistant_audio_active",
        presenceLabel: "说话中",
        companionLine: "我在这里，不会让对话掉下去。",
        mouthOpen: 0.42,
        blink: 0.06,
        smile: 0.2,
        gazeX: 6,
        gazeY: 0,
        headYaw: 0,
        headPitch: 0,
        breath: 1.04,
        posture: {
          translateX: 8,
          translateY: 0,
          scale: 1.024,
          rotateDeg: 0,
        },
      },
    });

    assert.equal(prepare.motionPhase, "speaking_prepare");
    assert.equal(prepare.mouthLevel, 0);
    assert.ok(prepare.mouthLevelFloor > 0);
    assert.equal(tail.motionPhase, "speaking_tail");
    assert.equal(tail.mouthLevel, 0);
    assert.ok(tail.mouthLevelFloor > 0);
    assert.ok(active.mouthLevel > tail.mouthLevelFloor);
  });

  it("maps reacting runtime render input into a yield motion cue", () => {
    const display = buildPortraitDisplayModel({
      nowMs: 10_000,
      renderModel: {
        emotion: "curious",
        motionPhase: "yield",
        phase: "reacting",
        phaseReason: "user_interrupt",
        presenceLabel: "在接话",
        companionLine: "听到了，我先让给你。",
        mouthOpen: 0,
        blink: 0.02,
        smile: 0.16,
        gazeX: 2,
        gazeY: 1,
        headYaw: 0,
        headPitch: 0.06,
        breath: 0.92,
        posture: {
          translateX: 0,
          translateY: 0,
          scale: 1,
          rotateDeg: 0,
        },
      },
    });

    assert.equal(display.presenceState, "listening");
    assert.equal(display.motionPhase, "yield");
    assert.equal(display.mouthLevelFloor, 0);
    assert.ok(display.gaze.y >= 1);
  });
});
