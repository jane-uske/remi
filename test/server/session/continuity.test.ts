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

  // ── Periodic relationship-state save (fix for lost continuity on hard restart) ──
  //
  // touchSessionUserActivity() reads REMI_RELATIONSHIP_PERIODIC_SAVE_ENABLED /
  // _TURNS through getConfig() (server/config/index.ts), which caches parsed
  // env in a module-level singleton independent of continuity.ts's own
  // require.cache eviction. resetConfig() must be called after every env
  // mutation here or these tests read stale values left by whichever test
  // (in this file or process) ran first — see
  // test/server/gateway/desktop_exchange_token.test.ts for the same pattern.

  const configPath = path.resolve(__dirname, "../../../server/config/index.ts");

  function withPeriodicSaveEnv(values, fn) {
    const restoreEnv = applyEnv(values);
    require(configPath).resetConfig();
    return Promise.resolve()
      .then(fn)
      .finally(() => {
        restoreEnv();
        require(configPath).resetConfig();
      });
  }

  function makeRuntime(connId, upsertCalls) {
    // setSilenceNudgeTimer must actually track+clear the timer it's given —
    // otherwise a real setTimeout(fireSessionSilenceNudge, ...) from
    // touchSessionUserActivity's own silence-nudge scheduling outlives the
    // test and throws once Mocha's environment is torn down.
    let activeTimer = null;
    return {
      connId,
      brain: {
        userId: "user-1",
        persistentRelationshipRepo: null,
        memory: {
          getPersistentBackend() {
            return {
              upsert: async (...args) => {
                upsertCalls.push(args);
              },
            };
          },
        },
        slowBrain: {
          exportPersistentState: () => ({
            version: "v1",
            updatedAt: Date.now(),
            userProfile: { interests: [], personalityNotes: [] },
            relationship: {
              familiarity: 0,
              emotionalBond: 0,
              turnCount: 0,
              preferredTopics: [],
            },
            topicHistory: [],
            moodTrajectory: [],
            proactiveTopics: [],
            sharedMoments: [],
          }),
          recordUserTurnActivity() {},
        },
      },
      interrupt: { active: false },
      avatar: {},
      sessionId: null,
      getPipelineChain: () => Promise.resolve(),
      setPipelineChain: () => {},
      getSilenceNudgeTimer: () => activeTimer,
      setSilenceNudgeTimer: (timer) => {
        if (activeTimer) clearTimeout(activeTimer);
        activeTimer = timer ?? null;
      },
      getLastInteractionAt: () => 0,
      setLastInteractionAt: () => {},
      getRecentInteractionCount: () => 0,
      setRecentInteractionCount: () => {},
      continuousConversationThreshold: 3,
      continuousConversationTimeoutMs: 5 * 60 * 1000,
      continuousSilenceFrames: 8,
      defaultSilenceFrames: 10,
      syncVadSilenceFrames() {},
      nextGenerationId: () => 1,
      createTraceId: () => "trace",
      bindActiveGeneration() {},
      getResolvedTtsTransport: () => "auto",
      _stopTimers: () => {
        if (activeTimer) clearTimeout(activeTimer);
        activeTimer = null;
      },
    };
  }

  it("does not save on every turn — only every REMI_RELATIONSHIP_PERIODIC_SAVE_TURNS turns", async () => {
    await withPeriodicSaveEnv(
      {
        REMI_SILENCE_NUDGE_MS: "0",
        REMI_RELATIONSHIP_PERIODIC_SAVE_ENABLED: "1",
        REMI_RELATIONSHIP_PERIODIC_SAVE_TURNS: "3",
        REMI_RELATIONSHIP_STATE_ENABLED: "1",
      },
      async () => {
        const continuityPath = path.resolve(__dirname, "../../../server/session/continuity.ts");
        delete require.cache[continuityPath];
        const { touchSessionUserActivity, clearPeriodicSaveTurnCount } = require(continuityPath);

        const upsertCalls = [];
        const runtime = makeRuntime("periodic-save-test-1", upsertCalls);

        try {
          touchSessionUserActivity(runtime, "turn 1");
          touchSessionUserActivity(runtime, "turn 2");
          // Fire-and-forget saves resolve on a microtask — flush the queue.
          await Promise.resolve();
          await Promise.resolve();
          assert.equal(upsertCalls.length, 0, "should not save before reaching the turn threshold");

          touchSessionUserActivity(runtime, "turn 3");
          await Promise.resolve();
          await Promise.resolve();
          assert.ok(upsertCalls.length > 0, "should save once the turn threshold is reached");
        } finally {
          runtime._stopTimers();
          clearPeriodicSaveTurnCount(runtime.connId);
          delete require.cache[continuityPath];
        }
      },
    );
  });

  it("resets the counter after saving, so it saves again after another full cycle", async () => {
    await withPeriodicSaveEnv(
      {
        REMI_SILENCE_NUDGE_MS: "0",
        REMI_RELATIONSHIP_PERIODIC_SAVE_ENABLED: "1",
        REMI_RELATIONSHIP_PERIODIC_SAVE_TURNS: "2",
        REMI_RELATIONSHIP_STATE_ENABLED: "1",
      },
      async () => {
        const continuityPath = path.resolve(__dirname, "../../../server/session/continuity.ts");
        delete require.cache[continuityPath];
        const { touchSessionUserActivity, clearPeriodicSaveTurnCount } = require(continuityPath);

        const upsertCalls = [];
        const runtime = makeRuntime("periodic-save-test-2", upsertCalls);

        try {
          touchSessionUserActivity(runtime, "turn 1");
          touchSessionUserActivity(runtime, "turn 2"); // hits threshold (2) → saves, resets to 0
          await Promise.resolve();
          await Promise.resolve();
          assert.equal(upsertCalls.length > 0, true, "first cycle should save");
          const afterFirstCycle = upsertCalls.length;

          touchSessionUserActivity(runtime, "turn 3"); // count=1, below threshold again
          await Promise.resolve();
          await Promise.resolve();
          assert.equal(upsertCalls.length, afterFirstCycle, "should not save mid-cycle after reset");

          touchSessionUserActivity(runtime, "turn 4"); // count=2 → saves again
          await Promise.resolve();
          await Promise.resolve();
          assert.ok(upsertCalls.length > afterFirstCycle, "second full cycle should save again");
        } finally {
          runtime._stopTimers();
          clearPeriodicSaveTurnCount(runtime.connId);
          delete require.cache[continuityPath];
        }
      },
    );
  });

  it("never saves when REMI_RELATIONSHIP_PERIODIC_SAVE_ENABLED=0 (flag off = current behavior)", async () => {
    await withPeriodicSaveEnv(
      {
        REMI_SILENCE_NUDGE_MS: "0",
        REMI_RELATIONSHIP_PERIODIC_SAVE_ENABLED: "0",
        REMI_RELATIONSHIP_PERIODIC_SAVE_TURNS: "1",
        REMI_RELATIONSHIP_STATE_ENABLED: "1",
      },
      async () => {
        const continuityPath = path.resolve(__dirname, "../../../server/session/continuity.ts");
        delete require.cache[continuityPath];
        const { touchSessionUserActivity, clearPeriodicSaveTurnCount } = require(continuityPath);

        const upsertCalls = [];
        const runtime = makeRuntime("periodic-save-test-3", upsertCalls);

        try {
          for (let i = 0; i < 10; i++) {
            touchSessionUserActivity(runtime, `turn ${i}`);
          }
          await Promise.resolve();
          await Promise.resolve();
          assert.equal(upsertCalls.length, 0, "flag off must never trigger a periodic save");
        } finally {
          runtime._stopTimers();
          clearPeriodicSaveTurnCount(runtime.connId);
          delete require.cache[continuityPath];
        }
      },
    );
  });

  it("isolates the turn counter per connId — one session's turns don't advance another's", async () => {
    await withPeriodicSaveEnv(
      {
        REMI_SILENCE_NUDGE_MS: "0",
        REMI_RELATIONSHIP_PERIODIC_SAVE_ENABLED: "1",
        REMI_RELATIONSHIP_PERIODIC_SAVE_TURNS: "2",
        REMI_RELATIONSHIP_STATE_ENABLED: "1",
      },
      async () => {
        const continuityPath = path.resolve(__dirname, "../../../server/session/continuity.ts");
        delete require.cache[continuityPath];
        const { touchSessionUserActivity, clearPeriodicSaveTurnCount } = require(continuityPath);

        const upsertCallsA = [];
        const upsertCallsB = [];
        const runtimeA = makeRuntime("periodic-save-test-4a", upsertCallsA);
        const runtimeB = makeRuntime("periodic-save-test-4b", upsertCallsB);

        try {
          touchSessionUserActivity(runtimeA, "a-turn-1");
          touchSessionUserActivity(runtimeB, "b-turn-1");
          await Promise.resolve();
          await Promise.resolve();
          assert.equal(upsertCallsA.length, 0);
          assert.equal(upsertCallsB.length, 0);

          touchSessionUserActivity(runtimeA, "a-turn-2"); // A reaches threshold (2)
          await Promise.resolve();
          await Promise.resolve();
          assert.ok(upsertCallsA.length > 0, "A should have saved");
          assert.equal(upsertCallsB.length, 0, "B's counter is untouched by A's turns");
        } finally {
          runtimeA._stopTimers();
          runtimeB._stopTimers();
          clearPeriodicSaveTurnCount(runtimeA.connId);
          clearPeriodicSaveTurnCount(runtimeB.connId);
          delete require.cache[continuityPath];
        }
      },
    );
  });
});
