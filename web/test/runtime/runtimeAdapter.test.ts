import type {} from "mocha";

const assert = require("node:assert/strict");
const {
  createAvatarRuntimeWithFactories,
} = require("../../src/lib/rem3d/runtimeAdapter");

function makeRuntime(label: string, calls: string[]) {
  return {
    setEmotion() {
      calls.push(`${label}:emotion`);
    },
    setState() {
      calls.push(`${label}:state`);
    },
    setTurnState() {
      calls.push(`${label}:turn`);
    },
    setIntent() {
      calls.push(`${label}:intent`);
    },
    setFrame() {
      calls.push(`${label}:frame`);
    },
    setPerformanceModel() {
      calls.push(`${label}:performance`);
    },
    playAction() {
      calls.push(`${label}:action`);
    },
    setLipSignal() {
      calls.push(`${label}:lip`);
    },
    load() {
      calls.push(`${label}:load`);
    },
    resize() {
      calls.push(`${label}:resize`);
    },
    dispose() {
      calls.push(`${label}:dispose`);
    },
  };
}

describe("createAvatarRuntimeWithFactories", () => {
  it("selects the requested engine factory", () => {
    const container = {} as HTMLElement;
    const calls: string[] = [];
    const runtime = createAvatarRuntimeWithFactories(
      container,
      { engine: "live2d" },
      {
        vrm: () => makeRuntime("vrm", calls),
        live2d: () => makeRuntime("live2d", calls),
      },
    );

    runtime.setEmotion("happy");
    runtime.load();
    assert.deepEqual(calls, ["live2d:emotion", "live2d:load"]);
  });

  it("defaults to VRM when no engine is specified", () => {
    const container = {} as HTMLElement;
    const calls: string[] = [];
    const runtime = createAvatarRuntimeWithFactories(
      container,
      undefined,
      {
        vrm: () => makeRuntime("vrm", calls),
        live2d: () => makeRuntime("live2d", calls),
      },
    );

    runtime.resize();
    assert.deepEqual(calls, ["vrm:resize"]);
  });

  it("forwards the conversation performance model to the selected runtime", () => {
    const container = {} as HTMLElement;
    const calls: string[] = [];
    const runtime = createAvatarRuntimeWithFactories(
      container,
      { engine: "live2d" },
      {
        vrm: () => makeRuntime("vrm", calls),
        live2d: () => makeRuntime("live2d", calls),
      },
    );

    runtime.setPerformanceModel({
      phase: "speaking_prepare",
      attentionTarget: "front",
      energyLevel: 0.5,
      languageBeat: {
        channel: "assistant",
        text: "你好。",
        textLength: 3,
        tokenCount: 2,
        clauseIndex: 1,
        boundary: "terminal",
        emphasis: 0.18,
        progress: 0.14,
        cadenceMs: 24,
        seed: 3.2,
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
        emphasisStrength: 0.18,
        displayStreamingText: "",
        displayPartialText: "",
      },
      avatarSync: {
        mouthFloor: 0.1,
        gazeBiasX: 0.05,
        gazeBiasY: 0.02,
        headImpulse: 0.22,
        bodyImpulse: 0.18,
        yieldClamp: 0,
        attentivePulse: 0,
      },
    });

    assert.deepEqual(calls, ["live2d:performance"]);
  });

  it("passes modelId through to the selected runtime factory", () => {
    const container = {} as HTMLElement;
    let capturedOptions: { engine?: string; modelId?: string } | undefined;

    createAvatarRuntimeWithFactories(
      container,
      { engine: "live2d", modelId: "hiyori-pro" },
      {
        vrm: (_host, options) => {
          capturedOptions = options;
          return makeRuntime("vrm", []);
        },
        live2d: (_host, options) => {
          capturedOptions = options;
          return makeRuntime("live2d", []);
        },
      },
    );

    assert.equal(capturedOptions?.engine, "live2d");
    assert.equal(capturedOptions?.modelId, "hiyori-pro");
  });
});
