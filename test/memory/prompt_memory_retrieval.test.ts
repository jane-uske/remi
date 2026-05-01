const assert = require("assert").strict;

const { InMemoryRepository } = require("../../memory/memory_store");
const { retrievePromptMemory, recallEpisodes } = require("../../memory/memory_agent");

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

async function seedRepo(entries) {
  const repo = new InMemoryRepository();
  const now = Date.now();
  for (const entry of entries) {
    await repo.upsert(entry.key, entry.value, entry.importance);
    const stored = repo.entries.find((item) => item.key === entry.key);
    stored.createdAt = entry.createdAt ?? now;
    stored.lastAccessedAt = entry.lastAccessedAt ?? now;
    stored.importance = entry.importance ?? stored.importance;
  }
  return repo;
}

describe("prompt memory retrieval", () => {
  it("prioritizes relationship-relevant facts after stable core facts", async () => {
    const repo = await seedRepo([
      { key: "名字", value: "小满", importance: 0.9, lastAccessedAt: 100 },
      { key: "城市", value: "杭州", importance: 0.7, lastAccessedAt: 200 },
      { key: "工作", value: "设计师", importance: 0.4, lastAccessedAt: 50 },
      { key: "运动喜好", value: "夜跑", importance: 0.6, lastAccessedAt: 500 },
      { key: "睡眠困扰", value: "失眠", importance: 0.8, lastAccessedAt: 450 },
      { key: "收藏歌手", value: "王菲", importance: 0.95, lastAccessedAt: 900 },
    ]);

    const memories = await retrievePromptMemory(repo, {
      userMessage: "昨晚夜跑完还是有点失眠",
      slowBrainSnapshot: {
        userProfile: {
          facts: new Map(),
          interests: [],
          personalityNotes: [],
        },
        relationship: {
          familiarity: 0.4,
          emotionalBond: 0.3,
          turnCount: 5,
          preferredTopics: ["夜跑", "睡眠"],
        },
        topicHistory: [
          { topic: "夜跑", depth: 2, lastTurn: 5, sentiment: "positive" },
          { topic: "睡眠", depth: 3, lastTurn: 5, sentiment: "negative" },
        ],
        moodTrajectory: [{ turn: 5, mood: "疲惫/烦躁" }],
        conversationSummary: "最近一直在聊夜跑和睡眠状态。",
        proactiveTopics: ["昨晚睡得怎么样"],
        sharedMoments: [
          {
            summary: "上次你提到夜跑完还是睡不着，我们一起聊了怎么让身体慢慢放松。",
            topic: "睡眠",
            mood: "疲惫/烦躁",
            hook: "昨晚睡得怎么样",
            turn: 5,
            createdAt: 500,
          },
        ],
      },
      maxEntries: 4,
    });

    assert.equal(memories.length, 4);
    assert.deepEqual(memories.slice(0, 2).map((entry) => entry.key), ["名字", "城市"]);
    assert.equal(memories.some((entry) => entry.key === "最近共同经历"), true);
    assert.equal(memories.some((entry) => entry.key === "运动喜好"), true);
    assert.equal(memories.some((entry) => entry.key === "收藏歌手"), false);
  });

  it("falls back to core facts and recent important entries when relationship context is absent", async () => {
    const repo = await seedRepo([
      { key: "名字", value: "阿宁", importance: 0.9, lastAccessedAt: 100 },
      { key: "城市", value: "上海", importance: 0.7, lastAccessedAt: 150 },
      { key: "宠物", value: "猫", importance: 0.3, lastAccessedAt: 120 },
      { key: "收藏歌手", value: "王菲", importance: 0.95, lastAccessedAt: 900 },
    ]);

    const memories = await retrievePromptMemory(repo, {
      userMessage: "嗯",
      maxEntries: 3,
    });

    assert.deepEqual(memories.map((entry) => entry.key), ["名字", "城市", "收藏歌手"]);
  });

  it("keeps stale current-state memories out of unrelated ordinary turns", async () => {
    const repo = await seedRepo([
      {
        key: "当前行为",
        value: "咨询 Codex SDK 接入相关问题",
        importance: 1,
        createdAt: Date.now() - 1000 * 60 * 60 * 24 * 3,
        lastAccessedAt: Date.now() - 1000 * 60 * 60 * 24 * 3,
      },
      {
        key: "当前诉求",
        value: "确认 Codex 开发执行稿的存放位置",
        importance: 1,
        createdAt: Date.now() - 1000 * 60 * 60 * 24 * 2,
        lastAccessedAt: Date.now() - 1000 * 60 * 60 * 24 * 2,
      },
      {
        key: "正在推进的项目",
        value: "带宠物联机小游戏开发",
        importance: 1,
        createdAt: Date.now() - 1000 * 60 * 60 * 24 * 3,
        lastAccessedAt: Date.now() - 1000 * 60 * 60 * 24 * 3,
      },
    ]);

    const memories = await retrievePromptMemory(repo, {
      userMessage: "我刚起床，今天先不弄项目。",
      slowBrainSnapshot: {
        userProfile: {
          facts: new Map(),
          interests: [],
          personalityNotes: [],
        },
        relationship: {
          familiarity: 0.8,
          emotionalBond: 0.72,
          turnCount: 32,
          preferredTopics: ["游戏", "SDK"],
        },
        topicHistory: [],
        moodTrajectory: [],
        conversationSummary: "最近聊过宠物联机小游戏和 SDK 接入。",
        proactiveTopics: [],
        sharedMoments: [],
      },
      maxEntries: 3,
    });

    assert.deepEqual(memories, []);
  });

  it("can explicitly recall one core episode and one active episode from the structured layer", async () => {
    const recalled = await recallEpisodes(
      {
        userProfile: {
          facts: new Map(),
          interests: [],
          personalityNotes: [],
        },
        relationship: {
          familiarity: 0.72,
          emotionalBond: 0.61,
          turnCount: 14,
          preferredTopics: ["工作", "睡眠"],
        },
        topicHistory: [
          { topic: "工作", depth: 5, lastTurn: 14, sentiment: "negative" },
          { topic: "睡眠", depth: 3, lastTurn: 14, sentiment: "negative" },
        ],
        moodTrajectory: [
          { turn: 13, mood: "委屈" },
          { turn: 14, mood: "疲惫/烦躁" },
        ],
        conversationSummary: "工作委屈这条线拖久了，最近又开始影响睡眠。",
        proactiveTopics: ["那件工作上的事后来怎么样了"],
        sharedMoments: [],
        episodes: [
          {
            id: "work-core",
            layer: "core",
            title: "工作",
            summary: "从那次被误解开始，到后来睡眠也被拖垮，这条委屈主线一直反复回来。",
            sourceTopics: ["工作", "睡眠"],
            semanticKeywords: ["误解", "委屈", "睡眠"],
            topMood: "委屈",
            salience: 0.92,
            relationshipWeight: 0.9,
            status: "cooling",
            firstTurn: 5,
            lastTurn: 13,
            recurrenceCount: 4,
            originMomentSummaries: ["那次被误解之后，你一直很委屈。"],
          },
          {
            id: "sleep-active",
            layer: "active",
            title: "睡眠",
            summary: "最近这条睡眠线还没过去，几乎每晚都会把你拉回那种绷着的状态。",
            sourceTopics: ["睡眠"],
            semanticKeywords: ["失眠", "绷着", "醒来"],
            topMood: "疲惫/烦躁",
            salience: 0.84,
            relationshipWeight: 0.76,
            status: "active",
            firstTurn: 12,
            lastTurn: 14,
            recurrenceCount: 2,
            originMomentSummaries: ["昨晚你又醒了两次，白天像被抽空一样。"],
          },
        ],
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
      },
      "我今天还是在想那次被误解的事，昨晚也没睡好",
    );

    assert.equal(recalled.core?.id, "work-core");
    assert.equal(recalled.active?.id, "sleep-active");
  });

  it("can derive recall candidates from shared moments when structured episode fields are absent", async () => {
    const recalled = await recallEpisodes(
      {
        userProfile: {
          facts: new Map(),
          interests: [],
          personalityNotes: [],
        },
        relationship: {
          familiarity: 0.7,
          emotionalBond: 0.62,
          turnCount: 12,
          preferredTopics: ["工作", "睡眠"],
        },
        topicHistory: [
          { topic: "工作", depth: 4, lastTurn: 12, sentiment: "negative" },
          { topic: "睡眠", depth: 2, lastTurn: 12, sentiment: "negative" },
        ],
        moodTrajectory: [
          { turn: 11, mood: "委屈" },
          { turn: 12, mood: "疲惫/烦躁" },
        ],
        conversationSummary: "那次工作上的误解还没过去，最近也开始影响睡眠。",
        proactiveTopics: ["那件工作上的事后来有缓一点吗"],
        sharedMoments: [
          {
            summary: "那次被误解之后，你一直有点委屈。",
            topic: "工作",
            mood: "委屈",
            hook: "那件工作上的事后来有缓一点吗",
            semanticKeywords: ["误解", "委屈"],
            kind: "stress",
            salience: 0.92,
            recurrenceCount: 3,
            unresolved: true,
            turn: 10,
            createdAt: 100,
            firstSeenAt: 100,
            lastReferencedAt: 0,
          },
          {
            summary: "最近又开始睡不好，像一直绷着。",
            topic: "睡眠",
            mood: "疲惫/烦躁",
            hook: "最近睡得怎么样",
            semanticKeywords: ["失眠", "绷着"],
            kind: "support",
            salience: 0.82,
            recurrenceCount: 1,
            unresolved: true,
            turn: 12,
            createdAt: 200,
            firstSeenAt: 200,
            lastReferencedAt: 0,
          },
        ],
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
      },
      "我今天又想到那次工作上的误解，昨晚也没睡好",
    );

    assert.equal(recalled.core?.title, "工作");
    assert.equal(recalled.active?.title, "睡眠");
  });

  it("can surface a shared moment even when there are no fact memories yet", async () => {
    const repo = await seedRepo([]);

    const memories = await retrievePromptMemory(repo, {
      userMessage: "继续刚才那个睡不着的话题",
      slowBrainSnapshot: {
        userProfile: {
          facts: new Map(),
          interests: [],
          personalityNotes: [],
        },
        relationship: {
          familiarity: 0.55,
          emotionalBond: 0.42,
          turnCount: 6,
          preferredTopics: ["睡眠"],
        },
        topicHistory: [
          { topic: "睡眠", depth: 3, lastTurn: 6, sentiment: "negative" },
        ],
        moodTrajectory: [{ turn: 6, mood: "疲惫/烦躁" }],
        conversationSummary: "最近一直在聊失眠和晚上的状态。",
        proactiveTopics: ["昨晚睡得怎么样"],
        sharedMoments: [
          {
            summary: "上次你提到失眠反复醒来，我们还聊到睡前散步会不会好一点。",
            topic: "睡眠",
            mood: "疲惫/烦躁",
            hook: "昨晚睡得怎么样",
            turn: 6,
            createdAt: 700,
          },
        ],
      },
      maxEntries: 2,
    });

    assert.deepEqual(memories, [
      {
        key: "最近共同经历",
        value: "用户提到失眠反复醒来，我们还聊到睡前散步会不会好一点。",
      },
    ]);
  });

  it("prefers the most topically relevant shared moment over a newer unrelated one", async () => {
    const repo = await seedRepo([]);

    const memories = await retrievePromptMemory(repo, {
      userMessage: "我今天还是在想那次和同事吵架的事",
      slowBrainSnapshot: {
        userProfile: {
          facts: new Map(),
          interests: [],
          personalityNotes: [],
        },
        relationship: {
          familiarity: 0.62,
          emotionalBond: 0.5,
          turnCount: 10,
          preferredTopics: ["工作", "情绪"],
        },
        topicHistory: [
          { topic: "工作", depth: 3, lastTurn: 10, sentiment: "negative" },
          { topic: "睡眠", depth: 2, lastTurn: 9, sentiment: "negative" },
        ],
        moodTrajectory: [
          { turn: 9, mood: "疲惫/烦躁" },
          { turn: 10, mood: "委屈" },
        ],
        conversationSummary: "最近主要在聊工作上的摩擦和情绪起伏。",
        proactiveTopics: ["那次和同事的事后来怎么样了"],
        sharedMoments: [
          {
            summary: "上次你提到和同事起冲突后一直很委屈，我们还聊到你其实更在意被误解。",
            topic: "工作",
            mood: "委屈",
            hook: "那次和同事的事后来怎么样了",
            turn: 8,
            createdAt: Date.now() - 1000 * 60 * 60 * 24,
          },
          {
            summary: "昨天我们也聊到你半夜又醒了一次，担心最近总睡不沉。",
            topic: "睡眠",
            mood: "疲惫/烦躁",
            hook: "昨晚睡得怎么样",
            turn: 10,
            createdAt: Date.now() - 1000 * 60 * 30,
          },
        ],
        continuityCueState: {
          lastProactiveHook: "",
          lastProactiveTurn: -100,
          lastSharedMomentSummary: "",
          lastSharedMomentTurn: -100,
        },
      },
      maxEntries: 2,
    });

    assert.deepEqual(memories, [
      {
        key: "最近共同经历",
        value: "用户提到和同事起冲突后一直很委屈，我们还聊到你其实更在意被误解。",
      },
    ]);
  });

  it("avoids resurfacing the same shared moment immediately when another relevant episode exists", async () => {
    const repo = await seedRepo([]);

    const memories = await retrievePromptMemory(repo, {
      userMessage: "还是想聊聊最近状态",
      slowBrainSnapshot: {
        userProfile: {
          facts: new Map(),
          interests: [],
          personalityNotes: [],
        },
        relationship: {
          familiarity: 0.7,
          emotionalBond: 0.58,
          turnCount: 12,
          preferredTopics: ["睡眠", "工作"],
        },
        topicHistory: [
          { topic: "睡眠", depth: 4, lastTurn: 12, sentiment: "negative" },
          { topic: "工作", depth: 3, lastTurn: 11, sentiment: "negative" },
        ],
        moodTrajectory: [
          { turn: 11, mood: "疲惫/烦躁" },
          { turn: 12, mood: "低落" },
        ],
        conversationSummary: "最近一直在睡眠和工作压力之间反复拉扯。",
        proactiveTopics: ["昨晚睡得怎么样", "工作那边这两天有没有缓一点"],
        sharedMoments: [
          {
            summary: "上次你提到晚上反复醒来，我们还聊到睡前散步会不会好一点。",
            topic: "睡眠",
            mood: "疲惫/烦躁",
            hook: "昨晚睡得怎么样",
            turn: 12,
            createdAt: Date.now() - 1000 * 60 * 20,
          },
          {
            summary: "前天你说工作上那件事让你很堵，我们还聊到你最难受的是没人理解。",
            topic: "工作",
            mood: "低落",
            hook: "工作那边这两天有没有缓一点",
            turn: 11,
            createdAt: Date.now() - 1000 * 60 * 60,
          },
        ],
        continuityCueState: {
          lastProactiveHook: "",
          lastProactiveTurn: -100,
          lastSharedMomentSummary: "上次你提到晚上反复醒来，我们还聊到睡前散步会不会好一点。",
          lastSharedMomentTurn: 11,
        },
      },
      maxEntries: 2,
    });

    assert.deepEqual(memories, [
      {
        key: "最近共同经历",
        value: "前天你说工作上那件事让你很堵，我们还聊到你最难受的是没人理解。",
      },
    ]);
  });

  it("can prefer an older but emotionally central episode over a fresher generic one", async () => {
    const repo = await seedRepo([]);

    const memories = await retrievePromptMemory(repo, {
      userMessage: "我还是在想那次被误解之后的委屈感",
      slowBrainSnapshot: {
        userProfile: {
          facts: new Map(),
          interests: [],
          personalityNotes: [],
        },
        relationship: {
          familiarity: 0.74,
          emotionalBond: 0.66,
          turnCount: 18,
          preferredTopics: ["工作", "情绪"],
        },
        topicHistory: [
          { topic: "工作", depth: 5, lastTurn: 18, sentiment: "negative" },
          { topic: "睡眠", depth: 2, lastTurn: 17, sentiment: "negative" },
        ],
        moodTrajectory: [
          { turn: 17, mood: "低落" },
          { turn: 18, mood: "委屈" },
        ],
        conversationSummary: "最近虽然也聊睡眠，但更核心的是工作里的误解和委屈。",
        proactiveTopics: ["那次被误解的事，后来有缓一点吗"],
        sharedMoments: [
          {
            summary: "一周前你提到被同事误解后一直很委屈，我们还聊到你最难受的是努力被看成了别的意思。",
            topic: "工作",
            mood: "委屈",
            hook: "那次被误解的事，后来有缓一点吗",
            kind: "stress",
            salience: 0.95,
            recurrenceCount: 3,
            unresolved: true,
            turn: 12,
            createdAt: Date.now() - 1000 * 60 * 60 * 24 * 7,
            firstSeenAt: Date.now() - 1000 * 60 * 60 * 24 * 9,
            lastReferencedAt: 0,
          },
          {
            summary: "昨晚我们也聊到你又醒了两次，白天精神有点散。",
            topic: "睡眠",
            mood: "疲惫/烦躁",
            hook: "昨晚睡得怎么样",
            kind: "routine",
            salience: 0.42,
            recurrenceCount: 1,
            unresolved: true,
            turn: 17,
            createdAt: Date.now() - 1000 * 60 * 60 * 4,
            firstSeenAt: Date.now() - 1000 * 60 * 60 * 4,
            lastReferencedAt: 0,
          },
        ],
        continuityCueState: {
          lastProactiveHook: "",
          lastProactiveTurn: -100,
          lastSharedMomentSummary: "",
          lastSharedMomentTurn: -100,
        },
      },
      maxEntries: 2,
    });

    assert.deepEqual(memories, [
      {
        key: "最近共同经历",
        value: "一周前你提到被同事误解后一直很委屈，我们还聊到你最难受的是努力被看成了别的意思。",
      },
    ]);
  });

  it("never returns reserved relationship state keys", async () => {
    const restoreEnv = applyEnv({ MAX_PROMPT_MEMORY_ENTRIES: "6" });
    const repo = await seedRepo([
      { key: "名字", value: "阿宁", importance: 0.9, lastAccessedAt: 100 },
      {
        key: "__rem_relationship_state_v1",
        value: '{"version":"v1"}',
        importance: 1,
        lastAccessedAt: 999,
      },
    ]);

    try {
      const memories = await retrievePromptMemory(repo, {
        userMessage: "我们继续聊",
      });
      assert.deepEqual(memories, [{ key: "名字", value: "阿宁" }]);
    } finally {
      restoreEnv();
    }
  });

  it("can surface a long-horizon topic thread when no single episode should dominate", async () => {
    const repo = await seedRepo([]);

    const memories = await retrievePromptMemory(repo, {
      userMessage: "我感觉最近还是在工作和睡眠之间来回拉扯",
      slowBrainSnapshot: {
        userProfile: {
          facts: new Map(),
          interests: [],
          personalityNotes: [],
        },
        relationship: {
          familiarity: 0.77,
          emotionalBond: 0.69,
          turnCount: 22,
          preferredTopics: ["工作", "睡眠"],
        },
        topicHistory: [
          { topic: "工作", depth: 6, lastTurn: 22, sentiment: "negative" },
          { topic: "睡眠", depth: 5, lastTurn: 21, sentiment: "negative" },
        ],
        moodTrajectory: [
          { turn: 21, mood: "疲惫/烦躁" },
          { turn: 22, mood: "焦虑" },
        ],
        conversationSummary: "最近长期主线一直在工作压力和睡眠反复之间拉扯。",
        proactiveTopics: ["工作那边最近有没有稍微松一点", "昨晚睡得怎么样"],
        sharedMoments: [],
        topicThreads: [
          {
            topic: "工作",
            summary: "这条长期主线一直围绕工作里的误解、压力和委屈反复出现。",
            topMood: "委屈",
            salience: 0.88,
            unresolvedCount: 2,
            recurrenceCount: 4,
            lastTurn: 22,
          },
        ],
        continuityCueState: {
          lastProactiveHook: "",
          lastProactiveTurn: -100,
          lastSharedMomentSummary: "",
          lastSharedMomentTurn: -100,
        },
        proactiveStrategyState: {
          lastUserTurnAt: 0,
          lastProactiveAt: 0,
          consecutiveProactiveCount: 0,
          totalProactiveCount: 0,
          nudgesSinceLastUserTurn: 0,
        },
      },
      maxEntries: 2,
    });

    assert.equal(memories.some((entry) => entry.key === "长期关系主线"), true);
  });

  it("can prefer a long-horizon thread over a single episode on vague continuation turns", async () => {
    const repo = await seedRepo([]);

    const memories = await retrievePromptMemory(repo, {
      userMessage: "继续刚才那个",
      slowBrainSnapshot: {
        userProfile: {
          facts: new Map(),
          interests: [],
          personalityNotes: [],
        },
        relationship: {
          familiarity: 0.81,
          emotionalBond: 0.74,
          turnCount: 26,
          preferredTopics: ["工作", "睡眠"],
        },
        topicHistory: [
          { topic: "工作", depth: 7, lastTurn: 26, sentiment: "negative" },
          { topic: "睡眠", depth: 5, lastTurn: 24, sentiment: "negative" },
        ],
        moodTrajectory: [
          { turn: 25, mood: "低落" },
          { turn: 26, mood: "委屈" },
        ],
        conversationSummary: "最近长期主线一直围绕工作里的误解、委屈和睡眠被拖垮的感觉。",
        proactiveTopics: ["工作那边最近有没有稍微松一点"],
        sharedMoments: [
          {
            summary: "昨晚我们聊到你又醒了两次，白天像被抽空一样。",
            topic: "睡眠",
            mood: "疲惫/烦躁",
            hook: "昨晚睡得怎么样",
            kind: "routine",
            salience: 0.42,
            recurrenceCount: 1,
            unresolved: true,
            turn: 26,
            createdAt: Date.now() - 1000 * 60 * 60 * 3,
            firstSeenAt: Date.now() - 1000 * 60 * 60 * 3,
            lastReferencedAt: 0,
          },
        ],
        topicThreads: [
          {
            topic: "工作",
            summary: "这条长期主线一直围绕工作里的误解和委屈反复出现。",
            bridgeSummary: "从最早那次被误解，到最近几次反复回到这条线，工作委屈一直是你们关系里的长期主线。",
            topMood: "委屈",
            salience: 0.9,
            relationshipWeight: 0.93,
            unresolvedCount: 2,
            recurrenceCount: 5,
            episodeCount: 4,
            firstTurn: 18,
            lastTurn: 26,
          },
        ],
        continuityCueState: {
          lastProactiveHook: "",
          lastProactiveTurn: -100,
          lastSharedMomentSummary: "",
          lastSharedMomentTurn: -100,
        },
        proactiveStrategyState: {
          lastUserTurnAt: 0,
          lastProactiveAt: 0,
          consecutiveProactiveCount: 0,
          totalProactiveCount: 0,
          nudgesSinceLastUserTurn: 0,
          lastProactiveMode: "",
        },
      },
      maxEntries: 2,
    });

    assert.deepEqual(memories, [
      {
        key: "长期关系主线",
        value: "工作：从最早那次被误解，到最近几次反复回到这条线，工作委屈一直是你们关系里的长期主线。",
      },
      {
        key: "最近共同经历",
        value: "昨晚我们聊到你又醒了两次，白天像被抽空一样。",
      },
    ]);
  });

  it("can use semantic thread cues across related topics instead of only exact topic matches", async () => {
    const repo = await seedRepo([]);

    const memories = await retrievePromptMemory(repo, {
      userMessage: "我感觉那种被误解之后的堵还是没下去",
      slowBrainSnapshot: {
        userProfile: {
          facts: new Map(),
          interests: [],
          personalityNotes: [],
        },
        relationship: {
          familiarity: 0.79,
          emotionalBond: 0.71,
          turnCount: 24,
          preferredTopics: ["工作", "睡眠"],
        },
        topicHistory: [
          { topic: "工作", depth: 6, lastTurn: 24, sentiment: "negative" },
          { topic: "睡眠", depth: 4, lastTurn: 23, sentiment: "negative" },
        ],
        moodTrajectory: [
          { turn: 23, mood: "疲惫/烦躁" },
          { turn: 24, mood: "委屈" },
        ],
        conversationSummary: "最近一直在工作里的误解和睡眠被拖垮之间来回打转。",
        proactiveTopics: ["那次被误解的事后来有缓一点吗"],
        sharedMoments: [],
        topicThreads: [
          {
            topic: "工作",
            summary: "这条线一直围绕工作里的误解、委屈和之后睡眠被拖垮反复出现。",
            bridgeSummary: "从那次被误解开始，到后面睡眠也被拖垮，这条委屈主线一直反复回来。",
            topMood: "委屈",
            relatedTopics: ["工作", "睡眠"],
            semanticKeywords: ["误解", "委屈", "堵", "睡眠"],
            salience: 0.91,
            relationshipWeight: 0.94,
            unresolvedCount: 2,
            recurrenceCount: 5,
            episodeCount: 4,
            firstTurn: 18,
            lastTurn: 24,
          },
        ],
        continuityCueState: {
          lastProactiveHook: "",
          lastProactiveTurn: -100,
          lastSharedMomentSummary: "",
          lastSharedMomentTurn: -100,
        },
        proactiveStrategyState: {
          lastUserTurnAt: 0,
          lastProactiveAt: 0,
          lastUserReturnAfterProactiveAt: 0,
          consecutiveProactiveCount: 0,
          totalProactiveCount: 0,
          nudgesSinceLastUserTurn: 0,
          retreatLevel: 0,
          lastProactiveMode: "",
        },
      },
      maxEntries: 1,
    });

    assert.deepEqual(memories, [
      {
        key: "长期关系主线",
        value: "工作：从那次被误解开始，到后面睡眠也被拖垮，这条委屈主线一直反复回来。",
      },
    ]);
  });

  it("can return both a long-horizon core thread and a current unresolved thread when they differ", async () => {
    const repo = await seedRepo([]);

    const memories = await retrievePromptMemory(repo, {
      userMessage: "我最近还是有点乱，继续刚才那个",
      slowBrainSnapshot: {
        userProfile: {
          facts: new Map(),
          interests: [],
          personalityNotes: [],
        },
        relationship: {
          familiarity: 0.84,
          emotionalBond: 0.77,
          turnCount: 32,
          preferredTopics: ["工作", "睡眠", "家人"],
        },
        topicHistory: [
          { topic: "工作", depth: 8, lastTurn: 29, sentiment: "negative" },
          { topic: "睡眠", depth: 7, lastTurn: 31, sentiment: "negative" },
          { topic: "家人", depth: 3, lastTurn: 32, sentiment: "neutral" },
        ],
        moodTrajectory: [
          { turn: 30, mood: "低落" },
          { turn: 31, mood: "焦虑" },
          { turn: 32, mood: "疲惫/烦躁" },
        ],
        conversationSummary: "长期主线一直围绕工作里的误解怎么拖到睡眠和家人沟通上。",
        proactiveTopics: ["那条一直拖着的工作线最近有缓一点吗"],
        sharedMoments: [],
        topicThreads: [
          {
            topic: "工作",
            summary: "这条长期主线一直围绕工作里的误解、委屈和后续睡眠被拖垮反复出现。",
            bridgeSummary: "从最早那次被误解，到后来睡眠和家人沟通都被拖进去，这条工作委屈线已经成了长期主线。",
            topMood: "委屈",
            relatedTopics: ["工作", "睡眠", "家人"],
            semanticKeywords: ["误解", "委屈", "睡眠", "家人"],
            salience: 0.93,
            relationshipWeight: 0.96,
            unresolvedCount: 1,
            recurrenceCount: 6,
            episodeCount: 5,
            firstTurn: 20,
            timeSpanTurns: 12,
            memoryLayer: "core",
            lastTurn: 32,
          },
          {
            topic: "睡眠",
            summary: "这条未完线主要是最近几晚又睡不沉，白天整个人像绷着。",
            bridgeSummary: "最近这条睡眠线还没过去，几乎每晚都会把你拉回那种绷着的状态。",
            topMood: "疲惫/烦躁",
            relatedTopics: ["睡眠"],
            semanticKeywords: ["睡眠", "绷着", "醒来"],
            salience: 0.8,
            relationshipWeight: 0.82,
            unresolvedCount: 2,
            recurrenceCount: 3,
            episodeCount: 2,
            firstTurn: 30,
            timeSpanTurns: 2,
            memoryLayer: "active",
            lastTurn: 32,
          },
        ],
        continuityCueState: {
          lastProactiveHook: "",
          lastProactiveTurn: -100,
          lastSharedMomentSummary: "",
          lastSharedMomentTurn: -100,
        },
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
      },
      maxEntries: 2,
    });

    assert.deepEqual(memories, [
      {
        key: "长期关系主线",
        value: "工作：从最早那次被误解，到后来睡眠和家人沟通都被拖进去，这条工作委屈线已经成了长期主线。",
      },
      {
        key: "当前未完主线",
        value: "睡眠：最近这条睡眠线还没过去，几乎每晚都会把你拉回那种绷着的状态。",
      },
    ]);
  });
});
