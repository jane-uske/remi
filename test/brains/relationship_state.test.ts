const assert = require("assert").strict;
const path = require("path");

const { RemiSessionContext } = require("../../brains/remi_session_context");
const { SlowBrainStore } = require("../../brains/slow_brain_store");
const { fastBrainPredictOnly } = require("../../brains/fast_brain");
const { retrieveMemory } = require("../../memory/memory_agent");
const {
  RELATIONSHIP_STATE_KEY,
  loadPersistentRelationshipState,
  savePersistentRelationshipState,
} = require("../../memory/relationship_state");
const { InMemoryRepository } = require("../../memory/memory_store");

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

function createPersistentRepo() {
  const hooks = { upsertArgs: [] };
  const store = new Map();
  return {
    hooks,
    repo: {
      async upsert(key, value, importance = 0.5) {
        hooks.upsertArgs.push({ key, value, importance });
        store.set(key, {
          key,
          value,
          importance,
          accessCount: 0,
          createdAt: Date.now(),
          lastAccessedAt: Date.now(),
        });
      },
      async getAll() {
        return [...store.values()].map((entry) => ({ ...entry }));
      },
      async getByKey(key) {
        const found = store.get(key);
        return found ? { ...found } : null;
      },
      async delete(key) {
        store.delete(key);
      },
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

describe("relationship state persistence", () => {
  it("round-trips structured relationship state through the memory repository", async () => {
    const { repo, hooks } = createPersistentRepo();
    const store = new SlowBrainStore();
    store.recordTurn();
    store.bumpRelationship({ familiarityDelta: 0.2, emotionalBondDelta: 0.1 });
    store.addInterest("散步");
    store.addPersonalityNote("更愿意晚上慢慢聊");
    store.touchTopic("睡眠", "negative");
    store.recordMood("难过");
    store.setConversationSummary("最近在聊失眠和晚上散步。");
    store.setProactiveTopics(["昨晚睡得怎么样"]);
    store.recordSharedMoment({
      summary: "上次你提到最近睡不太好，我们顺着这个聊了很久。",
      topic: "睡眠",
      mood: "难过",
      hook: "昨晚睡得怎么样",
      kind: "support",
      salience: 0.82,
      unresolved: true,
      createdAt: 120,
    });
    store.recordUserTurnActivity();
    store.recordProactiveOutreach("care", "episode:sleep-line");
    store.recordProactiveOutreach("care", "episode:sleep-line");
    store.markContinuityCueUsed({
      proactiveCandidate: "昨晚睡得怎么样",
      sharedMomentCandidate: "上次你提到最近睡不太好，我们顺着这个聊了很久。",
      turnOffset: 0,
    });

    await savePersistentRelationshipState(repo, store.exportPersistentState(123));
    const loaded = await loadPersistentRelationshipState(repo);
    const persistedPayload = JSON.parse(hooks.upsertArgs[0].value);

    assert.equal(loaded.version, "v1");
    assert.equal(loaded.updatedAt, 123);
    assert.equal(loaded.relationship.turnCount, 1);
    assert.deepEqual(loaded.userProfile.interests, ["散步"]);
    assert.equal(loaded.conversationSummary, "最近在聊失眠和晚上散步。");
    assert.equal(loaded.sharedMoments.length, 1);
    assert.equal(loaded.sharedMoments[0].topic, "睡眠");
    assert.equal(loaded.sharedMoments[0].kind, "support");
    assert.equal(loaded.sharedMoments[0].unresolved, true);
    assert.equal(loaded.sharedMoments[0].recurrenceCount, 1);
    assert.ok(Array.isArray(loaded.sharedMoments[0].semanticKeywords));
    assert.equal("episodes" in persistedPayload, false);
    assert.equal("topicThreads" in persistedPayload, false);
    assert.deepEqual(loaded.episodes, []);
    assert.deepEqual(loaded.topicThreads, []);
    assert.equal(loaded.proactiveLedger.length, 1);
    assert.equal(loaded.proactiveLedger[0].key, "episode:sleep-line");
    assert.equal(loaded.proactiveLedger[0].ignoredCount >= 1, true);
    assert.equal(loaded.proactiveStrategyState.totalProactiveCount, 2);
    assert.equal(loaded.proactiveStrategyState.lastProactiveMode, "care");
    assert.equal(loaded.proactiveStrategyState.ignoredProactiveStreak >= 1, true);
    assert.equal(loaded.proactiveStrategyState.cooldownUntilAt > 0, true);
    assert.equal(loaded.continuityCueState.lastProactiveHook, "昨晚睡得怎么样");
    assert.equal(
      loaded.continuityCueState.lastSharedMomentSummary,
      "上次你提到最近睡不太好，我们顺着这个聊了很久。",
    );
  });

  it("keeps reading legacy episode/thread fields for backward compatibility", async () => {
    const { repo } = createPersistentRepo();
    await repo.upsert(
      RELATIONSHIP_STATE_KEY,
      JSON.stringify({
        version: "v1",
        updatedAt: 123,
        userProfile: {
          interests: [],
          personalityNotes: [],
        },
        relationship: {
          familiarity: 0.4,
          emotionalBond: 0.3,
          turnCount: 5,
          preferredTopics: ["睡眠"],
        },
        topicHistory: [],
        moodTrajectory: [],
        conversationSummary: "最近在聊睡眠。",
        proactiveTopics: [],
        sharedMoments: [],
        continuityCueState: {
          lastProactiveHook: "",
          lastProactiveTurn: -100,
          lastSharedMomentSummary: "",
          lastSharedMomentTurn: -100,
        },
        proactiveLedger: [],
        proactiveStrategyState: {
          lastUserTurnAt: 0,
          lastProactiveAt: 0,
          lastUserReturnAfterProactiveAt: 0,
          consecutiveProactiveCount: 0,
          totalProactiveCount: 0,
          nudgesSinceLastUserTurn: 0,
          retreatLevel: 0,
          ignoredProactiveStreak: 0,
          cooldownUntilAt: 0,
          lastProactiveMode: "",
        },
        episodes: [
          {
            id: "sleep-line",
            layer: "active",
            title: "睡眠",
            summary: "最近睡眠这条线还没过去。",
            sourceTopics: ["睡眠"],
            semanticKeywords: ["失眠"],
            topMood: "疲惫",
            salience: 0.8,
            relationshipWeight: 0.7,
            status: "active",
            firstTurn: 1,
            lastTurn: 5,
            recurrenceCount: 2,
            originMomentSummaries: ["上次你说最近睡不好。"],
          },
        ],
        topicThreads: [
          {
            topic: "睡眠",
            summary: "最近一直在聊睡眠。",
            topMood: "疲惫",
            salience: 0.75,
            relationshipWeight: 0.7,
            unresolvedCount: 1,
            recurrenceCount: 2,
            episodeCount: 1,
            firstTurn: 1,
            timeSpanTurns: 4,
            memoryLayer: "active",
            lastTurn: 5,
          },
        ],
      }),
      1,
    );

    const loaded = await loadPersistentRelationshipState(repo);
    assert.equal(loaded.episodes.length, 1);
    assert.equal(loaded.episodes[0].title, "睡眠");
    assert.equal(loaded.topicThreads.length, 1);
    assert.equal(loaded.topicThreads[0].topic, "睡眠");
  });

  it("filters system relationship entries out of prompt memory retrieval", async () => {
    const repo = new InMemoryRepository();
    await repo.upsert("名字", "阿宁");
    await repo.upsert(RELATIONSHIP_STATE_KEY, '{"version":"v1"}');

    const memories = await retrieveMemory(repo);
    assert.deepEqual(memories, [{ key: "名字", value: "阿宁" }]);
  });

  it("restores relationship continuity without polluting fact memory overlay", async () => {
    const ctx = new RemiSessionContext("relationship-restore");
    const { repo } = createPersistentRepo();
    await repo.upsert("名字", "阿宁", 0.5);
    await repo.upsert(
      RELATIONSHIP_STATE_KEY,
      JSON.stringify({
        version: "v1",
        updatedAt: 123,
        userProfile: {
          interests: ["散步", "夜跑"],
          personalityNotes: ["更愿意晚上聊心事"],
        },
        relationship: {
          familiarity: 0.42,
          emotionalBond: 0.37,
          turnCount: 5,
          preferredTopics: ["睡眠", "散步"],
        },
        topicHistory: [
          { topic: "睡眠", depth: 2, lastTurn: 5, sentiment: "negative" },
          { topic: "散步", depth: 3, lastTurn: 4, sentiment: "positive" },
        ],
        moodTrajectory: [
          { turn: 3, mood: "疲惫/烦躁" },
          { turn: 4, mood: "平静" },
          { turn: 5, mood: "难过" },
        ],
        conversationSummary: "最近一直在聊她晚上睡不好，还有散步能不能让人放松一点。",
        proactiveTopics: ["昨晚睡得怎么样", "今天有没有出去走走"],
        sharedMoments: [
          {
            summary: "上次你提到晚上睡不好，我们还聊到散步会不会有帮助。",
            topic: "睡眠",
            mood: "难过",
            hook: "昨晚睡得怎么样",
            turn: 5,
            createdAt: 200,
          },
        ],
      }),
      1,
    );
    ctx.memory.attachPersistent(repo);
    ctx.attachPersistentRelationshipRepo(repo);

    await ctx.memory.hydrateFromPersistent(12);
    const relationshipState = await loadPersistentRelationshipState(repo);
    ctx.hydratePersistentRelationshipState(relationshipState);

    const memories = await ctx.memory.getAll();
    const snapshot = ctx.slowBrain.getSnapshot();
    assert.deepEqual(memories.map((entry) => [entry.key, entry.value]), [["名字", "阿宁"]]);
    assert.equal(snapshot.conversationSummary, "最近一直在聊她晚上睡不好，还有散步能不能让人放松一点。");
    assert.deepEqual(snapshot.proactiveTopics, ["昨晚睡得怎么样", "今天有没有出去走走"]);
    assert.equal(snapshot.sharedMoments.length, 1);
    assert.equal(snapshot.sharedMoments[0].topic, "睡眠");
    assert.deepEqual(snapshot.moodTrajectory.slice(-3), [
      { turn: 3, mood: "疲惫/烦躁" },
      { turn: 4, mood: "平静" },
      { turn: 5, mood: "难过" },
    ]);
    assert.equal(snapshot.relationship.turnCount, 5);
    assert.equal(snapshot.continuityCueState.lastProactiveHook, "");
    assert.equal(
      ctx.persona.liveState.lastTopicSummary,
      "最近一直在聊她晚上睡不好，还有散步能不能让人放松一点。",
    );
  });

  it("suppresses recently used silence-nudge continuity cues", () => {
    const store = new SlowBrainStore();
    store.recordTurn();
    store.recordTurn();
    store.recordTurn();
    store.recordTurn();
    store.recordTurn();
    store.recordTurn();
    store.bumpRelationship({ familiarityDelta: 0.45, emotionalBondDelta: 0.3 });
    store.setProactiveTopics(["昨晚睡得怎么样"]);
    store.recordSharedMoment({
      summary: "上次你提到失眠反复醒来，我们还聊到睡前散步会不会好一点。",
      topic: "睡眠",
      mood: "疲惫/烦躁",
      hook: "昨晚睡得怎么样",
      createdAt: 500,
    });

    const firstPlan = store.buildSilenceNudgePlan();
    assert.ok(firstPlan);
    assert.equal(firstPlan.sharedMomentCandidate, "上次你提到失眠反复醒来，我们还聊到睡前散步会不会好一点。");

    store.markContinuityCueUsed(firstPlan);
    const secondPlan = store.buildSilenceNudgePlan();
    assert.ok(secondPlan);
    assert.equal(secondPlan.sharedMomentCandidate, undefined);
    assert.equal(secondPlan.proactiveCandidate, undefined);
  });

  it("prefers unresolved supportive episodes for silence nudges", () => {
    const store = new SlowBrainStore();
    store.recordTurn();
    store.recordTurn();
    store.recordTurn();
    store.bumpRelationship({ familiarityDelta: 0.58, emotionalBondDelta: 0.52 });
    store.setProactiveTopics(["今天有没有出去走走"]);
    store.recordSharedMoment({
      summary: "上次你提到工作里被误解之后一直很委屈，我们还聊到那股堵着的感觉。",
      topic: "工作",
      mood: "委屈",
      hook: "上次那件工作上的事，后来有缓一点吗？",
      kind: "stress",
      salience: 0.92,
      unresolved: true,
      createdAt: 300,
    });

    const plan = store.buildSilenceNudgePlan();
    assert.ok(plan);
    assert.equal(plan.proactiveCandidate, "上次那件工作上的事，后来有缓一点吗？");
  });

  it("suppresses repeated silence nudges until the user returns", () => {
    const store = new SlowBrainStore();
    store.recordTurn();
    store.recordTurn();
    store.recordTurn();
    store.bumpRelationship({ familiarityDelta: 0.75, emotionalBondDelta: 0.7 });
    store.recordSharedMoment({
      summary: "上次你提到最近压力一直没下去，我们聊到你像是一直在绷着。",
      topic: "工作",
      mood: "焦虑",
      hook: "上次那阵压力，后来有缓一点吗？",
      kind: "stress",
      salience: 0.9,
      unresolved: true,
      createdAt: 500,
    });

    const first = store.buildSilenceNudgePlan();
    assert.ok(first);
    store.recordProactiveOutreach();
    const second = store.buildSilenceNudgePlan();
    assert.equal(second, null);

    store.recordUserTurnActivity();
    const snapshot = store.getSnapshot();
    assert.equal(snapshot.proactiveStrategyState?.consecutiveProactiveCount, 0);
    assert.equal(snapshot.proactiveStrategyState?.nudgesSinceLastUserTurn, 0);
  });

  it("keeps relationship style guidance stable for early but warm connections", () => {
    const store = new SlowBrainStore();
    store.recordTurn();
    store.recordTurn();
    store.recordTurn();
    store.bumpRelationship({ familiarityDelta: 0.75, emotionalBondDelta: 0.68 });
    store.setConversationSummary("最近在聊工作里被误解后的委屈。");

    const guidance = store.buildConversationGuidance("我还是有点委屈");
    const context = store.synthesizeContext();
    assert.ok(guidance.hints?.includes("【关系表达风格】"));
    assert.ok(guidance.hints?.includes("【语气合同】"));
    assert.ok(guidance.hints?.includes("【主动策略】"));
    assert.ok(guidance.hints?.includes("建立关系期"));
    assert.equal(guidance.hints?.includes("亲密稳定期"), false);
    assert.ok(guidance.hints?.includes("起句先回应事实或感受本身"));
    assert.ok(context?.includes("【关系风格合同】"));
  });

  it("treats scene immersion prompts as already in-scene instead of asking to imagine", () => {
    const store = new SlowBrainStore();
    store.recordTurn();
    store.recordTurn();
    store.recordTurn();
    store.bumpRelationship({ familiarityDelta: 0.48, emotionalBondDelta: 0.42 });

    const guidance = store.buildConversationGuidance("北海公园，跟rem手牵手");

    assert.ok(guidance.hints?.includes("【场景承接】"));
    assert.ok(guidance.hints?.includes("【语气合同】"));
    assert.ok(guidance.hints?.includes("不要把回复退回成“要不要我陪你想象”"));
    assert.equal(guidance.hints?.includes("本轮用户说得简短"), false);
  });

  it("uses a stronger care-mode silence nudge only for close unresolved threads", () => {
    const earlyStore = new SlowBrainStore();
    earlyStore.recordTurn();
    earlyStore.recordTurn();
    earlyStore.bumpRelationship({ familiarityDelta: 0.28, emotionalBondDelta: 0.2 });
    earlyStore.recordSharedMoment({
      summary: "上次你提到最近有点累，我们只是轻轻聊了两句。",
      topic: "状态",
      mood: "疲惫/烦躁",
      hook: "最近还好吗",
      kind: "routine",
      salience: 0.4,
      unresolved: false,
      createdAt: 200,
    });
    const earlyPlan = earlyStore.buildSilenceNudgePlan();
    assert.ok(earlyPlan);
    assert.equal(earlyPlan.strategyMode, "presence");

    const closeStore = new SlowBrainStore();
    closeStore.recordTurn();
    closeStore.recordTurn();
    closeStore.recordTurn();
    closeStore.recordTurn();
    closeStore.bumpRelationship({ familiarityDelta: 0.72, emotionalBondDelta: 0.68 });
    closeStore.recordSharedMoment({
      summary: "上次你提到工作里那件事一直没过去，我们聊到你最难受的是被误解。",
      topic: "工作",
      mood: "委屈",
      hook: "那件工作上的事后来有缓一点吗？",
      kind: "stress",
      salience: 0.94,
      unresolved: true,
      createdAt: 300,
    });
    const closePlan = closeStore.buildSilenceNudgePlan();
    assert.ok(closePlan);
    assert.equal(closePlan.strategyMode, "care");
  });

  it("forces answer-first guidance for decision-seeking questions", () => {
    const store = new SlowBrainStore();
    store.recordTurn();
    store.recordTurn();
    store.recordTurn();
    store.bumpRelationship({ familiarityDelta: 0.58, emotionalBondDelta: 0.46 });

    const guidance = store.buildConversationGuidance("你觉得我是不是需要换个老板呢");

    assert.ok(guidance.hints?.includes("【判断优先】"));
    assert.ok(guidance.hints?.includes("【本轮回复合同】"));
    assert.ok(guidance.hints?.includes("先明确给出你的倾向判断"));
    assert.equal(Boolean(guidance.proactiveCandidate), false);
    assert.equal(Boolean(guidance.sharedMomentCandidate), false);
  });

  it("uses structured context-update guidance to suppress proactive pullbacks", () => {
    const store = new SlowBrainStore();
    store.recordTurn();
    store.recordTurn();
    store.recordTurn();
    store.bumpRelationship({ familiarityDelta: 0.6, emotionalBondDelta: 0.5 });
    store.setProactiveTopics(["工作那件事后来缓一点了吗"]);
    store.recordSharedMoment({
      summary: "上次你提到工作上那件事一直压着你。",
      topic: "工作",
      mood: "委屈",
      hook: "工作那件事后来缓一点了吗",
      kind: "stress",
      salience: 0.86,
      unresolved: true,
      createdAt: 320,
    });

    const guidance = store.buildConversationGuidance("攒了两年半，还欠花呗两万五", {
      interpretation: {
        userAct: "context_update",
        answerObligation: "answer_then_followup",
        responseMode: "answer_first",
        emotionalState: {
          valence: "mixed",
          intensity: "medium",
          feltNeeds: ["clarity", "practical_help"],
        },
        relationalPosture: "serious",
        topicUpdate: {
          kind: "constraint_update",
        },
        sceneState: "not_in_scene",
        boundaryState: "none",
        followupPermission: "none",
        confidence: 0.82,
      },
      policy: {
        openingMove: "direct_answer",
        directness: "high",
        warmth: "high",
        questionBudget: 0,
        shouldMirrorEmotion: true,
        shouldGiveJudgment: false,
        shouldUpdateDecisionContext: true,
        bans: ["no_assistantese", "no_host_mode", "no_repeat_user_question"],
      },
      source: "llm_structured",
      latencyMs: 120,
      timedOut: false,
      mode: "on",
      used: true,
    });

    assert.ok(guidance.hints?.includes("【响应策略】"));
    assert.ok(guidance.hints?.includes("补充现实约束"));
    assert.ok(guidance.hints?.includes("更新你的判断"));
    assert.equal(Boolean(guidance.proactiveCandidate), false);
    assert.equal(Boolean(guidance.sharedMomentCandidate), false);
  });

  it("forces answer-now mode when the user complains about being asked back", () => {
    const store = new SlowBrainStore();
    store.recordTurn();
    store.recordTurn();
    store.recordTurn();
    store.bumpRelationship({ familiarityDelta: 0.62, emotionalBondDelta: 0.52 });
    store.setProactiveTopics(["工作那件事后来缓一点了吗"]);
    store.recordSharedMoment({
      summary: "你之前提到工作里那件事一直让你很堵。",
      topic: "工作",
      mood: "委屈",
      hook: "工作那件事后来缓一点了吗",
      kind: "stress",
      salience: 0.88,
      unresolved: true,
      createdAt: 300,
    });

    const guidance = store.buildConversationGuidance("我在问你呢，你怎么老是问我");

    assert.ok(guidance.hints?.includes("【先回答】"));
    assert.ok(guidance.hints?.includes("【本轮回复合同】"));
    assert.ok(guidance.hints?.includes("不要再用“你是不是”"));
    assert.equal(Boolean(guidance.proactiveCandidate), false);
    assert.equal(Boolean(guidance.sharedMomentCandidate), false);
  });

  it("backs off proactive intensity after repeated unanswered nudges", () => {
    const store = new SlowBrainStore();
    store.recordTurn();
    store.recordTurn();
    store.recordTurn();
    store.bumpRelationship({ familiarityDelta: 0.68, emotionalBondDelta: 0.62 });
    store.recordSharedMoment({
      summary: "上次你提到工作里的委屈还挂着，我们聊到你很怕再次被误解。",
      topic: "工作",
      mood: "委屈",
      hook: "那件工作上的事后来有缓一点吗？",
      kind: "stress",
      salience: 0.9,
      unresolved: true,
      createdAt: 400,
    });

    store.recordProactiveOutreach("care");
    store.recordProactiveOutreach("care");
    const guidance = store.buildConversationGuidance("嗯");

    assert.ok(guidance.hints?.includes("低打扰的在场感"));
    assert.equal(store.buildSilenceNudgePlan(), null);
  });

  it("respects explicit topic boundary and avoids pulling the same topic back", () => {
    const store = new SlowBrainStore();
    store.recordTurn();
    store.recordTurn();
    store.recordTurn();
    store.bumpRelationship({ familiarityDelta: 0.62, emotionalBondDelta: 0.55 });
    store.setProactiveTopics(["项目进度", "今晚吃什么"]);
    store.recordSharedMoment({
      summary: "你最近一直在赶项目，节奏很满。",
      topic: "项目",
      mood: "疲惫",
      hook: "项目最近推进到哪一步了？",
      kind: "stress",
      salience: 0.86,
      unresolved: true,
      createdAt: 200,
    });

    const guidance = store.buildConversationGuidance("不说项目了，别聊工作");
    assert.ok(guidance.hints?.includes("【话题边界】"));
    assert.equal((guidance.proactiveCandidate ?? "").includes("项目"), false);
    assert.equal((guidance.sharedMomentCandidate ?? "").includes("项目"), false);
  });

  it("expires topic boundary after ttl turns", () => {
    const store = new SlowBrainStore();
    store.recordTurn();
    store.recordTurn();
    store.recordTurn();
    store.bumpRelationship({ familiarityDelta: 0.62, emotionalBondDelta: 0.55 });
    store.setProactiveTopics(["项目进度"]);
    store.recordSharedMoment({
      summary: "你最近一直在赶项目，节奏很满。",
      topic: "项目",
      mood: "疲惫",
      hook: "项目最近推进到哪一步了？",
      kind: "stress",
      salience: 0.86,
      unresolved: true,
      createdAt: 220,
    });

    const first = store.buildConversationGuidance("不说项目了");
    assert.ok(first.hints?.includes("【话题边界】"));
    for (let index = 0; index < 5; index += 1) {
      store.recordTurn();
    }
    const later = store.buildConversationGuidance("嗯");
    assert.equal(later.hints?.includes("【话题边界】"), false);
  });

  it("can cluster semantically related episodes into one longer-running relationship thread", () => {
    const store = new SlowBrainStore();
    store.recordTurn();
    store.recordTurn();
    store.recordTurn();
    store.recordSharedMoment({
      summary: "上次你提到被同事误解后一直很委屈，我们聊到你最难受的是努力被看偏了。",
      topic: "工作",
      mood: "委屈",
      hook: "那次被误解的事后来有缓一点吗？",
      kind: "stress",
      salience: 0.92,
      unresolved: true,
      createdAt: 100,
    });
    store.recordTurn();
    store.recordSharedMoment({
      summary: "后来你又说最近睡不好，其实还是因为那股被误解的委屈一直没下去。",
      topic: "睡眠",
      mood: "疲惫/烦躁",
      hook: "最近睡得怎么样",
      kind: "support",
      salience: 0.82,
      unresolved: true,
      createdAt: 200,
    });

    const snapshot = store.getSnapshot();
    assert.equal(snapshot.topicThreads.length >= 1, true);
    assert.equal(snapshot.topicThreads[0].relatedTopics?.includes("工作"), true);
    assert.equal(snapshot.topicThreads[0].relatedTopics?.includes("睡眠"), true);
    assert.equal(snapshot.topicThreads[0].episodeCount, 2);
  });

  it("marks deeper multi-topic threads as core memory and surfaces an unfinished line separately", () => {
    const store = new SlowBrainStore();
    for (let index = 0; index < 7; index += 1) {
      store.recordTurn();
    }
    store.recordSharedMoment({
      summary: "最早你提到工作里被误解之后一直很委屈，我们聊到那股堵着的感觉。",
      topic: "工作",
      mood: "委屈",
      hook: "那次被误解的事后来有缓一点吗？",
      kind: "stress",
      salience: 0.94,
      unresolved: true,
      createdAt: 100,
    });
    store.recordTurn();
    store.recordTurn();
    store.recordTurn();
    store.recordSharedMoment({
      summary: "后来你又说最近睡不好，其实还是因为那股委屈一直没下去。",
      topic: "睡眠",
      mood: "疲惫/烦躁",
      hook: "最近睡得怎么样",
      kind: "support",
      salience: 0.82,
      unresolved: true,
      createdAt: 200,
    });
    store.recordTurn();
    store.recordTurn();
    store.recordTurn();
    store.recordSharedMoment({
      summary: "再后来你提到和家里说起这件事时还是会鼻子一酸。",
      topic: "家人",
      mood: "低落",
      hook: "后来和家里聊完有轻一点吗？",
      kind: "bond",
      salience: 0.78,
      unresolved: false,
      createdAt: 300,
    });

    const snapshot = store.getSnapshot();
    assert.equal(snapshot.topicThreads.length >= 1, true);
    assert.equal(
      snapshot.topicThreads.some(
        (entry) => entry.memoryLayer === "core" && (entry.timeSpanTurns ?? 0) >= 5,
      ),
      true,
    );
    const context = store.synthesizeContext();
    assert.ok(context?.includes("【长期关系主线】"));
    assert.ok(context?.includes("【当前未完主线】"));
  });

  it("keeps prediction-only generation read-only for relationship persistence", async () => {
    const { hooks } = createPersistentRepo();

    const reply = await fastBrainPredictOnly({
      userMessage: "我们继续刚才那个",
      emotion: "neutral",
      memory: [],
      history: [],
    });

    assert.equal(hooks.upsertArgs.length, 0);
    assert.ok(reply.includes("我听到了") || reply === "");
  });

  it("persists and restores working memory through relationship state payloads", async () => {
    const restoreEnv = applyEnv({ REMI_WORKING_MEMORY_ENABLED: "1" });
    const { repo } = createPersistentRepo();
    const store = new SlowBrainStore();
    store.recordTurn();
    store.applyWorkingMemoryDraft({
      activeThread: "当前在处理债务判断。",
      currentNeed: "用户想先判断先还哪笔债。",
      currentConstraints: ["还欠花呗两万五", "手头现金紧"],
      openLoop: "先还哪笔债更稳妥",
      doNotTouch: ["不要轻飘安慰或无依据粗算"],
      sceneState: "decision",
      lastUpdatedTurn: 1,
    });

    try {
      await savePersistentRelationshipState(repo, store.exportPersistentState(123));
      const loaded = await loadPersistentRelationshipState(repo);

      assert.deepEqual(loaded.workingMemory, {
        activeThread: "当前在处理债务判断。",
        currentNeed: "用户想先判断先还哪笔债。",
        currentConstraints: ["还欠花呗两万五", "手头现金紧"],
        openLoop: "先还哪笔债更稳妥",
        doNotTouch: ["不要轻飘安慰或无依据粗算"],
        sceneState: "decision",
        lastUpdatedTurn: 1,
      });

      const restored = new SlowBrainStore();
      restored.hydratePersistentState(loaded);
      const snapshot = restored.getSnapshot();
      assert.deepEqual(snapshot.workingMemory, loaded.workingMemory);
      assert.ok(
        restored.buildWorkingMemoryPromptBlock()?.includes("【当前上下文】"),
      );
      assert.ok(restored.buildWorkingMemoryPromptBlock()?.includes("当前主线"));
      assert.ok(restored.buildWorkingMemoryPromptBlock()?.includes("不要做"));
    } finally {
      restoreEnv();
    }
  });

  it("persists and restores repair state through relationship state payloads", async () => {
    const { repo } = createPersistentRepo();
    const store = new SlowBrainStore();
    store.recordTurn();
    store.buildConversationGuidance("你安慰人都不会");

    await savePersistentRelationshipState(repo, store.exportPersistentState(456));
    const loaded = await loadPersistentRelationshipState(repo);

    assert.equal(loaded.repairState?.level, "trust_drop");
    assert.equal(loaded.repairState?.lastUpdatedTurn, 1);
    assert.ok((loaded.repairState?.reason ?? "").includes("先承认"));

    const restored = new SlowBrainStore();
    restored.hydratePersistentState(loaded);
    const snapshot = restored.getSnapshot();
    assert.deepEqual(snapshot.repairState, loaded.repairState);
  });

  it("injects repair guidance and suppresses proactive pullbacks after a trust drop", () => {
    const store = new SlowBrainStore();
    store.recordTurn();
    store.recordTurn();
    store.recordTurn();
    store.bumpRelationship({ familiarityDelta: 0.58, emotionalBondDelta: 0.51 });
    store.setProactiveTopics(["那件工作上的事后来缓一点了吗"]);
    store.recordSharedMoment({
      summary: "上次你提到那件工作上的事一直压着你。",
      topic: "工作",
      mood: "委屈",
      hook: "那件工作上的事后来缓一点了吗",
      kind: "stress",
      salience: 0.9,
      unresolved: true,
      createdAt: 280,
    });

    const guidance = store.buildConversationGuidance("你安慰人都不会");
    const snapshot = store.getSnapshot();

    assert.ok(guidance.hints?.includes("【关系修复】"));
    assert.ok(guidance.hints?.includes("修复信任下滑"));
    assert.equal(Boolean(guidance.proactiveCandidate), false);
    assert.equal(Boolean(guidance.sharedMomentCandidate), false);
    assert.equal(snapshot.repairState?.level, "trust_drop");
    assert.equal(snapshot.repairState?.lastUpdatedTurn, 3);
    assert.ok((snapshot.repairState?.reason ?? "").includes("先承认"));
  });

  it("builds decision/context working memory and expires it after three turns", () => {
    const restoreEnv = applyEnv({ REMI_WORKING_MEMORY_ENABLED: "1" });
    const store = new SlowBrainStore();
    store.recordTurn();

    try {
      const decisionDraft = store.buildWorkingMemoryDraft({
        userMessage: "我到底该不该先把花呗还了，我还欠两万五",
        interpretation: {
          userAct: "decision_seek",
          sceneState: "not_in_scene",
          boundaryState: "none",
          topicUpdate: { kind: "constraint_update", label: "债务" },
        },
      });
      assert.ok(decisionDraft);
      assert.equal(decisionDraft.sceneState, "decision");
      assert.ok(decisionDraft.activeThread.includes("债务"));
      assert.ok(decisionDraft.currentNeed.includes("明确判断"));
      assert.equal(decisionDraft.currentConstraints.includes("我还欠两万五"), true);
      assert.deepEqual(decisionDraft.doNotTouch, []);
      store.applyWorkingMemoryDraft(decisionDraft);

      const contextUpdateDraft = store.buildWorkingMemoryDraft({
        userMessage: "而且我这个月房租也快到了，现金更紧",
        interpretation: {
          userAct: "context_update",
          sceneState: "not_in_scene",
          boundaryState: "none",
          topicUpdate: { kind: "constraint_update", label: "现金流" },
        },
      });
      assert.ok(contextUpdateDraft);
      assert.equal(contextUpdateDraft.currentConstraints.length >= 2, true);
      store.applyWorkingMemoryDraft(contextUpdateDraft);

      const vetoDraft = store.buildWorkingMemoryDraft({
        userMessage: "先别聊这个了",
        interpretation: {
          userAct: "topic_veto",
          sceneState: "not_in_scene",
          boundaryState: "veto_topic",
          topicUpdate: { kind: "same_topic", label: "债务" },
        },
      });
      assert.equal(vetoDraft, null);
      store.applyWorkingMemoryDraft(vetoDraft);
      assert.equal(store.getSnapshot().workingMemory, undefined);

      store.applyWorkingMemoryDraft({
        activeThread: "当前在继续同一场景。",
        currentNeed: "用户在继续当前场景。",
        currentConstraints: [],
        openLoop: "继续眼前这个场景",
        doNotTouch: ["不要重新开场"],
        sceneState: "immersive",
        lastUpdatedTurn: 1,
      });
      store.recordTurn();
      store.recordTurn();
      store.recordTurn();
      assert.equal(store.getSnapshot().workingMemory, undefined);
    } finally {
      restoreEnv();
    }
  });

  it("extracts concrete financial constraints into working memory for debt-pressure turns", () => {
    const restoreEnv = applyEnv({ REMI_WORKING_MEMORY_ENABLED: "1" });
    const store = new SlowBrainStore();
    store.recordTurn();

    try {
      const draft = store.buildWorkingMemoryDraft({
        userMessage: "我每个月挣三千，还欠七八万，得还到啥时候啊",
        interpretation: {
          sceneType: "practical_judgment",
          userAct: "decision_seek",
          sceneState: "not_in_scene",
          boundaryState: "none",
          topicUpdate: { kind: "constraint_update", label: "债务" },
        },
        responsePolicy: {
          openingMove: "direct_answer",
          directness: "high",
          warmth: "high",
          questionBudget: 0,
          shouldMirrorEmotion: true,
          shouldGiveJudgment: true,
          shouldUpdateDecisionContext: true,
          bans: ["no_assistantese", "no_topic_pivot", "no_shallow_reassurance"],
        },
      });

      assert.ok(draft);
      assert.equal(draft.currentConstraints.some((entry) => entry.includes("每个月挣三千")), true);
      assert.equal(draft.currentConstraints.some((entry) => entry.includes("还欠七八万")), true);
      assert.equal(draft.doNotTouch.includes("不要轻飘安慰或无依据粗算"), true);
    } finally {
      restoreEnv();
    }
  });

  it("inherits prior debt constraints on short decision follow-ups instead of clearing the thread", () => {
    const restoreEnv = applyEnv({ REMI_WORKING_MEMORY_ENABLED: "1" });
    const store = new SlowBrainStore();
    store.recordTurn();

    try {
      store.applyWorkingMemoryDraft({
        activeThread: "当前在处理「债务」这条现实判断线。",
        currentNeed: "用户想就「债务」得到明确判断。",
        currentConstraints: ["我每个月挣三千", "还欠七八万"],
        openLoop: "我每个月挣三千，还欠七八万，得还到啥时候啊",
        doNotTouch: ["不要轻飘安慰或无依据粗算"],
        sceneState: "decision",
        lastUpdatedTurn: 1,
      });

      const draft = store.buildWorkingMemoryDraft({
        userMessage: "你帮我算算",
        interpretation: {
          sceneType: "practical_judgment",
          userAct: "decision_seek",
          sceneState: "not_in_scene",
          boundaryState: "none",
          topicUpdate: { kind: "none" },
        },
        responsePolicy: {
          openingMove: "direct_answer",
          directness: "high",
          warmth: "high",
          questionBudget: 0,
          shouldMirrorEmotion: false,
          shouldGiveJudgment: true,
          shouldUpdateDecisionContext: false,
          bans: ["no_assistantese", "no_topic_pivot", "no_repeat_user_question", "no_shallow_reassurance"],
        },
      });

      assert.ok(draft);
      assert.equal(draft.currentConstraints.some((entry) => entry.includes("每个月挣三千")), true);
      assert.equal(draft.currentConstraints.some((entry) => entry.includes("还欠七八万")), true);
      assert.equal(draft.doNotTouch.includes("不要轻飘安慰或无依据粗算"), true);
    } finally {
      restoreEnv();
    }
  });

  it("merges newly added debt constraints into the same active thread instead of replacing the prior context", () => {
    const restoreEnv = applyEnv({ REMI_WORKING_MEMORY_ENABLED: "1" });
    const store = new SlowBrainStore();
    store.recordTurn();

    try {
      store.applyWorkingMemoryDraft({
        activeThread: "当前在处理「债务」这条现实判断线。",
        currentNeed: "用户想就「债务」得到明确判断。",
        currentConstraints: ["我每个月挣三千", "还欠七八万"],
        openLoop: "我每个月挣三千，还欠七八万，得还到啥时候啊",
        doNotTouch: ["不要轻飘安慰或无依据粗算"],
        sceneState: "decision",
        lastUpdatedTurn: 1,
      });

      const draft = store.buildWorkingMemoryDraft({
        userMessage: "而且这个月房租也快到了，手里只剩三千现金",
        interpretation: {
          sceneType: "practical_judgment",
          userAct: "context_update",
          sceneState: "not_in_scene",
          boundaryState: "none",
          topicUpdate: { kind: "constraint_update", label: "现金流" },
        },
        responsePolicy: {
          openingMove: "direct_answer",
          directness: "high",
          warmth: "high",
          questionBudget: 0,
          shouldMirrorEmotion: true,
          shouldGiveJudgment: false,
          shouldUpdateDecisionContext: true,
          bans: ["no_assistantese", "no_topic_pivot", "no_shallow_reassurance"],
        },
      });

      assert.ok(draft);
      assert.ok(draft.activeThread.includes("现实判断线"));
      assert.equal(draft.currentConstraints.some((entry) => entry.includes("每个月挣三千")), true);
      assert.equal(draft.currentConstraints.some((entry) => entry.includes("还欠七八万")), true);
      assert.equal(draft.currentConstraints.some((entry) => entry.includes("房租也快到了")), true);
      assert.equal(draft.currentConstraints.some((entry) => entry.includes("手里只剩三千现金")), true);
      assert.equal(draft.doNotTouch.includes("不要轻飘安慰或无依据粗算"), true);
      assert.ok(draft.openLoop.includes("还到啥时候"));
    } finally {
      restoreEnv();
    }
  });

  it("counts one completed turn even when relationship deltas update multiple times", () => {
    const store = new SlowBrainStore();
    store.recordTurn();
    store.bumpRelationship({ familiarityDelta: 0.02 });
    store.bumpRelationship({ emotionalBondDelta: 0.05 });
    store.bumpRelationship({ emotionalBondDelta: 0.03 });

    const snapshot = store.getSnapshot();
    assert.equal(snapshot.relationship.turnCount, 1);
    assert.equal(snapshot.relationship.familiarity, 0.02);
    assert.equal(snapshot.relationship.emotionalBond, 0.08);
  });

  it("does not persist relationship state for interrupted assistant turns", async () => {
    let releasePending = () => {};
    const pending = new Promise((resolve) => {
      releasePending = resolve;
    });
    const controller = new AbortController();
    const ctx = new RemiSessionContext("relationship-interrupt");
    const { hooks, repo } = createPersistentRepo();
    ctx.attachPersistentRelationshipRepo(repo);

    const { routeMessage, restore } = loadMockedRouteMessage(async function* (input) {
      yield "先说一半";
      await pending;
      if (input.signal?.aborted) {
        return;
      }
      yield "这句不该写入关系态";
    });

    try {
      const chunks = [];
      for await (const chunk of routeMessage(ctx, "我们继续聊", "neutral", controller.signal)) {
        chunks.push(chunk);
        controller.abort();
        releasePending();
      }

      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.deepEqual(chunks, ["先说一半"]);
      assert.equal(
        hooks.upsertArgs.some((entry) => entry.key === RELATIONSHIP_STATE_KEY),
        false,
      );
    } finally {
      restore();
    }
  });
});
