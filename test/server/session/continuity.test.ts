const assert = require("assert").strict;
const path = require("path");

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

describe("session continuity helpers", () => {
  it("reuses the latest pipelineChain when repeated silence nudges schedule off the same runtime", async () => {
    const restoreEnv = applyEnv({
      REMI_SILENCE_NUDGE_MS: "1",
      REMI_PROACTIVE_PLANNER_MAIN_PATH_ENABLED: "0",
    });

    const pipelinePath = path.resolve(__dirname, "../../../server/pipeline/index.ts");
    const continuityPath = path.resolve(__dirname, "../../../server/session/continuity.ts");
    const previousPipeline = require.cache[pipelinePath];

    const pipelineCalls = [];
    let releaseFirstPipeline;
    require.cache[pipelinePath] = {
      id: pipelinePath,
      filename: pipelinePath,
      loaded: true,
      exports: {
        runPipeline: async (...args) => {
          pipelineCalls.push(args);
          if (pipelineCalls.length === 1) {
            await new Promise((resolve) => {
              releaseFirstPipeline = resolve;
            });
          }
        },
      },
    };

    delete require.cache[continuityPath];
    const { fireSessionSilenceNudge } = require(continuityPath);

    let releaseBaseChain;
    let currentChain = new Promise((resolve) => {
      releaseBaseChain = resolve;
    });
    let generation = 0;
    let activeTimers = [];

    const runtime = {
      connId: "continuity-test",
      ws: {},
      brain: {
        userId: "user-1",
        slowBrain: {
          buildSilenceNudgePlan: () => ({
            userMessage: "最近怎么样？",
            proactiveCandidate: undefined,
            proactiveCandidateKey: undefined,
            sharedMomentCandidate: undefined,
            strategyMode: "presence",
          }),
          recordUserTurnActivity() {},
          recordProactiveOutreach() {},
          markContinuityCueUsed() {},
          getSnapshot() {
            return {};
          },
          exportPersistentState() {
            return {};
          },
        },
        lastInterruptedReply: null,
        persistentRelationshipRepo: null,
        memory: {
          getPersistentBackend() {
            return {
              upsert: async () => {},
            };
          },
        },
      },
      interrupt: { active: false },
      avatar: {},
      sessionId: null,
      getPipelineChain: () => currentChain,
      setPipelineChain: (next) => {
        currentChain = next;
      },
      getSilenceNudgeTimer: () => null,
      setSilenceNudgeTimer: (timer) => {
        if (timer) {
          activeTimers.push(timer);
          clearTimeout(timer);
        }
      },
      getLastInteractionAt: () => 0,
      setLastInteractionAt() {},
      getRecentInteractionCount: () => 0,
      setRecentInteractionCount() {},
      continuousConversationThreshold: 3,
      continuousConversationTimeoutMs: 5 * 60 * 1000,
      continuousSilenceFrames: 8,
      defaultSilenceFrames: 10,
      syncVadSilenceFrames() {},
      nextGenerationId: () => {
        generation += 1;
        return generation;
      },
      createTraceId: (source, generationId) => `${source}-${generationId ?? 0}`,
      bindActiveGeneration() {},
      getResolvedTtsTransport: () => "auto",
    };

    try {
      fireSessionSilenceNudge(runtime);
      fireSessionSilenceNudge(runtime);

      await Promise.resolve();
      assert.equal(pipelineCalls.length, 0);

      releaseBaseChain();
      await Promise.resolve();
      await Promise.resolve();

      assert.equal(pipelineCalls.length, 1, "second nudge should wait for the first chained runPipeline");

      releaseFirstPipeline();
      await currentChain;

      assert.equal(pipelineCalls.length, 2);
      assert.equal(pipelineCalls[0][1], "最近怎么样？");
      assert.equal(pipelineCalls[1][1], "最近怎么样？");
    } finally {
      for (const timer of activeTimers) {
        clearTimeout(timer);
      }
      restoreEnv();
      delete require.cache[continuityPath];
      if (previousPipeline) {
        require.cache[pipelinePath] = previousPipeline;
      } else {
        delete require.cache[pipelinePath];
      }
    }
  });

  it("marks proactive planner episodes as referenced after a completed silence nudge", async () => {
    const restoreEnv = applyEnv({
      REMI_SILENCE_NUDGE_MS: "1",
      REMI_PROACTIVE_PLANNER_MAIN_PATH_ENABLED: "1",
    });

    const pipelinePath = path.resolve(__dirname, "../../../server/pipeline/index.ts");
    const continuityPath = path.resolve(__dirname, "../../../server/session/continuity.ts");
    const proactivePlannerPath = path.resolve(__dirname, "../../../brains/proactive_planner.ts");
    const episodeStorePath = path.resolve(__dirname, "../../../memory/episode_store.ts");
    const previousPipeline = require.cache[pipelinePath];
    const previousPlanner = require.cache[proactivePlannerPath];
    const previousEpisodeStore = require.cache[episodeStorePath];

    const referenced = [];
    require.cache[pipelinePath] = {
      id: pipelinePath,
      filename: pipelinePath,
      loaded: true,
      exports: {
        runPipeline: async () => {},
      },
    };
    require.cache[proactivePlannerPath] = {
      id: proactivePlannerPath,
      filename: proactivePlannerPath,
      loaded: true,
      exports: {
        planProactiveNudge: async () => ({
          mode: "follow_up",
          text: "上次那条睡眠线后来怎么样了",
          episodeId: "episode-42",
          ledgerKey: "episode:episode-42",
        }),
        buildSilenceNudgeUserMessage: () => "最近怎么样？",
      },
    };
    require.cache[episodeStorePath] = {
      id: episodeStorePath,
      filename: episodeStorePath,
      loaded: true,
      exports: {
        markReferenced: async (episodeId) => {
          referenced.push(episodeId);
        },
      },
    };

    delete require.cache[continuityPath];
    const { fireSessionSilenceNudge } = require(continuityPath);

    let currentChain = Promise.resolve();
    let activeTimers = [];
    const runtime = {
      connId: "continuity-proactive-reference",
      ws: {},
      brain: {
        userId: "user-1",
        slowBrain: {
          buildSilenceNudgePlan: () => ({
            userMessage: "最近怎么样？",
            proactiveCandidate: undefined,
            proactiveCandidateKey: undefined,
            sharedMomentCandidate: undefined,
            strategyMode: "presence",
          }),
          recordUserTurnActivity() {},
          recordProactiveOutreach() {},
          markContinuityCueUsed() {},
          getSnapshot() {
            return {
              relationship: { familiarity: 0.5 },
              proactiveStrategyState: {
                retreatLevel: 0,
                cooldownUntilAt: 0,
              },
              proactiveLedger: [],
            };
          },
          exportPersistentState() {
            return {};
          },
        },
        lastInterruptedReply: null,
        persistentRelationshipRepo: null,
        memory: {
          getPersistentBackend() {
            return {
              upsert: async () => {},
            };
          },
        },
      },
      interrupt: { active: false },
      avatar: {},
      sessionId: null,
      getPipelineChain: () => currentChain,
      setPipelineChain: (next) => {
        currentChain = next;
      },
      getSilenceNudgeTimer: () => null,
      setSilenceNudgeTimer: (timer) => {
        if (timer) {
          activeTimers.push(timer);
          clearTimeout(timer);
        }
      },
      getLastInteractionAt: () => 0,
      setLastInteractionAt() {},
      getRecentInteractionCount: () => 0,
      setRecentInteractionCount() {},
      continuousConversationThreshold: 3,
      continuousConversationTimeoutMs: 5 * 60 * 1000,
      continuousSilenceFrames: 8,
      defaultSilenceFrames: 10,
      syncVadSilenceFrames() {},
      nextGenerationId: () => 1,
      createTraceId: (source, generationId) => `${source}-${generationId ?? 0}`,
      bindActiveGeneration() {},
      getResolvedTtsTransport: () => "auto",
    };

    try {
      fireSessionSilenceNudge(runtime);
      await currentChain;
      assert.deepEqual(referenced, ["episode-42"]);
    } finally {
      for (const timer of activeTimers) {
        clearTimeout(timer);
      }
      restoreEnv();
      delete require.cache[continuityPath];
      if (previousPipeline) {
        require.cache[pipelinePath] = previousPipeline;
      } else {
        delete require.cache[pipelinePath];
      }
      if (previousPlanner) {
        require.cache[proactivePlannerPath] = previousPlanner;
      } else {
        delete require.cache[proactivePlannerPath];
      }
      if (previousEpisodeStore) {
        require.cache[episodeStorePath] = previousEpisodeStore;
      } else {
        delete require.cache[episodeStorePath];
      }
    }
  });
});
