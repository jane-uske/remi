import type {} from "mocha";

const assert = require("node:assert/strict");
const {
  buildConversationPerformanceModel,
  selectVoiceIndicatorFromPerformanceModel,
} = require("../src/lib/presence/conversationPerformanceModel");

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

function makeRenderModel(overrides = {}) {
  return {
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
    ...overrides,
  };
}

describe("buildConversationPerformanceModel", () => {
  it("maps thinking into a reply-preparing bubble before assistant text arrives", () => {
    const model = buildConversationPerformanceModel({
      runtimeState: makeRuntimeState({
        phase: "thinking",
        phaseReason: "awaiting_model",
        assistant: {
          waiting: true,
          streaming: false,
          playbackActive: false,
          playbackTailActive: false,
          textOnly: true,
        },
        turn: {
          serverState: "confirmed_end",
          reason: "confirmed_end",
          previewText: null,
          interruptionType: null,
          sinceAtMs: 9_960,
        },
      }),
      renderModel: makeRenderModel({
        motionPhase: "thinking",
        phase: "thinking",
        phaseReason: "awaiting_model",
      }),
      streamingText: "",
      sttPartialText: "",
    });

    assert.equal(model.phase, "thinking");
    assert.equal(model.chatSync.statusLabel, "Remi 正在回复");
    assert.equal(model.chatSync.showPreparingBubble, true);
    assert.equal(model.phaseCueText, "Remi 正在回复");
  });

  it("maps speaking prepare into a shared prepare contract for chat and avatar", () => {
    const model = buildConversationPerformanceModel({
      runtimeState: makeRuntimeState({
        phase: "speaking",
        phaseReason: "assistant_audio_prepare",
        turn: {
          serverState: "assistant_entering",
          reason: "tts_prepare",
          previewText: null,
          interruptionType: null,
          sinceAtMs: 9_980,
        },
      }),
      renderModel: makeRenderModel({
        motionPhase: "speaking_prepare",
        phase: "speaking",
        phaseReason: "assistant_audio_prepare",
      }),
      streamingText: "",
      sttPartialText: "",
    });

    assert.equal(model.phase, "speaking_prepare");
    assert.equal(model.attentionTarget, "front");
    assert.equal(model.chatSync.bubbleTone, "preparing");
    assert.equal(model.chatSync.showPreparingBubble, true);
    assert.ok(model.avatarSync.mouthFloor > 0);
    assert.ok(model.avatarSync.headImpulse >= 0.5);
  });

  it("maps speaking active into a shared status label for chat and voice indicator", () => {
    const model = buildConversationPerformanceModel({
      runtimeState: makeRuntimeState({
        phase: "speaking",
        phaseReason: "assistant_audio_active",
        assistant: {
          waiting: false,
          streaming: true,
          playbackActive: true,
          playbackTailActive: false,
          textOnly: false,
        },
      }),
      renderModel: makeRenderModel({
        motionPhase: "speaking_active",
        phase: "speaking",
        phaseReason: "assistant_audio_active",
      }),
      streamingText: "我在这里。",
      sttPartialText: "",
    });

    assert.equal(model.chatSync.statusLabel, "说着");
    assert.equal(
      selectVoiceIndicatorFromPerformanceModel(model).label,
      "说着",
    );
    assert.equal(selectVoiceIndicatorFromPerformanceModel(model).active, true);
  });

  it("extracts deterministic beat cues from assistant streaming text", () => {
    const model = buildConversationPerformanceModel({
      runtimeState: makeRuntimeState({
        phase: "speaking",
        phaseReason: "assistant_audio_active",
        assistant: {
          waiting: false,
          streaming: true,
          playbackActive: true,
          playbackTailActive: false,
          textOnly: false,
        },
      }),
      renderModel: makeRenderModel({
        motionPhase: "speaking_active",
        phase: "speaking",
        phaseReason: "assistant_audio_active",
      }),
      streamingText: "好的，我们继续！",
      sttPartialText: "",
    });

    assert.equal(model.phase, "speaking_active");
    assert.equal(model.languageBeat.channel, "assistant");
    assert.equal(model.languageBeat.boundary, "emphasis");
    assert.ok(model.languageBeat.tokenCount >= 4);
    assert.ok(model.chatSync.emphasisStrength > 0.35);
    assert.ok(model.avatarSync.bodyImpulse > 0.2);
  });

  it("preserves phase timing so downstream motion can generate transient performance envelopes", () => {
    const model = buildConversationPerformanceModel({
      runtimeState: makeRuntimeState({
        derivedAtMs: 10_000,
        phase: "speaking",
        phaseReason: "assistant_audio_prepare",
        turn: {
          serverState: "assistant_entering",
          reason: "tts_prepare",
          previewText: null,
          interruptionType: null,
          sinceAtMs: 9_840,
        },
      }),
      renderModel: makeRenderModel({
        motionPhase: "speaking_prepare",
        phase: "speaking",
        phaseReason: "assistant_audio_prepare",
      }),
      streamingText: "",
      sttPartialText: "",
    });

    assert.equal(model.phaseStartedAtMs, 9_840);
    assert.ok(model.phaseCueText.includes("起句"));
  });

  it("turns yield into a hard stop for chat text and avatar motion", () => {
    const model = buildConversationPerformanceModel({
      runtimeState: makeRuntimeState({
        phase: "reacting",
        phaseReason: "user_interrupt",
        turn: {
          serverState: "interrupted_by_user",
          reason: "user_interrupt",
          previewText: "等等",
          interruptionType: "user",
          sinceAtMs: 9_990,
        },
      }),
      renderModel: makeRenderModel({
        motionPhase: "yield",
        phase: "reacting",
        phaseReason: "user_interrupt",
      }),
      streamingText: "先别急，我刚刚想说",
      sttPartialText: "",
    });

    assert.equal(model.phase, "yield");
    assert.equal(model.chatSync.displayStreamingText, "");
    assert.equal(model.chatSync.bubbleTone, "yield");
    assert.equal(model.avatarSync.yieldClamp, 1);
    assert.ok(model.avatarSync.gazeBiasY <= -0.22);
    assert.ok(model.avatarSync.headImpulse <= -0.4);
  });
});
