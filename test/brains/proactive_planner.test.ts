const assert = require("assert").strict;

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

function loadPlanner(overrides = {}) {
  const plannerPath = require.resolve("../../brains/proactive_planner");
  const episodeStorePath = require.resolve("../../memory/episode_store");
  const originalEpisodeStore = require.cache[episodeStorePath];

  clearModule(plannerPath);
  stubModule(episodeStorePath, overrides.episodeStore ?? {
    listUnresolved: async () => [],
  });

  const planner = require("../../brains/proactive_planner");

  return {
    planner,
    restore() {
      clearModule(plannerPath);
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
      familiarity: 0.4,
      emotionalBond: 0.3,
      turnCount: 6,
      preferredTopics: [],
    },
    topicHistory: [],
    moodTrajectory: [],
    conversationSummary: "",
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
    title: "睡眠",
    summary: "睡眠：最近还在失眠",
    topics: ["睡眠"],
    mood: "tired",
    kind: "stress",
    salience: 0.7,
    recurrence_count: 2,
    unresolved: true,
    first_seen_at: new Date("2026-04-01T00:00:00.000Z"),
    last_seen_at: new Date("2026-04-10T00:00:00.000Z"),
    last_referenced_at: null,
    centroid_embedding: [],
    origin_moment_summaries: ["最近还在失眠"],
    relationship_weight: 0.6,
    status: "active",
    ...overrides,
  };
}

describe("proactive_planner", () => {
  afterEach(() => {
    const plannerPath = require.resolve("../../brains/proactive_planner");
    clearModule(plannerPath);
  });

  it("returns null when familiarity is too low", async () => {
    const { planner, restore } = loadPlanner();

    try {
      const plan = await planner.planProactiveNudge(
        "user-1",
        makeSnapshot({
          relationship: {
            familiarity: 0.1,
            emotionalBond: 0.2,
            turnCount: 3,
            preferredTopics: [],
          },
        }),
      );

      assert.equal(plan, null);
    } finally {
      restore();
    }
  });

  it("returns null when retreat level is too high", async () => {
    const { planner, restore } = loadPlanner();

    try {
      const plan = await planner.planProactiveNudge(
        "user-1",
        makeSnapshot({
          proactiveStrategyState: {
            ...makeSnapshot().proactiveStrategyState,
            retreatLevel: 3,
          },
        }),
      );

      assert.equal(plan, null);
    } finally {
      restore();
    }
  });

  it("returns null when strategy cooldown is still active", async () => {
    const { planner, restore } = loadPlanner();

    try {
      const plan = await planner.planProactiveNudge(
        "user-1",
        makeSnapshot({
          proactiveStrategyState: {
            ...makeSnapshot().proactiveStrategyState,
            cooldownUntilAt: Date.now() + 60000,
          },
        }),
      );

      assert.equal(plan, null);
    } finally {
      restore();
    }
  });

  it("uses care mode for unresolved episodes with negative mood", async () => {
    const episode = makeEpisode({ id: "episode-care", title: "睡眠", mood: "焦虑" });
    const { planner, restore } = loadPlanner({
      episodeStore: {
        listUnresolved: async () => [episode],
      },
    });

    try {
      const plan = await planner.planProactiveNudge("user-1", makeSnapshot());

      assert.deepEqual(plan, {
        mode: "care",
        text: "上次提到睡眠的事情，可以温和地问问最近怎么样了。",
        episodeId: "episode-care",
        ledgerKey: "episode:episode-care",
        stanceMode: "steady_companion",
        whyNow: "这条「睡眠」还没过去，而且最近情绪仍偏沉，值得轻轻接一下",
        relationalValue: "high",
        intrusionRisk: "medium",
      });
    } finally {
      restore();
    }
  });

  it("uses follow_up mode for unresolved episodes with non-negative mood", async () => {
    const episode = makeEpisode({ id: "episode-follow", title: "健身", mood: "curious" });
    const { planner, restore } = loadPlanner({
      episodeStore: {
        listUnresolved: async () => [episode],
      },
    });

    try {
      const plan = await planner.planProactiveNudge("user-1", makeSnapshot());

      assert.deepEqual(plan, {
        mode: "follow_up",
        text: "上次聊到「健身」还没说完，可以自然地接回这个话题。",
        episodeId: "episode-follow",
        ledgerKey: "episode:episode-follow",
        stanceMode: "steady_companion",
        whyNow: "这条「健身」还没收口，现在适合低打扰地续一下",
        relationalValue: "medium",
        intrusionRisk: "medium",
      });
    } finally {
      restore();
    }
  });

  it("skips unresolved episodes that are cooling in the ledger", async () => {
    const coolingEpisode = makeEpisode({ id: "episode-cooling", title: "工作" });
    const availableEpisode = makeEpisode({ id: "episode-open", title: "旅行", mood: "happy" });
    const { planner, restore } = loadPlanner({
      episodeStore: {
        listUnresolved: async () => [coolingEpisode, availableEpisode],
      },
    });

    try {
      const plan = await planner.planProactiveNudge(
        "user-1",
        makeSnapshot({
          proactiveLedger: [
            {
              key: "episode:episode-cooling",
              lastOfferedAt: Date.now() - 1000,
              lastAnsweredAt: 0,
              ignoredCount: 0,
              nextEligibleAt: Date.now() + 60000,
              lastMode: "follow_up",
            },
          ],
        }),
      );

      assert.equal(plan.mode, "follow_up");
      assert.equal(plan.episodeId, "episode-open");
      assert.equal(plan.ledgerKey, "episode:episode-open");
    } finally {
      restore();
    }
  });

  it("falls back to presence when all unresolved episodes are cooling", async () => {
    const coolingEpisode = makeEpisode({ id: "episode-cooling" });
    const { planner, restore } = loadPlanner({
      episodeStore: {
        listUnresolved: async () => [coolingEpisode],
      },
    });

    try {
      const plan = await planner.planProactiveNudge(
        "user-1",
        makeSnapshot({
          proactiveLedger: [
            {
              key: "episode:episode-cooling",
              lastOfferedAt: Date.now() - 1000,
              lastAnsweredAt: 0,
              ignoredCount: 1,
              nextEligibleAt: Date.now() + 60000,
              lastMode: "care",
            },
          ],
        }),
      );

      assert.deepEqual(plan, {
        mode: "presence",
        text: "好久没聊了，可以随意打个招呼或聊聊最近的事。",
        ledgerKey: "presence:general",
        stanceMode: "steady_companion",
        whyNow: "现在更适合低打扰地确认一下近况",
        relationalValue: "low",
        intrusionRisk: "medium",
      });
    } finally {
      restore();
    }
  });

  it("falls back to presence when there is no unresolved episode", async () => {
    const { planner, restore } = loadPlanner({
      episodeStore: {
        listUnresolved: async () => [],
      },
    });

    try {
      const plan = await planner.planProactiveNudge("user-1", makeSnapshot());

      assert.deepEqual(plan, {
        mode: "presence",
        text: "好久没聊了，可以随意打个招呼或聊聊最近的事。",
        ledgerKey: "presence:general",
        stanceMode: "steady_companion",
        whyNow: "现在更适合低打扰地确认一下近况",
        relationalValue: "low",
        intrusionRisk: "medium",
      });
    } finally {
      restore();
    }
  });

  it("backs off to presence when the relationship stance is still light", async () => {
    const episode = makeEpisode({ id: "episode-care", title: "睡眠", mood: "焦虑" });
    const { planner, restore } = loadPlanner({
      episodeStore: {
        listUnresolved: async () => [episode],
      },
    });

    try {
      const plan = await planner.planProactiveNudge(
        "user-1",
        makeSnapshot({
          relationship: {
            familiarity: 0.2,
            emotionalBond: 0.1,
            turnCount: 4,
            preferredTopics: [],
          },
        }),
      );

      assert.deepEqual(plan, {
        mode: "presence",
        text: "前阵子那条「睡眠」我还记得着，如果你今天想说，我们就慢慢接上。",
        episodeId: "episode-care",
        ledgerKey: "episode:episode-care",
        stanceMode: "light_presence",
        whyNow: "这条「睡眠」还没收口，现在适合低打扰地续一下",
        relationalValue: "medium",
        intrusionRisk: "high",
      });
    } finally {
      restore();
    }
  });

  it("keeps proactive outreach low-intrusion when trust has recently dropped", async () => {
    const episode = makeEpisode({ id: "episode-trust-drop", title: "点点", mood: "焦虑" });
    const { planner, restore } = loadPlanner({
      episodeStore: {
        listUnresolved: async () => [episode],
      },
    });

    try {
      const plan = await planner.planProactiveNudge(
        "user-1",
        makeSnapshot({
          repairState: {
            level: "trust_drop",
            reason: "comfort_failure",
            lastUpdatedTurn: 8,
          },
        }),
      );

      assert.deepEqual(plan, {
        mode: "presence",
        text: "好久没聊了，可以随意打个招呼或聊聊最近的事。",
        episodeId: "episode-trust-drop",
        ledgerKey: "episode:episode-trust-drop",
        stanceMode: "steady_companion",
        whyNow:
          "这条「点点」还没收口，但现在更适合低打扰地留个口，不要像没事一样把旧线拉重",
        relationalValue: "medium",
        intrusionRisk: "high",
      });
    } finally {
      restore();
    }
  });

  it("can turn a planner result into a silence-nudge user message", () => {
    const { planner, restore } = loadPlanner();

    try {
      const userMessage = planner.buildSilenceNudgeUserMessage({
        mode: "follow_up",
        text: "上次聊到「健身」还没说完，可以自然地接回这个话题。",
        ledgerKey: "episode:episode-follow",
      });

      assert.ok(userMessage.includes("系统情境"));
      assert.ok(userMessage.includes("健身"));
      assert.ok(userMessage.includes("不要显得像在催对方回复"));
      assert.ok(userMessage.includes("现在主动的原因"));
    } finally {
      restore();
    }
  });

  it("does not send a generic presence nudge when there is no unresolved line and cadence is low", async () => {
    const { planner, restore } = loadPlanner({
      episodeStore: {
        listUnresolved: async () => [],
      },
    });

    try {
      const plan = await planner.planProactiveNudge(
        "user-1",
        makeSnapshot({
          relationship: {
            familiarity: 0.2,
            emotionalBond: 0.1,
            turnCount: 4,
            preferredTopics: [],
          },
        }),
      );

      assert.equal(plan, null);
    } finally {
      restore();
    }
  });
});
