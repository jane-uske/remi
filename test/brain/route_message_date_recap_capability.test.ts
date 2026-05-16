const assert = require("assert").strict;
const path = require("path");

const { RemiSessionContext } = require("../../brains/remi_session_context");

function applyEnv(values) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

function loadMockedRouteMessage({
  fastBrainStream,
  runSlowBrain,
  tryHandleDirectCapabilities,
}) {
  const fastBrainModulePath = path.resolve(__dirname, "../../brains/reply_stream.ts");
  const slowBrainModulePath = path.resolve(__dirname, "../../brains/background_analysis.ts");
  const directCapabilitiesModulePath = path.resolve(
    __dirname,
    "../../brain/direct_capabilities.ts",
  );
  const brainRouterModulePath = path.resolve(__dirname, "../../brains/context_orchestrator.ts");
  const fastBrainModule = require(fastBrainModulePath);
  const slowBrainModule = require(slowBrainModulePath);
  const directCapabilitiesModule = require(directCapabilitiesModulePath);

  const originalFastBrainStream = fastBrainModule.fastBrainStream;
  const originalRunSlowBrain = slowBrainModule.runSlowBrain;
  const originalTryHandleDirectCapabilities =
    directCapabilitiesModule.tryHandleDirectCapabilities;

  fastBrainModule.fastBrainStream = fastBrainStream;
  slowBrainModule.runSlowBrain = runSlowBrain;
  directCapabilitiesModule.tryHandleDirectCapabilities = tryHandleDirectCapabilities;

  delete require.cache[brainRouterModulePath];
  const { routeMessage } = require(brainRouterModulePath);

  return {
    routeMessage,
    restore() {
      fastBrainModule.fastBrainStream = originalFastBrainStream;
      slowBrainModule.runSlowBrain = originalRunSlowBrain;
      directCapabilitiesModule.tryHandleDirectCapabilities =
        originalTryHandleDirectCapabilities;
      delete require.cache[brainRouterModulePath];
    },
  };
}

describe("routeMessage date recap capability", () => {
  it("short-circuits date recap questions without calling fast brain or slow brain", async () => {
    const restoreEnv = applyEnv({ REMI_DATE_RECAP_CAPABILITY_ENABLED: "1" });
    const fastBrainCalls = [];
    const slowBrainCalls = [];
    const directCapabilityCalls = [];
    const { routeMessage, restore } = loadMockedRouteMessage({
      fastBrainStream: async function* (...args) {
        fastBrainCalls.push(args);
        yield "llm should not run";
      },
      runSlowBrain: async (...args) => {
        slowBrainCalls.push(args);
      },
      tryHandleDirectCapabilities: async (request) => {
        directCapabilityCalls.push(request);
        return {
          handled: true,
          capabilityId: "date_recap",
          reply: "按你那边昨天的聊天记录看，昨天主要在聊 iOS 语音链路和 prosody。",
        };
      },
    });

    try {
      const ctx = new RemiSessionContext("date-recap-route");
      const chunks = [];
      for await (const chunk of routeMessage(ctx, "昨天我们聊了什么", "neutral")) {
        chunks.push(chunk);
      }

      assert.equal(directCapabilityCalls.length, 1);
      assert.equal(fastBrainCalls.length, 0);
      assert.equal(slowBrainCalls.length, 0);
      assert.deepEqual(chunks, [
        "按你那边昨天的聊天记录看，昨天主要在聊 iOS 语音链路和 prosody。",
      ]);
      assert.deepEqual(ctx.history, [
        { role: "user", content: "昨天我们聊了什么" },
        {
          role: "assistant",
          content: "按你那边昨天的聊天记录看，昨天主要在聊 iOS 语音链路和 prosody。",
        },
      ]);
    } finally {
      restore();
      restoreEnv();
    }
  });
});
