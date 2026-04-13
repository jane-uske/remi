const assert = require("assert").strict;
const path = require("path");

const { RemSessionContext } = require("../../brains/rem_session_context");

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

function createPersistentRepo(entries = []) {
  const hooks = { getAllCalls: 0 };
  return {
    hooks,
    repo: {
      async upsert() {},
      async getAll() {
        hooks.getAllCalls += 1;
        return entries.map((entry) => ({ ...entry }));
      },
      async getByKey(key) {
        const found = entries.find((entry) => entry.key === key);
        return found ? { ...found } : null;
      },
      async delete() {},
      async touch() {},
      async getStale() {
        return [];
      },
    },
  };
}

function loadMockedRouteMessage(fastBrainStream) {
  const fastBrainModulePath = path.resolve(__dirname, "../../brains/fast_brain.ts");
  const brainRouterModulePath = path.resolve(__dirname, "../../brains/brain_router.ts");
  const fastBrainModule = require(fastBrainModulePath);
  const originalFastBrainStream = fastBrainModule.fastBrainStream;

  fastBrainModule.fastBrainStream = fastBrainStream;
  delete require.cache[brainRouterModulePath];
  const { routeMessage } = require(brainRouterModulePath);

  return {
    routeMessage,
    restore() {
      fastBrainModule.fastBrainStream = originalFastBrainStream;
      delete require.cache[brainRouterModulePath];
    },
  };
}

describe("routeMessage with session memory overlay", () => {
  it("uses hydrated local memory without re-reading persistent storage on each prompt build", async () => {
    const ctx = new RemSessionContext("memory-overlay-route");
    const { hooks, repo } = createPersistentRepo([
      {
        key: "名字",
        value: "小满",
        importance: 0.5,
        accessCount: 0,
        createdAt: 100,
        lastAccessedAt: 300,
      },
    ]);
    ctx.memory.attachPersistent(repo);
    await ctx.memory.hydrateFromPersistent(12);

    const captured = [];
    const { routeMessage, restore } = loadMockedRouteMessage(async function* (input) {
      captured.push({
        memory: input.memory.map((entry) => ({ ...entry })),
      });
      yield "记住啦";
    });

    try {
      const chunks = [];
      for await (const chunk of routeMessage(ctx, "我们继续聊", "neutral")) {
        chunks.push(chunk);
      }

      assert.equal(hooks.getAllCalls, 1);
      assert.deepEqual(chunks, ["记住啦"]);
      assert.equal(captured.length, 1);
      assert.deepEqual(captured[0].memory, [{ key: "名字", value: "小满" }]);
    } finally {
      restore();
    }
  });

  it("limits prompt memory to relationship-relevant facts instead of flooding all facts", async () => {
    const restoreEnv = applyEnv({ MAX_PROMPT_MEMORY_ENTRIES: "4" });
    const ctx = new RemSessionContext("memory-overlay-relevant");
    const { repo } = createPersistentRepo([
      {
        key: "名字",
        value: "小满",
        importance: 0.9,
        accessCount: 0,
        createdAt: 100,
        lastAccessedAt: 300,
      },
      {
        key: "城市",
        value: "杭州",
        importance: 0.7,
        accessCount: 0,
        createdAt: 110,
        lastAccessedAt: 290,
      },
      {
        key: "运动喜好",
        value: "夜跑",
        importance: 0.6,
        accessCount: 0,
        createdAt: 120,
        lastAccessedAt: 310,
      },
      {
        key: "睡眠困扰",
        value: "失眠",
        importance: 0.8,
        accessCount: 0,
        createdAt: 130,
        lastAccessedAt: 320,
      },
      {
        key: "收藏歌手",
        value: "王菲",
        importance: 0.95,
        accessCount: 0,
        createdAt: 140,
        lastAccessedAt: 330,
      },
    ]);
    ctx.memory.attachPersistent(repo);
    await ctx.memory.hydrateFromPersistent(12);
    ctx.slowBrain.recordTurn();
    ctx.slowBrain.touchTopic("夜跑", "positive");
    ctx.slowBrain.touchTopic("睡眠", "negative");
    ctx.slowBrain.setConversationSummary("最近一直在聊夜跑和睡眠状态。");
    ctx.slowBrain.setProactiveTopics(["昨晚睡得怎么样"]);

    const captured = [];
    const { routeMessage, restore } = loadMockedRouteMessage(async function* (input) {
      captured.push({
        memory: input.memory.map((entry) => ({ ...entry })),
        strategyHints: input.strategyHints,
      });
      yield "接住了";
    });

    try {
      const chunks = [];
      for await (const chunk of routeMessage(ctx, "昨晚夜跑完还是有点失眠", "neutral")) {
        chunks.push(chunk);
      }

      assert.deepEqual(chunks, ["接住了"]);
      assert.equal(captured.length, 1);
      assert.equal(captured[0].memory.length, 4);
      assert.deepEqual(
        captured[0].memory.map((entry) => entry.key),
        ["名字", "城市", "运动喜好", "睡眠困扰"],
      );
    } finally {
      restore();
      restoreEnv();
    }
  });

  it("injects shared-moment memory and proactive/style hints without flooding the fast path", async () => {
    const restoreEnv = applyEnv({
      MAX_PROMPT_MEMORY_ENTRIES: "4",
      REM_PROACTIVE_PROMPT_ENABLED: "1",
      REM_RELATIONSHIP_STYLE_GUIDANCE_ENABLED: "1",
    });
    const ctx = new RemSessionContext("memory-overlay-shared-moment");
    const { repo } = createPersistentRepo([
      {
        key: "名字",
        value: "小满",
        importance: 0.9,
        accessCount: 0,
        createdAt: 100,
        lastAccessedAt: 300,
      },
      {
        key: "城市",
        value: "杭州",
        importance: 0.7,
        accessCount: 0,
        createdAt: 110,
        lastAccessedAt: 290,
      },
      {
        key: "收藏歌手",
        value: "王菲",
        importance: 0.95,
        accessCount: 0,
        createdAt: 140,
        lastAccessedAt: 330,
      },
    ]);
    ctx.memory.attachPersistent(repo);
    await ctx.memory.hydrateFromPersistent(12);
    ctx.slowBrain.recordTurn();
    ctx.slowBrain.recordTurn();
    ctx.slowBrain.bumpRelationship({ familiarityDelta: 0.45, emotionalBondDelta: 0.5 });
    ctx.slowBrain.touchTopic("睡眠", "negative");
    ctx.slowBrain.setConversationSummary("最近一直在聊失眠和晚上的状态。");
    ctx.slowBrain.setProactiveTopics(["昨晚睡得怎么样"]);
    ctx.slowBrain.recordSharedMoment({
      summary: "上次你提到失眠反复醒来，我们还聊到睡前散步会不会好一点。",
      topic: "睡眠",
      mood: "疲惫/烦躁",
      hook: "昨晚睡得怎么样",
      createdAt: 500,
    });

    const captured = [];
    const { routeMessage, restore } = loadMockedRouteMessage(async function* (input) {
      captured.push({
        memory: input.memory.map((entry) => ({ ...entry })),
        strategyHints: input.strategyHints,
      });
      yield "我记得";
    });

    try {
      const chunks = [];
      for await (const chunk of routeMessage(ctx, "昨晚还是没睡好", "sad")) {
        chunks.push(chunk);
      }

      assert.deepEqual(chunks, ["我记得"]);
      assert.equal(captured.length, 1);
      assert.equal(
        captured[0].memory.some((entry) => entry.key === "最近共同经历"),
        true,
      );
      assert.ok(captured[0].strategyHints.includes("【主动提起候选】"));
      assert.ok(captured[0].strategyHints.includes("【关系表达风格】"));
      assert.ok(captured[0].strategyHints.includes("【实时连续性】"));
    } finally {
      restore();
      restoreEnv();
    }
  });

  it("does not repeat the same proactive or shared-moment cue on back-to-back turns", async () => {
    const restoreEnv = applyEnv({
      REM_SLOW_BRAIN_ENABLED: "0",
      REM_PROACTIVE_PROMPT_ENABLED: "1",
      REM_RELATIONSHIP_STYLE_GUIDANCE_ENABLED: "1",
      REM_PROACTIVE_COOLDOWN_TURNS: "10",
      REM_SHARED_MOMENT_COOLDOWN_TURNS: "10",
    });
    const ctx = new RemSessionContext("memory-overlay-no-repeat");
    ctx.slowBrain.recordTurn();
    ctx.slowBrain.recordTurn();
    ctx.slowBrain.bumpRelationship({ familiarityDelta: 0.5, emotionalBondDelta: 0.45 });
    ctx.slowBrain.setProactiveTopics(["昨晚睡得怎么样"]);
    ctx.slowBrain.recordSharedMoment({
      summary: "上次你提到失眠反复醒来，我们还聊到睡前散步会不会好一点。",
      topic: "睡眠",
      mood: "疲惫/烦躁",
      hook: "昨晚睡得怎么样",
      createdAt: 500,
    });

    const captured = [];
    const { routeMessage, restore } = loadMockedRouteMessage(async function* (input) {
      captured.push(input.strategyHints);
      yield "接住了";
    });

    try {
      for await (const _ of routeMessage(ctx, "嗯", "neutral")) {
        // consume
      }
      for await (const _ of routeMessage(ctx, "还没缓过来", "sad")) {
        // consume
      }

      assert.equal(captured.length, 2);
      assert.ok(captured[0].includes("【主动提起候选】"));
      assert.equal(captured[1].includes("【主动提起候选】"), false);
      assert.equal(captured[1].includes("【共同经历提醒】"), false);
      assert.equal(captured[1].includes("【实时连续性】"), false);
    } finally {
      restore();
      restoreEnv();
    }
  });

  it("suppresses proactive callbacks when the user is asking a direct new question", async () => {
    const restoreEnv = applyEnv({
      REM_SLOW_BRAIN_ENABLED: "0",
      REM_PROACTIVE_PROMPT_ENABLED: "1",
      REM_RELATIONSHIP_STYLE_GUIDANCE_ENABLED: "1",
    });
    const ctx = new RemSessionContext("memory-overlay-direct-question");
    ctx.slowBrain.recordTurn();
    ctx.slowBrain.recordTurn();
    ctx.slowBrain.recordTurn();
    ctx.slowBrain.bumpRelationship({ familiarityDelta: 0.6, emotionalBondDelta: 0.5 });
    ctx.slowBrain.setConversationSummary("最近主要在聊睡眠状态和工作压力。");
    ctx.slowBrain.setProactiveTopics(["昨晚睡得怎么样", "工作那件事后来缓一点了吗"]);
    ctx.slowBrain.recordSharedMoment({
      summary: "上次你提到工作上被误解后很委屈，我们还聊到你其实最难受的是没人理解。",
      topic: "工作",
      mood: "委屈",
      hook: "工作那件事后来缓一点了吗",
      createdAt: 600,
    });

    const captured = [];
    const { routeMessage, restore } = loadMockedRouteMessage(async function* (input) {
      captured.push(input.strategyHints);
      yield "先回答你";
    });

    try {
      for await (const _ of routeMessage(ctx, "你觉得我现在应该直接辞职，还是先把这周撑过去？", "neutral")) {
        // consume
      }

      assert.equal(captured.length, 1);
      assert.equal(captured[0].includes("【主动提起候选】"), false);
      assert.equal(captured[0].includes("【共同经历提醒】"), false);
      assert.equal(captured[0].includes("【关系表达风格】"), true);
    } finally {
      restore();
      restoreEnv();
    }
  });

  it("does not persist fallback assistant reply into formal history", async () => {
    const restoreEnv = applyEnv({ REM_SLOW_BRAIN_ENABLED: "1" });
    const ctx = new RemSessionContext("memory-overlay-fallback-guard");
    const { routeMessage, restore } = loadMockedRouteMessage(async function* () {
      yield "啊…出了点问题，等我缓缓再试试…";
    });

    try {
      const chunks = [];
      for await (const chunk of routeMessage(ctx, "111", "neutral")) {
        chunks.push(chunk);
      }

      assert.deepEqual(chunks, ["啊…出了点问题，等我缓缓再试试…"]);
      assert.equal(ctx.history.length, 1);
      assert.deepEqual(ctx.history[0], { role: "user", content: "111" });
    } finally {
      restore();
      restoreEnv();
    }
  });
});
