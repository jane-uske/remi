import type {} from "mocha";

const assert = require("node:assert/strict");
const ReactLib = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { RemiPortraitAvatar } = require("../src/components/RemiPortraitAvatar");

describe("RemiPortraitAvatar", () => {
  it("prefers the runtime render model over raw fallback props", () => {
    const markup = renderToStaticMarkup(
      ReactLib.createElement(RemiPortraitAvatar, {
        emotion: "happy",
        turnState: "assistant_speaking",
        voiceActive: true,
        busy: false,
        userSpeaking: false,
        recording: false,
        avatarIntent: null,
        avatarFrame: null,
        runtimeState: {
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
            emotion: "curious",
            intent: null,
            frame: null,
          },
          speech: {
            envelope: 0,
            active: false,
            viseme: null,
            mouthLevel: 0,
          },
        },
        renderModel: {
          emotion: "curious",
          phase: "idle",
          phaseReason: "idle_ready",
          presenceLabel: "在这里",
          companionLine: "我会一直在这里接着聊。",
          mouthOpen: 0,
          blink: 0.02,
          smile: 0.12,
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
        lipSignalRef: {
          current: {
            envelope: 0.52,
            active: true,
            viseme: null,
          },
        },
      }),
    );

    assert.ok(markup.includes("Remi portrait"));
    assert.ok(markup.includes("remi-anime-stage"));
    assert.ok(markup.includes('data-runtime-phase="idle"'));
    assert.ok(markup.includes("好奇"));
    assert.ok(markup.includes("在这里"));
    assert.ok(markup.includes("我会一直在这里接着聊。"));
    assert.ok(!markup.includes("说话中"));
    assert.ok(!markup.includes("我在这里，不会让对话掉下去。"));
    assert.ok(!markup.includes("3D 加载中"));
  });

  it("keeps the legacy listening fallback when runtime inputs are absent", () => {
    const markup = renderToStaticMarkup(
      ReactLib.createElement(RemiPortraitAvatar, {
        emotion: "happy",
        turnState: "listening_active",
        voiceActive: false,
        busy: false,
        userSpeaking: true,
        recording: true,
        avatarIntent: null,
        avatarFrame: null,
        runtimeState: null,
        renderModel: null,
        lipSignalRef: {
          current: {
            envelope: 0,
            active: false,
            viseme: null,
          },
        },
      }),
    );

    assert.ok(markup.includes("在听"));
    assert.ok(markup.includes("我在听，你慢慢说。"));
  });

  it("keeps the legacy speaking fallback when runtime inputs are absent", () => {
    const markup = renderToStaticMarkup(
      ReactLib.createElement(RemiPortraitAvatar, {
        emotion: "curious",
        turnState: "assistant_speaking",
        voiceActive: true,
        busy: false,
        userSpeaking: false,
        recording: false,
        avatarIntent: null,
        avatarFrame: null,
        runtimeState: null,
        renderModel: null,
        lipSignalRef: {
          current: {
            envelope: 0,
            active: false,
            viseme: null,
          },
        },
      }),
    );

    assert.ok(markup.includes("说话中"));
    assert.ok(markup.includes("我在这里，不会让对话掉下去。"));
  });
});
