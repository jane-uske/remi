import type {} from "mocha";

const assert = require("node:assert/strict");
const {
  resolveLive2DModelProfile,
} = require("../src/lib/rem3d/live2dModelProfile");
const {
  sampleLive2DLipCalibration,
} = require("../src/lib/rem3d/live2dLipCalibration");

describe("sampleLive2DLipCalibration", () => {
  it("uses attack/release smoothing instead of snapping directly to the target", () => {
    const profile = resolveLive2DModelProfile("hiyori-pro");

    const opened = sampleLive2DLipCalibration({
      nowMs: 1_000,
      previous: {
        mouthOpen: 0,
        mouthForm: 0,
        lastUpdatedAtMs: 980,
      },
      profile,
      baseMouthOpen: 0.18,
      baseMouthForm: 0,
      frameLipSync: null,
      frameLipAtMs: 0,
      envelope: 0.9,
      voiceActive: true,
      viseme: null,
      performanceModel: null,
    });

    assert.ok(opened.mouthOpen > 0);
    assert.ok(opened.mouthOpen < 1);

    const released = sampleLive2DLipCalibration({
      nowMs: 1_040,
      previous: opened.state,
      profile,
      baseMouthOpen: 0,
      baseMouthForm: 0,
      frameLipSync: null,
      frameLipAtMs: 0,
      envelope: 0,
      voiceActive: false,
      viseme: null,
      performanceModel: null,
    });

    assert.ok(released.mouthOpen > 0);
    assert.ok(released.mouthOpen < opened.mouthOpen);
  });

  it("lets viseme shape mouth form instead of keeping a generic neutral mouth", () => {
    const profile = resolveLive2DModelProfile("hiyori-pro");

    const ohShape = sampleLive2DLipCalibration({
      nowMs: 1_000,
      previous: {
        mouthOpen: 0,
        mouthForm: 0,
        lastUpdatedAtMs: 980,
      },
      profile,
      baseMouthOpen: 0.12,
      baseMouthForm: 0,
      frameLipSync: {
        time: 995,
        viseme: "oh",
        weight: 0.72,
      },
      frameLipAtMs: 995,
      envelope: 0.5,
      voiceActive: true,
      viseme: {
        name: "oh",
        weight: 0.72,
      },
      performanceModel: null,
    });

    const eeShape = sampleLive2DLipCalibration({
      nowMs: 1_000,
      previous: {
        mouthOpen: 0,
        mouthForm: 0,
        lastUpdatedAtMs: 980,
      },
      profile,
      baseMouthOpen: 0.12,
      baseMouthForm: 0,
      frameLipSync: {
        time: 995,
        viseme: "ee",
        weight: 0.72,
      },
      frameLipAtMs: 995,
      envelope: 0.5,
      voiceActive: true,
      viseme: {
        name: "ee",
        weight: 0.72,
      },
      performanceModel: null,
    });

    assert.ok(ohShape.mouthForm < 0);
    assert.ok(eeShape.mouthForm > 0);
  });

  it("keeps speaking-prepare mouth floor without over-opening before audio arrives", () => {
    const profile = resolveLive2DModelProfile("hiyori-pro");

    const prepare = sampleLive2DLipCalibration({
      nowMs: 2_000,
      previous: {
        mouthOpen: 0,
        mouthForm: 0,
        lastUpdatedAtMs: 1_980,
      },
      profile,
      baseMouthOpen: 0.04,
      baseMouthForm: 0.02,
      frameLipSync: null,
      frameLipAtMs: 0,
      envelope: 0,
      voiceActive: false,
      viseme: null,
      performanceModel: {
        phase: "speaking_prepare",
        phaseStartedAtMs: 1_960,
        phaseCueText: "Remi 正在起句",
        attentionTarget: "front",
        energyLevel: 0.52,
        languageBeat: {
          channel: "none",
          text: "",
          textLength: 0,
          tokenCount: 0,
          clauseIndex: 0,
          boundary: "none",
          emphasis: 0,
          progress: 0,
          cadenceMs: 24,
          seed: 1.2,
        },
        chatSync: {
          statusLabel: "开口中",
          bubbleTone: "preparing",
          showPreparingBubble: true,
          showThinkingPulse: false,
          showListeningPulse: false,
          showYieldClamp: false,
          revealCadenceMs: 24,
          tailHoldMs: 0,
          emphasisStrength: 0,
          displayStreamingText: "",
          displayPartialText: "",
        },
        avatarSync: {
          mouthFloor: 0.14,
          gazeBiasX: 0.06,
          gazeBiasY: 0.02,
          headImpulse: 0.2,
          bodyImpulse: 0.16,
          yieldClamp: 0,
          attentivePulse: 0,
        },
      },
    });

    assert.ok(prepare.mouthOpen >= 0.08);
    assert.ok(prepare.mouthOpen <= 0.26);
  });
});
