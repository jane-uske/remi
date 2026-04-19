import type {} from "mocha";

const assert = require("node:assert/strict");
const ReactLib = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { CharacterStage } = require("../src/components/CharacterStage");

describe("CharacterStage", () => {
  it("renders the default stage through the Live2D runtime path", () => {
    const markup = renderToStaticMarkup(
      ReactLib.createElement(CharacterStage, {
        emotion: "happy",
        turnState: "confirmed_end",
        avatarIntent: null,
        avatarFrame: null,
        voiceActive: false,
        busy: false,
        userSpeaking: false,
        recording: false,
        lipSignalRef: {
          current: {
            envelope: 0,
            active: false,
            viseme: null,
          },
        },
        runtimeState: null,
        renderModel: null,
      }),
    );

    assert.ok(markup.includes('data-character-engine="live2d"'));
    assert.ok(markup.includes('data-character-stage-state="loading"'));
    assert.ok(markup.includes('data-avatar-engine="live2d"'));
    assert.ok(markup.includes("加载 Live2D 模型中"));
  });

  it("stretches the stage container so runtime canvases do not collapse to zero height", () => {
    const markup = renderToStaticMarkup(
      ReactLib.createElement(CharacterStage, {
        emotion: "happy",
        turnState: "confirmed_end",
        avatarIntent: null,
        avatarFrame: null,
        voiceActive: false,
        busy: false,
        userSpeaking: false,
        recording: false,
        lipSignalRef: {
          current: {
            envelope: 0,
            active: false,
            viseme: null,
          },
        },
        runtimeState: null,
        renderModel: null,
      }),
    );

    assert.ok(markup.includes("self-stretch"));
  });

  it("exposes the shared conversation phase on the stage root", () => {
    const markup = renderToStaticMarkup(
      ReactLib.createElement(CharacterStage, {
        emotion: "happy",
        turnState: "assistant_entering",
        avatarIntent: null,
        avatarFrame: null,
        voiceActive: false,
        busy: false,
        userSpeaking: false,
        recording: false,
        lipSignalRef: {
          current: {
            envelope: 0,
            active: false,
            viseme: null,
          },
        },
        runtimeState: null,
        renderModel: null,
        performanceModel: {
          phase: "speaking_prepare",
          phaseStartedAtMs: 9_950,
          phaseCueText: "Remi 正在起句",
          attentionTarget: "front",
          energyLevel: 0.5,
          languageBeat: {
            channel: "assistant",
            text: "你好。",
            textLength: 3,
            tokenCount: 2,
            clauseIndex: 1,
            boundary: "terminal",
            emphasis: 0.24,
            progress: 0.14,
            cadenceMs: 26,
            seed: 3.1,
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
            emphasisStrength: 0.24,
            displayStreamingText: "你好。",
            displayPartialText: "",
          },
          avatarSync: {
            mouthFloor: 0.1,
            gazeBiasX: 0.04,
            gazeBiasY: 0.02,
            headImpulse: 0.22,
            bodyImpulse: 0.18,
            yieldClamp: 0,
            attentivePulse: 0,
          },
        },
      }),
    );

    assert.ok(markup.includes('data-conversation-phase="speaking_prepare"'));
    assert.ok(markup.includes('data-language-beat-channel="assistant"'));
  });
});
