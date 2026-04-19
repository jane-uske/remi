import type {} from "mocha";

const assert = require("node:assert/strict");
const {
  sampleLive2DMotionFrame,
} = require("../src/lib/rem3d/live2dMotion");

describe("sampleLive2DMotionFrame", () => {
  it("uses render-model motion phase to separate speaking prepare from idle", () => {
    const idle = sampleLive2DMotionFrame({
      nowMs: 10_000,
      lipWeight: 0,
      emotion: "neutral",
      remState: "idle",
      turnState: "confirmed_end",
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
    const prepare = sampleLive2DMotionFrame({
      nowMs: 10_000,
      lipWeight: 0,
      emotion: "neutral",
      remState: "speaking",
      turnState: "assistant_entering",
      renderModel: {
        emotion: "neutral",
        motionPhase: "speaking_prepare",
        phase: "speaking",
        phaseReason: "assistant_audio_prepare",
        presenceLabel: "说话中",
        companionLine: "我接上了，马上开口。",
        mouthOpen: 0.05,
        blink: 0.04,
        smile: 0.1,
        gazeX: 6,
        gazeY: 0,
        headYaw: 0,
        headPitch: -0.08,
        breath: 1.08,
        posture: {
          translateX: 0,
          translateY: -1,
          scale: 1.01,
          rotateDeg: 0,
        },
      },
    });

    assert.ok(prepare.mouthOpen > idle.mouthOpen);
    assert.ok(Math.abs(prepare.angleY) > Math.abs(idle.angleY));
    assert.notEqual(prepare.focus.x, idle.focus.x);
  });

  it("turns yield into a more withdrawn, downcast motion cue", () => {
    const speaking = sampleLive2DMotionFrame({
      nowMs: 10_000,
      lipWeight: 0.42,
      emotion: "happy",
      remState: "speaking",
      turnState: "assistant_speaking",
      renderModel: {
        emotion: "happy",
        motionPhase: "speaking_active",
        phase: "speaking",
        phaseReason: "assistant_audio_active",
        presenceLabel: "说话中",
        companionLine: "我在这里，不会让对话掉下去。",
        mouthOpen: 0.42,
        blink: 0.03,
        smile: 0.28,
        gazeX: 5,
        gazeY: -1,
        headYaw: 0.08,
        headPitch: -0.04,
        breath: 1.02,
        posture: {
          translateX: 4,
          translateY: 0,
          scale: 1,
          rotateDeg: 0.6,
        },
      },
    });
    const yielding = sampleLive2DMotionFrame({
      nowMs: 10_000,
      lipWeight: 0,
      emotion: "happy",
      remState: "listening",
      turnState: "interrupted_by_user",
      renderModel: {
        emotion: "happy",
        motionPhase: "yield",
        phase: "reacting",
        phaseReason: "user_interrupt",
        presenceLabel: "在接话",
        companionLine: "听到了，我先让给你。",
        mouthOpen: 0,
        blink: 0.12,
        smile: 0.08,
        gazeX: -2,
        gazeY: 5,
        headYaw: -0.06,
        headPitch: 0.12,
        breath: 0.92,
        posture: {
          translateX: -4,
          translateY: 5,
          scale: 0.99,
          rotateDeg: 1.4,
        },
      },
    });

    assert.ok(yielding.focus.y < speaking.focus.y);
    assert.ok(yielding.mouthOpen < speaking.mouthOpen);
    assert.ok(Math.abs(yielding.bodyAngleX) < Math.abs(speaking.bodyAngleX));
    assert.ok(yielding.eyeOpen <= speaking.eyeOpen);
  });

  it("lets the shared conversation performance model drive beat-aware motion even when the render model stays neutral", () => {
    const idleFrame = sampleLive2DMotionFrame({
      nowMs: 12_400,
      lipWeight: 0,
      emotion: "neutral",
      remState: "idle",
      turnState: "confirmed_end",
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
    const speakingFrame = sampleLive2DMotionFrame({
      nowMs: 12_400,
      lipWeight: 0,
      emotion: "neutral",
      remState: "idle",
      turnState: "confirmed_end",
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
      performanceModel: {
        phase: "speaking_active",
        phaseStartedAtMs: 12_220,
        phaseCueText: "Remi 正在顺着这句说",
        attentionTarget: "front",
        energyLevel: 0.72,
        languageBeat: {
          channel: "assistant",
          text: "好的，我们继续！",
          textLength: 8,
          tokenCount: 6,
          clauseIndex: 2,
          boundary: "emphasis",
          emphasis: 0.58,
          progress: 0.42,
          cadenceMs: 24,
          seed: 7.6,
        },
        chatSync: {
          statusLabel: "说话中",
          bubbleTone: "speaking",
          showPreparingBubble: false,
          showThinkingPulse: false,
          showListeningPulse: false,
          showYieldClamp: false,
          revealCadenceMs: 24,
          tailHoldMs: 180,
          emphasisStrength: 0.58,
          displayStreamingText: "好的，我们继续！",
          displayPartialText: "",
        },
        avatarSync: {
          mouthFloor: 0.14,
          gazeBiasX: 0.06,
          gazeBiasY: 0.01,
          headImpulse: 0.3,
          bodyImpulse: 0.34,
          yieldClamp: 0,
          attentivePulse: 0,
        },
      },
    });

    assert.ok(speakingFrame.mouthOpen > idleFrame.mouthOpen);
    assert.ok(Math.abs(speakingFrame.bodyAngleX) - Math.abs(idleFrame.bodyAngleX) > 2);
    assert.ok(Math.abs(speakingFrame.focus.x) - Math.abs(idleFrame.focus.x) > 0.05);
  });

  it("uses phase timing to make early speaking prepare more pronounced than the settled end of prepare", () => {
    const early = sampleLive2DMotionFrame({
      nowMs: 10_020,
      lipWeight: 0,
      emotion: "neutral",
      remState: "speaking",
      turnState: "assistant_entering",
      renderModel: {
        emotion: "neutral",
        motionPhase: "speaking_prepare",
        phase: "speaking",
        phaseReason: "assistant_audio_prepare",
        presenceLabel: "说话中",
        companionLine: "我接上了，马上开口。",
        mouthOpen: 0.02,
        blink: 0.03,
        smile: 0.1,
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
      performanceModel: {
        phase: "speaking_prepare",
        phaseStartedAtMs: 10_000,
        phaseCueText: "Remi 正在起句",
        attentionTarget: "front",
        energyLevel: 0.6,
        languageBeat: {
          channel: "none",
          text: "",
          textLength: 0,
          tokenCount: 0,
          clauseIndex: 0,
          boundary: "none",
          emphasis: 0,
          progress: 0,
          cadenceMs: 30,
          seed: 1.4,
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
          mouthFloor: 0.18,
          gazeBiasX: 0.1,
          gazeBiasY: 0.03,
          headImpulse: 0.56,
          bodyImpulse: 0.42,
          yieldClamp: 0,
          attentivePulse: 0,
        },
      },
    });
    const late = sampleLive2DMotionFrame({
      nowMs: 10_320,
      lipWeight: 0,
      emotion: "neutral",
      remState: "speaking",
      turnState: "assistant_entering",
      renderModel: {
        emotion: "neutral",
        motionPhase: "speaking_prepare",
        phase: "speaking",
        phaseReason: "assistant_audio_prepare",
        presenceLabel: "说话中",
        companionLine: "我接上了，马上开口。",
        mouthOpen: 0.02,
        blink: 0.03,
        smile: 0.1,
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
      performanceModel: {
        phase: "speaking_prepare",
        phaseStartedAtMs: 10_000,
        phaseCueText: "Remi 正在起句",
        attentionTarget: "front",
        energyLevel: 0.6,
        languageBeat: {
          channel: "none",
          text: "",
          textLength: 0,
          tokenCount: 0,
          clauseIndex: 0,
          boundary: "none",
          emphasis: 0,
          progress: 0,
          cadenceMs: 30,
          seed: 1.4,
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
          mouthFloor: 0.18,
          gazeBiasX: 0.1,
          gazeBiasY: 0.03,
          headImpulse: 0.56,
          bodyImpulse: 0.42,
          yieldClamp: 0,
          attentivePulse: 0,
        },
      },
    });

    assert.ok(early.mouthOpen > late.mouthOpen);
    assert.ok(Math.abs(early.angleX) > Math.abs(late.angleX));
  });
});
