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
  const fastBrainModulePath = path.resolve(__dirname, "../../brains/reply_stream.ts");
  const brainRouterModulePath = path.resolve(__dirname, "../../brains/context_orchestrator.ts");
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
    const ctx = new RemiSessionContext("memory-overlay-route");
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
    const ctx = new RemiSessionContext("memory-overlay-relevant");
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
      assert.ok(captured[0].memory.length >= 2);
      assert.equal(captured[0].memory[0].key, "名字");
      assert.equal(captured[0].memory[1].key, "城市");
    } finally {
      restore();
      restoreEnv();
    }
  });

  it("injects shared-moment memory and proactive/style hints without flooding the fast path", async () => {
    const restoreEnv = applyEnv({
      MAX_PROMPT_MEMORY_ENTRIES: "4",
      REMI_PROACTIVE_PROMPT_ENABLED: "1",
      REMI_RELATIONSHIP_STYLE_GUIDANCE_ENABLED: "1",
    });
    const ctx = new RemiSessionContext("memory-overlay-shared-moment");
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
      assert.ok(captured[0].memory.length >= 1);
      assert.ok(captured[0].strategyHints.includes("【主动提起候选】"));
      assert.ok(captured[0].strategyHints.includes("【实时连续性】"));
      assert.ok(captured[0].strategyHints.includes("【语气合同】"));
    } finally {
      restore();
      restoreEnv();
    }
  });

  it("keeps pure greeting turns from pulling heavy narrative memory into prompt memory", async () => {
    const restoreEnv = applyEnv({
      REMI_SLOW_BRAIN_ENABLED: "0",
      REMI_PROACTIVE_PROMPT_ENABLED: "1",
      REMI_RELATIONSHIP_STYLE_GUIDANCE_ENABLED: "1",
    });
    const ctx = new RemiSessionContext("memory-overlay-light-greeting");
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
        key: "债务来源及金额",
        value: "点点追电瓶车碰到他人，家里赔了十几万。",
        importance: 0.96,
        accessCount: 0,
        createdAt: 130,
        lastAccessedAt: 380,
      },
      {
        key: "对Remi安慰能力的评价",
        value: "觉得Remi不会安慰人。",
        importance: 0.92,
        accessCount: 0,
        createdAt: 140,
        lastAccessedAt: 370,
      },
    ]);
    ctx.memory.attachPersistent(repo);
    await ctx.memory.hydrateFromPersistent(12);
    ctx.slowBrain.recordTurn();
    ctx.slowBrain.recordTurn();
    ctx.slowBrain.bumpRelationship({ familiarityDelta: 0.55, emotionalBondDelta: 0.46 });
    ctx.slowBrain.setConversationSummary("点点闯祸后的赔偿和还债压力一直压着你。");
    ctx.slowBrain.setProactiveTopics(["点点那件事后来怎么样了"]);
    ctx.slowBrain.recordSharedMoment({
      summary: "上次你提到点点闯祸赔了十几万，现在一想到那笔债心里就堵得慌。",
      topic: "债务",
      mood: "疲惫/烦躁",
      hook: "点点那件事后来怎么样了",
      createdAt: 620,
      unresolved: true,
    });

    const captured = [];
    const { routeMessage, restore } = loadMockedRouteMessage(async function* (input) {
      captured.push({
        memory: input.memory.map((entry) => ({ ...entry })),
        strategyHints: input.strategyHints,
      });
      yield "我在。";
    });

    try {
      const chunks = [];
      for await (const chunk of routeMessage(ctx, "你好呀", "neutral")) {
        chunks.push(chunk);
      }

      assert.deepEqual(chunks, ["我在。"]);
      assert.equal(captured.length, 1);
      assert.deepEqual(
        captured[0].memory.map((entry) => entry.key),
        ["名字", "城市"],
      );
      assert.equal(captured[0].strategyHints.includes("【实时连续性】"), false);
      assert.equal(captured[0].strategyHints.includes("【主动提起候选】"), false);
      assert.equal(captured[0].strategyHints.includes("【共同经历提醒】"), false);
      assert.equal(captured[0].strategyHints.includes("【当前未完主线】"), false);
      assert.equal(captured[0].strategyHints.includes("【对话摘要】"), false);
    } finally {
      restore();
      restoreEnv();
    }
  });

  it("does not repeat the same proactive or shared-moment cue on back-to-back turns", async () => {
    const restoreEnv = applyEnv({
      REMI_SLOW_BRAIN_ENABLED: "0",
      REMI_PROACTIVE_PROMPT_ENABLED: "1",
      REMI_RELATIONSHIP_STYLE_GUIDANCE_ENABLED: "1",
      REMI_PROACTIVE_COOLDOWN_TURNS: "10",
      REMI_SHARED_MOMENT_COOLDOWN_TURNS: "10",
    });
    const ctx = new RemiSessionContext("memory-overlay-no-repeat");
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
      REMI_SLOW_BRAIN_ENABLED: "0",
      REMI_PROACTIVE_PROMPT_ENABLED: "1",
      REMI_RELATIONSHIP_STYLE_GUIDANCE_ENABLED: "1",
    });
    const ctx = new RemiSessionContext("memory-overlay-direct-question");
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
      captured.push({
        strategyHints: input.strategyHints,
        slowBrainContext: input.slowBrainContext,
      });
      yield "先回答你";
    });

    try {
      for await (const _ of routeMessage(ctx, "你觉得我现在应该直接辞职，还是先把这周撑过去？", "neutral")) {
        // consume
      }

      assert.equal(captured.length, 1);
      assert.equal(captured[0].strategyHints.includes("【主动提起候选】"), false);
      assert.equal(captured[0].strategyHints.includes("【共同经历提醒】"), false);
      assert.ok(
        captured[0].strategyHints.includes("【响应策略】") ||
        captured[0].strategyHints.includes("【本轮回复合同】"),
      );
      assert.equal(captured[0].strategyHints.includes("【关系表达风格】"), false);
      assert.ok(
        captured[0].strategyHints.includes("【当前未完主线】") ||
        captured[0].strategyHints.includes("【对话摘要】"),
      );
      assert.equal(Boolean(captured[0].slowBrainContext), false);
    } finally {
      restore();
      restoreEnv();
    }
  });

  it("updates the response strategy when the user adds decision-changing constraints", async () => {
    const restoreEnv = applyEnv({
      REMI_SLOW_BRAIN_ENABLED: "0",
      REMI_STRUCTURED_TURN_INTERPRETER: "on",
    });
    const ctx = new RemiSessionContext("memory-overlay-constraint-update");
    ctx.history.push({ role: "user", content: "我是不是该辞职" });
    ctx.history.push({ role: "assistant", content: "我倾向于你先别裸辞，先看有没有更稳的下家。" });

    const captured = [];
    const { routeMessage, restore } = loadMockedRouteMessage(async function* (input) {
      captured.push({
        strategyHints: input.strategyHints,
        slowBrainContext: input.slowBrainContext,
      });
      yield "先把这条现实约束算进去。";
    });

    try {
      for await (const _ of routeMessage(ctx, "攒了两年半，还欠花呗两万五", "neutral")) {
        // consume
      }

      assert.equal(captured.length, 1);
      assert.ok(captured[0].strategyHints.includes("【响应策略】"));
      assert.ok(captured[0].strategyHints.includes("补充现实约束"));
      assert.ok(captured[0].strategyHints.includes("更新判断"));
      assert.equal(captured[0].strategyHints.includes("【主动提起候选】"), false);
      assert.equal(Boolean(captured[0].slowBrainContext), false);
    } finally {
      restore();
      restoreEnv();
    }
  });

  it("does not persist fallback assistant reply into formal history", async () => {
    const restoreEnv = applyEnv({ REMI_SLOW_BRAIN_ENABLED: "1" });
    const ctx = new RemiSessionContext("memory-overlay-fallback-guard");
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

  it("keeps ordinary text fast-path priority context compact without unrelated proactive callbacks", async () => {
    const restoreEnv = applyEnv({
      REMI_SLOW_BRAIN_ENABLED: "0",
      REMI_PROACTIVE_PROMPT_ENABLED: "1",
      REMI_RELATIONSHIP_STYLE_GUIDANCE_ENABLED: "1",
    });
    const ctx = new RemiSessionContext("memory-overlay-compact-priority");
    ctx.slowBrain.recordTurn();
    ctx.slowBrain.recordTurn();
    ctx.slowBrain.recordTurn();
    ctx.slowBrain.bumpRelationship({ familiarityDelta: 0.5, emotionalBondDelta: 0.42 });
    ctx.slowBrain.setConversationSummary("最近主要在聊工作上的委屈和去留判断。");
    ctx.slowBrain.setProactiveTopics(["工作那件事后来缓一点了吗"]);
    ctx.slowBrain.recordSharedMoment({
      summary: "上次你提到工作上被误解后一直很委屈。",
      topic: "工作",
      mood: "委屈",
      hook: "工作那件事后来缓一点了吗",
      createdAt: 620,
      unresolved: true,
    });

    const captured = [];
    const { routeMessage, restore } = loadMockedRouteMessage(async function* (input) {
      captured.push({
        strategyHints: input.strategyHints,
        slowBrainContext: input.slowBrainContext,
      });
      yield "先接住了";
    });

    try {
      for await (const _ of routeMessage(ctx, "我今天中午吃了面", "neutral")) {
        // consume
      }

      assert.equal(captured.length, 1);
      assert.ok(captured[0].strategyHints.includes("【语气合同】"));
      assert.equal(captured[0].strategyHints.includes("【主动提起候选】"), false);
      assert.equal(captured[0].strategyHints.includes("【共同经历提醒】"), false);
      assert.equal(captured[0].strategyHints.includes("【关系表达风格】"), false);
      assert.equal(Boolean(captured[0].slowBrainContext), false);
    } finally {
      restore();
      restoreEnv();
    }
  });

  it("suppresses heavy relationship recall on lightweight greetings", async () => {
    const restoreEnv = applyEnv({
      REMI_SLOW_BRAIN_ENABLED: "0",
      MAX_PROMPT_MEMORY_ENTRIES: "5",
    });
    const ctx = new RemiSessionContext("memory-overlay-light-greeting");
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
    ]);
    ctx.memory.attachPersistent(repo);
    await ctx.memory.hydrateFromPersistent(12);
    ctx.slowBrain.recordTurn();
    ctx.slowBrain.recordTurn();
    ctx.slowBrain.bumpRelationship({ familiarityDelta: 0.5, emotionalBondDelta: 0.46 });
    ctx.slowBrain.setConversationSummary("最近主要在聊点点闯祸后的赔偿压力和还债。");
    ctx.slowBrain.setProactiveTopics(["点点那件事后来缓一点了吗"]);
    ctx.slowBrain.recordSharedMoment({
      summary: "上次你提到点点追电瓶车导致赔偿，现在还在还债。",
      topic: "债务",
      mood: "疲惫/烦躁",
      hook: "点点那件事后来缓一点了吗",
      createdAt: 620,
      unresolved: true,
      kind: "stress",
      salience: 0.88,
    });

    const captured = [];
    const { routeMessage, restore } = loadMockedRouteMessage(async function* (input) {
      captured.push({
        memory: input.memory.map((entry) => ({ ...entry })),
      });
      yield "我在。";
    });

    try {
      for await (const _ of routeMessage(ctx, "你好呀", "neutral")) {
        // consume
      }

      assert.equal(captured.length, 1);
      assert.deepEqual(
        captured[0].memory.map((entry) => entry.key),
        ["名字", "城市"],
      );
    } finally {
      restore();
      restoreEnv();
    }
  });

  it("applies llm-first style intent into the live override and stores only weak cross-session notes", async () => {
    const restoreEnv = applyEnv({
      REMI_SLOW_BRAIN_ENABLED: "0",
    });
    const ctx = new RemiSessionContext("memory-overlay-style-intent");
    const captured = [];
    const { routeMessage, restore } = loadMockedRouteMessage(async function* (input) {
      captured.push({
        slowBrainContext: input.slowBrainContext,
        styleOverride: input.persona.liveState.styleOverride,
      });
      yield "行，那我先别这么端着。";
    });

    try {
      for await (const _ of routeMessage(ctx, "你讲话像自己人一点，别这么像客服。", "neutral", undefined, {
        inputSource: "text",
        structuredAnalysis: {
          interpretation: {
            userAct: "emotional_share",
            answerObligation: "followup_ok",
            responseMode: "attune_then_answer",
            emotionalState: {
              valence: "mixed",
              intensity: "low",
              feltNeeds: ["validation"],
            },
            relationalPosture: "warm",
            topicUpdate: {
              kind: "none",
            },
            sceneState: "not_in_scene",
            boundaryState: "none",
            followupPermission: "none",
            styleIntent: {
              humorBoost: false,
              teasingLevel: "off",
              assistantySuppression: true,
              familiarityBoost: true,
              romanceBoost: false,
              roleplayStyle: null,
              confidence: 0.88,
            },
            confidence: 0.91,
          },
          policy: {
            openingMove: "gentle_attunement",
            directness: "medium",
            warmth: "high",
            questionBudget: 1,
            shouldMirrorEmotion: true,
            shouldGiveJudgment: false,
            shouldUpdateDecisionContext: false,
            bans: ["no_assistantese"],
          },
          source: "llm_structured",
          latencyMs: 36,
          timedOut: false,
          mode: "on",
          used: true,
        },
      })) {
        // consume
      }

      assert.equal(captured.length, 1);
      assert.ok(captured[0].styleOverride);
      assert.equal(captured[0].styleOverride.assistantySuppression, true);
      assert.equal(captured[0].styleOverride.familiarityBoost, true);
      assert.equal(captured[0].styleOverride.remainingTurns, 6);
      assert.equal(
        Boolean(captured[0].slowBrainContext?.includes("【回复风格偏好（候选）】")),
        false,
      );

      const snapshot = ctx.slowBrain.getSnapshot();
      assert.deepEqual(snapshot.userProfile.responseStyleNotes, [
        "最近用户更想让你少一点助手腔，像熟一点的人那样自然接话。",
      ]);
      assert.ok(ctx.persona.liveState.styleOverride);
      assert.equal(ctx.persona.liveState.styleOverride.assistantySuppression, true);
    } finally {
      restore();
      restoreEnv();
    }
  });

  it("clears the live style override and weak response-style notes on explicit reset phrasing", async () => {
    const restoreEnv = applyEnv({
      REMI_SLOW_BRAIN_ENABLED: "0",
    });
    const ctx = new RemiSessionContext("memory-overlay-style-clear");
    ctx.persona.liveState.styleOverride = {
      humorBoost: true,
      teasingMode: "light",
      assistantySuppression: true,
      familiarityBoost: true,
      romanceBoost: false,
      roleplayStyle: null,
      remainingTurns: 4,
      sourceText: "你先毒舌一点，像自己人一点。",
    };
    ctx.slowBrain.addResponseStyleNote("最近用户更想让你少一点助手腔。");

    const captured = [];
    const { routeMessage, restore } = loadMockedRouteMessage(async function* (input) {
      captured.push({
        slowBrainContext: input.slowBrainContext,
        styleOverride: input.persona.liveState.styleOverride,
      });
      yield "好，那我先收回来。";
    });

    try {
      for await (const _ of routeMessage(ctx, "恢复正常，正常跟我说就行，不用演了。", "neutral", undefined, {
        inputSource: "text",
        structuredAnalysis: null,
      })) {
        // consume
      }

      assert.equal(captured.length, 1);
      assert.equal(captured[0].styleOverride, null);
      assert.equal(
        Boolean(captured[0].slowBrainContext?.includes("【回复风格偏好（候选）】")),
        false,
      );
      assert.equal(ctx.persona.liveState.styleOverride, null);
      assert.deepEqual(ctx.slowBrain.getSnapshot().userProfile.responseStyleNotes, []);
    } finally {
      restore();
      restoreEnv();
    }
  });

  it("injects and commits working memory only after a successful handled reply", async () => {
    const restoreEnv = applyEnv({
      REMI_SLOW_BRAIN_ENABLED: "0",
      REMI_WORKING_MEMORY_ENABLED: "1",
    });
    const ctx = new RemiSessionContext("memory-overlay-working-memory");

    const captured = [];
    const { routeMessage, restore } = loadMockedRouteMessage(async function* (input) {
      captured.push({
        currentContext: input.currentContext,
      });
      yield "先按这个判断。";
    });

    try {
      for await (const _ of routeMessage(ctx, "我到底该不该先把花呗还了，我还欠两万五", "neutral", undefined, {
        inputSource: "text",
        structuredAnalysis: {
          interpretation: {
            sceneType: "practical_judgment",
            userAct: "decision_seek",
            answerObligation: "answer_then_followup",
            responseMode: "answer_first",
            emotionalState: {
              valence: "mixed",
              intensity: "medium",
              feltNeeds: ["clarity"],
            },
            relationalPosture: "serious",
            topicUpdate: {
              kind: "constraint_update",
              label: "债务",
            },
            sceneState: "not_in_scene",
            boundaryState: "none",
            followupPermission: "none",
            confidence: 0.9,
          },
          policy: {
            openingMove: "direct_answer",
            directness: "high",
            warmth: "high",
            questionBudget: 0,
            shouldMirrorEmotion: true,
            shouldGiveJudgment: true,
            shouldUpdateDecisionContext: true,
            bans: ["no_assistantese", "no_topic_pivot", "no_shallow_reassurance"],
          },
          source: "llm_structured",
          latencyMs: 120,
          timedOut: false,
          mode: "on",
          used: true,
        },
      })) {
        // consume
      }

      assert.equal(captured.length, 1);
      assert.ok(captured[0].currentContext.includes("【当前上下文】"));
      assert.ok(captured[0].currentContext.includes("当前主线"));
      assert.ok(captured[0].currentContext.includes("当前需求"));
      assert.ok(captured[0].currentContext.includes("现实约束"));
      assert.ok(captured[0].currentContext.includes("不要做"));

      const snapshot = ctx.slowBrain.getSnapshot();
      assert.ok(snapshot.workingMemory);
      assert.equal(snapshot.workingMemory.sceneState, "decision");
      assert.equal(snapshot.workingMemory.currentConstraints.length > 0, true);
    } finally {
      restore();
      restoreEnv();
    }
  });

  it("keeps current working memory on short practical follow-ups instead of dropping back to fast-path small talk", async () => {
    const restoreEnv = applyEnv({
      REMI_SLOW_BRAIN_ENABLED: "0",
      REMI_WORKING_MEMORY_ENABLED: "1",
      REMI_STRUCTURED_TURN_INTERPRETER: "on",
      key: undefined,
      base_url: undefined,
      model: undefined,
    });
    const ctx = new RemiSessionContext("memory-overlay-practical-followup");

    const captured = [];
    const { routeMessage, restore } = loadMockedRouteMessage(async function* (input) {
      captured.push({
        userMessage: input.userMessage,
        currentContext: input.currentContext,
      });
      yield "先按这个来。";
    });

    try {
      for await (const _ of routeMessage(ctx, "我每个月挣三千，得还到啥时候啊", "neutral", undefined, {
        inputSource: "text",
      })) {
        // consume
      }
      for await (const _ of routeMessage(ctx, "你帮我算算", "neutral", undefined, {
        inputSource: "text",
      })) {
        // consume
      }

      assert.equal(captured.length, 2);
      assert.ok(captured[0].currentContext.includes("【当前上下文】"));
      assert.ok(captured[1].currentContext.includes("【当前上下文】"));
      assert.ok(captured[1].currentContext.includes("当前主线"));
      assert.ok(captured[1].currentContext.includes("不要轻飘安慰或无依据粗算"));
    } finally {
      restore();
      restoreEnv();
    }
  });
});
