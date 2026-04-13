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
          value: "工作：工作：那次被误解之后，这条线一直拖着。",
        },
        {
          key: "当前未完主线",
          value: "睡眠：睡眠：最近这条线还没过去。",
        },
      ]);
    } finally {
      restore();
    }
  });
});
