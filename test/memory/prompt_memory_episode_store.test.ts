const assert = require("assert").strict;

const { InMemoryRepository } = require("../../memory/memory_store");

function clearModule(modulePath) {
  delete require.cache[modulePath];
}

function stubModule(modulePath, exportsObject) {
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports: exportsObject,
  };
}

function loadMemoryAgent(overrides = {}) {
  const memoryAgentPath = require.resolve("../../memory/memory_agent");
  const episodeStorePath = require.resolve("../../memory/episode_store");
  const originalEpisodeStore = require.cache[episodeStorePath];

  clearModule(memoryAgentPath);
  stubModule(episodeStorePath, overrides.episodeStore ?? {
    findRelevant: async () => [],
    markReferenced: async () => {},
  });

  const memoryAgent = require("../../memory/memory_agent");

  return {
    memoryAgent,
    restore() {
      clearModule(memoryAgentPath);
      if (originalEpisodeStore) {
        require.cache[episodeStorePath] = originalEpisodeStore;
      } else {
        clearModule(episodeStorePath);
      }
    },
  };
}

function makeSnapshot(overrides = {}) {
  return {
    userProfile: {
      facts: new Map(),
      interests: [],
      personalityNotes: [],
    },
    relationship: {
      familiarity: 0.6,
      emotionalBond: 0.5,
      turnCount: 10,
      preferredTopics: ["工作", "睡眠"],
    },
    topicHistory: [],
    moodTrajectory: [],
    conversationSummary: "工作委屈最近又开始影响睡眠。",
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
    ...overrides,
  };
}

function makeEpisode(overrides = {}) {
  return {
    id: "episode-1",
    user_id: "user-1",
    title: "工作",
    summary: "工作：那次被误解之后，这条线一直拖着。",
    topics: ["工作", "睡眠"],
    mood: "委屈",
    kind: "stress",
    salience: 0.8,
    recurrence_count: 4,
    unresolved: false,
    first_seen_at: new Date("2026-04-01T00:00:00.000Z"),
    last_seen_at: new Date("2026-04-10T00:00:00.000Z"),
    last_referenced_at: null,
    centroid_embedding: [],
    origin_moment_summaries: ["那次被误解之后，你一直很委屈。"],
    relationship_weight: 0.82,
    status: "cooling",
    ...overrides,
  };
}

describe("prompt memory retrieval with episode store", () => {
  afterEach(() => {
    const memoryAgentPath = require.resolve("../../memory/memory_agent");
    clearModule(memoryAgentPath);
  });

  it("prefers V2 episode store recall when userId is available", async () => {
    const { memoryAgent, restore } = loadMemoryAgent({
      episodeStore: {
        findRelevant: async () => [
          {
            episode: makeEpisode(),
            score: 0.93,
          },
          {
            episode: makeEpisode({
              id: "episode-2",
              title: "睡眠",
              summary: "睡眠：最近这条线还没过去。",
              topics: ["睡眠"],
              recurrence_count: 2,
              relationship_weight: 0.64,
              unresolved: true,
              status: "active",
            }),
            score: 0.86,
          },
        ],
        markReferenced: async () => {},
      },
    });

    try {
      const repo = new InMemoryRepository();
      const memories = await memoryAgent.retrievePromptMemory(repo, {
        userId: "user-1",
        userMessage: "我还是会想到那次工作上的误解，晚上也睡不好",
        slowBrainSnapshot: makeSnapshot(),
        maxEntries: 2,
      });

      assert.deepEqual(memories, [
        {
          key: "长期关系主线",
          value: "工作压力：那次被误解之后，这条线一直拖着。",
        },
        {
          key: "当前未完主线",
          value: "睡眠：最近这条线还没过去。",
        },
      ]);
    } finally {
      restore();
    }
  });

  it("marks selected V2 episodes as referenced and emits recall diagnostics", async () => {
    const referenced = [];
    const { memoryAgent, restore } = loadMemoryAgent({
      episodeStore: {
        findRelevant: async () => [
          {
            episode: makeEpisode(),
            score: 0.93,
          },
          {
            episode: makeEpisode({
              id: "episode-2",
              title: "睡眠",
              summary: "睡眠：最近这条线还没过去。",
              topics: ["睡眠"],
              recurrence_count: 2,
              relationship_weight: 0.64,
              unresolved: true,
              status: "active",
            }),
            score: 0.86,
          },
        ],
        markReferenced: async (episodeId) => {
          referenced.push(episodeId);
        },
      },
    });

    try {
      const repo = new InMemoryRepository();
      let diagnostics = null;
      await memoryAgent.retrievePromptMemory(repo, {
        userId: "user-1",
        userMessage: "我还是会想到那次工作上的误解，晚上也睡不好",
        slowBrainSnapshot: makeSnapshot(),
        maxEntries: 2,
        diagnostics: (meta) => {
          diagnostics = meta;
        },
      });
      await Promise.resolve();

      assert.deepEqual(referenced, ["episode-1", "episode-2"]);
      assert.deepEqual(diagnostics, {
        episodeRecallSource: "episode_store",
        episodeRecallIds: ["episode-1", "episode-2"],
        episodeReferenceApplied: true,
      });
    } finally {
      restore();
    }
  });

  it("keeps the top-ranked active episode without backfilling a lower-ranked core", async () => {
    const referenced = [];
    const { memoryAgent, restore } = loadMemoryAgent({
      episodeStore: {
        findRelevant: async () => [
          {
            episode: makeEpisode({
              id: "episode-2",
              title: "睡眠",
              summary: "睡眠：昨晚又没睡好。",
              topics: ["睡眠"],
              recurrence_count: 2,
              relationship_weight: 0.64,
              unresolved: true,
              status: "active",
            }),
            score: 0.93,
          },
          {
            episode: makeEpisode({
              id: "episode-1",
              title: "工作",
              summary: "工作：那次被误解之后，这条线一直拖着。",
              topics: ["工作", "睡眠"],
              recurrence_count: 4,
              relationship_weight: 0.82,
              unresolved: false,
              status: "cooling",
            }),
            score: 0.81,
          },
        ],
        markReferenced: async (episodeId) => {
          referenced.push(episodeId);
        },
      },
    });

    try {
      const repo = new InMemoryRepository();
      let diagnostics = null;
      const memories = await memoryAgent.retrievePromptMemory(repo, {
        userId: "user-1",
        userMessage: "我昨晚又没睡好",
        slowBrainSnapshot: makeSnapshot(),
        maxEntries: 2,
        diagnostics: (meta) => {
          diagnostics = meta;
        },
      });
      await Promise.resolve();

      assert.deepEqual(memories, [
        {
          key: "当前未完主线",
          value: "睡眠：昨晚又没睡好。",
        },
      ]);
      assert.deepEqual(referenced, ["episode-2"]);
      assert.deepEqual(diagnostics, {
        episodeRecallSource: "episode_store",
        episodeRecallIds: ["episode-2"],
        episodeReferenceApplied: true,
      });
    } finally {
      restore();
    }
  });

  it("does not promote a low-weight mixed-topic active episode into long-term core memory", async () => {
    const referenced = [];
    const { memoryAgent, restore } = loadMemoryAgent({
      episodeStore: {
        findRelevant: async () => [
          {
            episode: makeEpisode({
              id: "episode-2",
              title: "工作",
              summary: "游戏：上次你提到「我手里差不多有两年半积蓄，但还欠花呗两万五。」",
              topics: ["工作", "游戏"],
              recurrence_count: 2,
              relationship_weight: 0.54,
              unresolved: true,
              status: "active",
            }),
            score: 0.93,
          },
          {
            episode: makeEpisode({
              id: "episode-1",
              title: "工作",
              summary: "工作：那次被误解之后，这条线一直拖着。",
              topics: ["工作", "睡眠"],
              recurrence_count: 4,
              relationship_weight: 0.82,
              unresolved: false,
              status: "cooling",
            }),
            score: 0.81,
          },
        ],
        markReferenced: async (episodeId) => {
          referenced.push(episodeId);
        },
      },
    });

    try {
      const repo = new InMemoryRepository();
      let diagnostics = null;
      const memories = await memoryAgent.retrievePromptMemory(repo, {
        userId: "user-1",
        userMessage: "我手里差不多有两年半积蓄，但还欠花呗两万五",
        slowBrainSnapshot: makeSnapshot(),
        maxEntries: 2,
        diagnostics: (meta) => {
          diagnostics = meta;
        },
      });
      await Promise.resolve();

      assert.deepEqual(memories, [
        {
          key: "当前未完主线",
          value: "钱和现实压力：用户提到「我手里差不多有两年半积蓄，但还欠花呗两万五。」",
        },
      ]);
      assert.deepEqual(referenced, ["episode-2"]);
      assert.deepEqual(diagnostics, {
        episodeRecallSource: "episode_store",
        episodeRecallIds: ["episode-2"],
        episodeReferenceApplied: true,
      });
    } finally {
      restore();
    }
  });

  it("uses the structured relationship domain when a comfort-failure episode would otherwise surface as a pet topic", async () => {
    const { memoryAgent, restore } = loadMemoryAgent({
      episodeStore: {
        findRelevant: async () => [
          {
            episode: makeEpisode({
              id: "episode-3",
              title: "宠物",
              summary: "宠物：点点今天又闯祸了。",
              topics: ["宠物", "点点", "狗"],
              origin_moment_summaries: [
                "我不想再重复解释点点那件事了",
                "你安慰人都不会",
              ],
              recurrence_count: 2,
              relationship_weight: 0.88,
              unresolved: true,
              status: "active",
              v3_domain: "relationship_with_remi",
              v3_pressure_source: "relational",
              v3_relational_impact: "high",
              v3_user_stance: "seeking_support",
              v3_unresolved_level: 3,
              v3_event_summary: "你说我根本不会安慰人，也不想再重复解释点点那件事。",
              v3_evidence_turns: [
                "我不想再重复解释点点那件事了",
                "你安慰人都不会",
              ],
              v3_last_user_position: "你安慰人都不会",
            }),
            score: 0.95,
          },
        ],
        markReferenced: async () => {},
      },
    });

    try {
      const repo = new InMemoryRepository();
      const memories = await memoryAgent.retrievePromptMemory(repo, {
        userId: "user-1",
        userMessage: "你根本没懂我，安慰也安慰不到点上",
        slowBrainSnapshot: makeSnapshot(),
        maxEntries: 1,
      });

      assert.deepEqual(memories, [
        {
          key: "当前未完主线",
          value: "你和 Remi 之间：你说我根本不会安慰人，也不想再重复解释点点那件事。",
        },
      ]);
    } finally {
      restore();
    }
  });

  it("keeps filler acknowledgements from promoting episode-store callbacks", async () => {
    const referenced = [];
    const { memoryAgent, restore } = loadMemoryAgent({
      episodeStore: {
        findRelevant: async () => [
          {
            episode: makeEpisode({
              id: "episode-game",
              title: "游戏",
              summary: "游戏：上次你提到「带宠物联机小游戏的Codex开发执行稿」，我们在继续聊游戏。",
              topics: ["游戏", "SDK"],
              recurrence_count: 2,
              relationship_weight: 0.64,
              unresolved: false,
              status: "cooling",
            }),
            score: 0.99,
          },
        ],
        markReferenced: async (episodeId) => {
          referenced.push(episodeId);
        },
      },
    });

    try {
      const repo = new InMemoryRepository();
      let diagnostics = null;
      const memories = await memoryAgent.retrievePromptMemory(repo, {
        userId: "user-1",
        userMessage: "OK OK 我知道了。",
        slowBrainSnapshot: makeSnapshot({
          relationship: {
            familiarity: 0.8,
            emotionalBond: 0.7,
            turnCount: 32,
            preferredTopics: ["游戏", "SDK"],
          },
        }),
        maxEntries: 2,
        diagnostics: (meta) => {
          diagnostics = meta;
        },
      });
      await Promise.resolve();

      assert.deepEqual(memories, []);
      assert.deepEqual(referenced, []);
      assert.deepEqual(diagnostics, {
        episodeRecallSource: "none",
        episodeRecallIds: [],
        episodeReferenceApplied: false,
      });
    } finally {
      restore();
    }
  });

  it("sanitizes callback phrasing from prompt-facing episode summaries", async () => {
    const { memoryAgent, restore } = loadMemoryAgent({
      episodeStore: {
        findRelevant: async () => [
          {
            episode: makeEpisode({
              id: "episode-game",
              title: "游戏",
              summary: "游戏：上次你提到「带宠物联机小游戏的Codex开发执行稿」，我们在继续聊游戏。",
              topics: ["游戏", "SDK"],
              recurrence_count: 3,
              relationship_weight: 0.82,
              unresolved: false,
              status: "cooling",
            }),
            score: 0.95,
          },
        ],
        markReferenced: async () => {},
      },
    });

    try {
      const repo = new InMemoryRepository();
      const memories = await memoryAgent.retrievePromptMemory(repo, {
        userId: "user-1",
        userMessage: "SDK 接入后还能正常回复吗？",
        slowBrainSnapshot: makeSnapshot({
          relationship: {
            familiarity: 0.8,
            emotionalBond: 0.7,
            turnCount: 32,
            preferredTopics: ["游戏", "SDK"],
          },
        }),
        maxEntries: 1,
      });

      assert.equal(memories.length, 1);
      assert.equal(memories[0].key, "长期关系主线");
      assert.equal(memories[0].value.includes("上次"), false);
      assert.equal(memories[0].value.includes("你之前"), false);
      assert.equal(memories[0].value.includes("我们在继续聊"), false);
      assert.ok(memories[0].value.includes("宠物联机小游戏"));
    } finally {
      restore();
    }
  });
});
