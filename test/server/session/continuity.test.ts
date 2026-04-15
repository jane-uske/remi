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
});
