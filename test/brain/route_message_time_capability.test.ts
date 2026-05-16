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

function loadMockedRouteMessage({ fastBrainStream, runSlowBrain }) {
  const fastBrainModulePath = path.resolve(__dirname, "../../brains/reply_stream.ts");
  const slowBrainModulePath = path.resolve(__dirname, "../../brains/background_analysis.ts");
  const brainRouterModulePath = path.resolve(__dirname, "../../brains/context_orchestrator.ts");
  const fastBrainModule = require(fastBrainModulePath);
  const slowBrainModule = require(slowBrainModulePath);

  const originalFastBrainStream = fastBrainModule.fastBrainStream;
  const originalRunSlowBrain = slowBrainModule.runSlowBrain;

  fastBrainModule.fastBrainStream = fastBrainStream;
  slowBrainModule.runSlowBrain = runSlowBrain;

  delete require.cache[brainRouterModulePath];
  const { routeMessage } = require(brainRouterModulePath);

  return {
    routeMessage,
    restore() {
      fastBrainModule.fastBrainStream = originalFastBrainStream;
      slowBrainModule.runSlowBrain = originalRunSlowBrain;
      delete require.cache[brainRouterModulePath];
    },
  };
}

describe("routeMessage time capability", () => {
  it("short-circuits direct time questions without calling fast brain or slow brain", async () => {
    const restoreEnv = applyEnv({ REMI_TIME_CAPABILITY_ENABLED: "1" });
    const fastBrainCalls = [];
    const slowBrainCalls = [];
    const { routeMessage, restore } = loadMockedRouteMessage({
      fastBrainStream: async function* (...args) {
        fastBrainCalls.push(args);
        yield "llm should not run";
      },
      runSlowBrain: async (...args) => {
        slowBrainCalls.push(args);
      },
    });

    try {
      const ctx = new RemiSessionContext("time-capability-route");
      const chunks = [];
      for await (const chunk of routeMessage(ctx, "现在几点了", "neutral")) {
        chunks.push(chunk);
      }

      assert.equal(fastBrainCalls.length, 0);
      assert.equal(slowBrainCalls.length, 0);
      assert.equal(chunks.length, 1);
      assert.match(chunks[0], /^按我这边现在的时间看，现在是 \d{2}:\d{2}。$/);
      assert.deepEqual(ctx.history, [
        { role: "user", content: "现在几点了" },
        { role: "assistant", content: chunks[0] },
      ]);
    } finally {
      restore();
      restoreEnv();
    }
  });

  it("prefers the client timezone wording when the session has a valid client timezone", async () => {
    const restoreEnv = applyEnv({ REMI_TIME_CAPABILITY_ENABLED: "1" });
    const { routeMessage, restore } = loadMockedRouteMessage({
      fastBrainStream: async function* () {
        yield "llm should not run";
      },
      runSlowBrain: async () => {},
    });

    try {
      const ctx = new RemiSessionContext("time-capability-client-tz");
      ctx.setClientContext({ timeZone: "America/Los_Angeles", locale: "en-US" });
      const chunks = [];
      for await (const chunk of routeMessage(ctx, "今天几号", "neutral")) {
        chunks.push(chunk);
      }

      assert.equal(chunks.length, 1);
      assert.match(chunks[0], /^按你那边现在的日期看，今天是 \d{4} 年 \d{1,2} 月 \d{1,2} 日。$/);
    } finally {
      restore();
      restoreEnv();
    }
  });

  it("keeps the existing interrupted-reply short-circuit ahead of time handling", async () => {
    const restoreEnv = applyEnv({ REMI_TIME_CAPABILITY_ENABLED: "1" });
    const { routeMessage, restore } = loadMockedRouteMessage({
      fastBrainStream: async function* () {
        yield "llm should not run";
      },
      runSlowBrain: async () => {},
    });

    try {
      const ctx = new RemiSessionContext("time-capability-interrupted");
      ctx.lastInterruptedReply = "刚才在说 turn-taking 的接话时机。";
      const chunks = [];
      for await (const chunk of routeMessage(ctx, "刚才说到哪了", "neutral")) {
        chunks.push(chunk);
      }

      assert.deepEqual(chunks, ["我刚才说到：刚才在说 turn-taking 的接话时机。"]);
    } finally {
      restore();
      restoreEnv();
    }
  });

  it("falls back to the normal route when the capability is disabled", async () => {
    const restoreEnv = applyEnv({ REMI_TIME_CAPABILITY_ENABLED: "0" });
    const fastBrainCalls = [];
    const slowBrainCalls = [];
    const { routeMessage, restore } = loadMockedRouteMessage({
      fastBrainStream: async function* (...args) {
        fastBrainCalls.push(args);
        yield "主链路回复";
      },
      runSlowBrain: async (...args) => {
        slowBrainCalls.push(args);
      },
    });

    try {
      const ctx = new RemiSessionContext("time-capability-disabled");
      const chunks = [];
      for await (const chunk of routeMessage(ctx, "现在几点了", "neutral")) {
        chunks.push(chunk);
      }

      assert.deepEqual(chunks, ["主链路回复"]);
      assert.equal(fastBrainCalls.length, 1);
      assert.equal(slowBrainCalls.length, 1);
    } finally {
      restore();
      restoreEnv();
    }
  });
});
