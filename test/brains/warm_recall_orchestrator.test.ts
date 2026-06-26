const assert = require("assert").strict;
const path = require("path");
const { resetConfig } = require("../../server/config");
const { RemiSessionContext } = require("../../brains/remi_session_context");

function applyEnv(values) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetConfig();
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetConfig();
  };
}

// Mock every LLM touchpoint so the recall-reuse path is deterministic and offline.
function loadHarness({ onRecall }) {
  const fastPath = path.resolve(__dirname, "../../brains/reply_stream.ts");
  const slowPath = path.resolve(__dirname, "../../brains/background_analysis.ts");
  const memPath = path.resolve(__dirname, "../../memory/memory_agent.ts");
  const turnPath = path.resolve(__dirname, "../../brain/turn_interpreter.ts");
  const orchPath = path.resolve(__dirname, "../../brains/context_orchestrator.ts");

  const fastMod = require(fastPath);
  const slowMod = require(slowPath);
  const memMod = require(memPath);
  const turnMod = require(turnPath);

  const orig = {
    fast: fastMod.fastBrainStream,
    slow: slowMod.runSlowBrain,
    recall: memMod.retrievePromptMemory,
    analyze: turnMod.analyzeTurn,
  };

  let captured = null;
  fastMod.fastBrainStream = async function* (opts) {
    captured = opts;
    yield "好";
  };
  slowMod.runSlowBrain = async () => {};
  turnMod.analyzeTurn = async () => null;
  memMod.retrievePromptMemory = async (...args) => {
    onRecall();
    return orig.recall(...args);
  };

  delete require.cache[orchPath];
  const { routeMessage } = require(orchPath);

  return {
    routeMessage,
    getCaptured: () => captured,
    restore() {
      fastMod.fastBrainStream = orig.fast;
      slowMod.runSlowBrain = orig.slow;
      memMod.retrievePromptMemory = orig.recall;
      turnMod.analyzeTurn = orig.analyze;
      delete require.cache[orchPath];
    },
  };
}

async function drain(gen) {
  const chunks = [];
  for await (const c of gen) chunks.push(c);
  return chunks;
}

const WARM_MEM = [{ key: "当前未完主线", value: "工作压力：项目延期" }];

describe("warm recall in context_orchestrator (VOICE_BEST_PRACTICES 杠杆1)", () => {
  it("reuses warm recall and skips live recall when flag on + topic overlaps", async function () {
    this.timeout(5000);
    const restoreEnv = applyEnv({ REMI_WARM_RECALL_ENABLED: "1" });
    let recallCalls = 0;
    const h = loadHarness({ onRecall: () => (recallCalls += 1) });
    try {
      const ctx = new RemiSessionContext("warm-on");
      ctx.warmRecall.store("我最近工作压力好大", WARM_MEM);
      await drain(
        h.routeMessage(ctx, "我最近工作压力好大，晚上睡不着", "neutral", undefined, {
          traceId: "warm-1",
        }),
      );
      assert.equal(recallCalls, 0, "warm hit must skip live retrievePromptMemory");
      const cap = h.getCaptured();
      assert.ok(
        cap && Array.isArray(cap.memory) && cap.memory.some((m) => m.key === "当前未完主线"),
        "warm memory should reach the fast brain prompt",
      );
    } finally {
      h.restore();
      restoreEnv();
    }
  });

  it("falls back to live recall when the flag is off (default behavior unchanged)", async function () {
    this.timeout(5000);
    const restoreEnv = applyEnv({ REMI_WARM_RECALL_ENABLED: "0" });
    let recallCalls = 0;
    const h = loadHarness({ onRecall: () => (recallCalls += 1) });
    try {
      const ctx = new RemiSessionContext("warm-off");
      ctx.warmRecall.store("我最近工作压力好大", WARM_MEM);
      await drain(
        h.routeMessage(ctx, "我最近工作压力好大，晚上睡不着", "neutral", undefined, {
          traceId: "warm-2",
        }),
      );
      assert.equal(recallCalls, 1, "flag off must run live recall exactly as before");
    } finally {
      h.restore();
      restoreEnv();
    }
  });

  it("falls back to live recall on topic drift even with flag on", async function () {
    this.timeout(5000);
    const restoreEnv = applyEnv({ REMI_WARM_RECALL_ENABLED: "1" });
    let recallCalls = 0;
    const h = loadHarness({ onRecall: () => (recallCalls += 1) });
    try {
      const ctx = new RemiSessionContext("warm-drift");
      ctx.warmRecall.store("我最近工作压力好大", WARM_MEM);
      await drain(
        h.routeMessage(ctx, "帮我推荐一部周末看的电影", "neutral", undefined, {
          traceId: "warm-3",
        }),
      );
      assert.equal(recallCalls, 1, "topic drift must not reuse stale-topic warm memory");
    } finally {
      h.restore();
      restoreEnv();
    }
  });
});
