import type {} from "mocha";

const assert = require("node:assert/strict");
const ReactLib = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { RemiPortraitAvatar } = require("../src/components/RemiPortraitAvatar");

describe("RemiPortraitAvatar", () => {
  it("renders the selected remi portrait asset as the default portrait image", () => {
    const markup = renderToStaticMarkup(
      ReactLib.createElement(RemiPortraitAvatar, {
        emotion: "neutral",
        turnState: "confirmed_end",
        voiceActive: false,
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

    assert.ok(markup.includes('/avatar/assets/remi-selected-portrait.png'));
    assert.ok(markup.includes('alt="Remi avatar"'));
  });

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
          motionPhase: "idle",
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
    assert.ok(markup.includes('data-portrait-style="anime-companion-v2"'));
    assert.ok(markup.includes('data-runtime-phase="idle"'));
    assert.ok(markup.includes('data-motion-phase="idle"'));
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
    assert.ok(markup.includes('data-motion-phase="listening"'));
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
    assert.ok(markup.includes('data-motion-phase="speaking_active"'));
  });

  it("renders prepare and yield motion phases onto the portrait root", () => {
    const prepareMarkup = renderToStaticMarkup(
      ReactLib.createElement(RemiPortraitAvatar, {
        emotion: "happy",
        turnState: "assistant_entering",
        voiceActive: false,
        busy: false,
        userSpeaking: false,
        recording: false,
        avatarIntent: null,
        avatarFrame: null,
        runtimeState: {
          derivedAtMs: 10_000,
          phase: "speaking",
          phaseReason: "assistant_audio_prepare",
          connection: "open",
          turn: {
            serverState: "assistant_entering",
            reason: "tts_prepare",
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
            emotion: "happy",
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
        lipSignalRef: {
          current: {
            envelope: 0,
            active: false,
            viseme: null,
          },
        },
      }),
    );
    const yieldMarkup = renderToStaticMarkup(
      ReactLib.createElement(RemiPortraitAvatar, {
        emotion: "curious",
        turnState: "interrupted_by_user",
        voiceActive: false,
        busy: false,
        userSpeaking: false,
        recording: false,
        avatarIntent: null,
        avatarFrame: null,
        runtimeState: {
          derivedAtMs: 10_000,
          phase: "reacting",
          phaseReason: "user_interrupt",
          connection: "open",
          turn: {
            serverState: "interrupted_by_user",
            reason: "user_interrupt",
            previewText: null,
            interruptionType: "continuation",
            sinceAtMs: 9_950,
          },
          user: {
            recording: false,
            duplexEnabled: true,
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
        lipSignalRef: {
          current: {
            envelope: 0,
            active: false,
            viseme: null,
          },
        },
      }),
    );

    assert.ok(prepareMarkup.includes('data-motion-phase="speaking_prepare"'));
    assert.ok(prepareMarkup.includes("我接上了，马上开口。"));
    assert.ok(yieldMarkup.includes('data-motion-phase="yield"'));
    assert.ok(yieldMarkup.includes("听到了，我先让给你。"));
  });
});
