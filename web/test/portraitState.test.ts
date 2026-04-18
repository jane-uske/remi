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

    assert.deepEqual(display, {
      emotion: "curious",
      presenceState: "idle",
      presenceLabel: "在这里",
      companionLine: "我会一直在这里接着聊。",
      mouthLevel: 0,
      gaze: { x: 0, y: 0 },
      eyeScale: 0.98,
      breathOffset: 8,
      motion: "translate3d(0px, 0px, 0) scale(1) rotate(0deg)",
    });
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

    assert.deepEqual(listening, {
      emotion: "happy",
      presenceState: "listening",
      presenceLabel: "在听",
      companionLine: "我在听，你慢慢说。",
      mouthLevel: 0,
      gaze: { x: 4, y: -2 },
      eyeScale: 1,
      breathOffset: 10,
      motion: "translate3d(10px, 2px, 0) scale(1) rotate(-1.5deg)",
    });
    assert.deepEqual(speaking, {
      emotion: "curious",
      presenceState: "speaking",
      presenceLabel: "说话中",
      companionLine: "我在这里，不会让对话掉下去。",
      mouthLevel: 0.18,
      gaze: { x: 6, y: 0 },
      eyeScale: 0.95,
      breathOffset: 7,
      motion: "translate3d(8px, 0, 0) scale(1)",
    });
  });
});
