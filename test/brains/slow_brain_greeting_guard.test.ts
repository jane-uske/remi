const assert = require("assert").strict;
const path = require("path");

const { SlowBrainStore } = require("../../brains/background_analysis_store");

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

function createMemoryRepo() {
  const hooks = {
    upserts: [],
  };
  return {
    hooks,
    repo: {
      async upsert(key, value, importance) {
        hooks.upserts.push({ key, value, importance });
      },
      async getAll() {
        return [];
      },
      async getByKey() {
        return null;
      },
      async delete() {},
      async touch() {},
      async getStale() {
        return [];
      },
    },
  };
}

function loadMockedSlowBrain({ completeImpl, hasConfigImpl, ingestImpl }) {
  const qwenClientModulePath = path.resolve(__dirname, "../../llm/qwen_client.ts");
  const episodeStoreModulePath = path.resolve(__dirname, "../../memory/episode_store.ts");
  const slowBrainModulePath = path.resolve(__dirname, "../../brains/background_analysis.ts");
  const qwenClientModule = require(qwenClientModulePath);
  const episodeStoreModule = require(episodeStoreModulePath);

  const originalComplete = qwenClientModule.complete;
  const originalHasLlmConfig = qwenClientModule.hasLlmConfig;
  const originalIngest = episodeStoreModule.ingest;

  qwenClientModule.complete = completeImpl;
  qwenClientModule.hasLlmConfig = hasConfigImpl;
  episodeStoreModule.ingest = ingestImpl;
  delete require.cache[slowBrainModulePath];

  const { runSlowBrain } = require(slowBrainModulePath);

  return {
    runSlowBrain,
    restore() {
      qwenClientModule.complete = originalComplete;
      qwenClientModule.hasLlmConfig = originalHasLlmConfig;
      episodeStoreModule.ingest = originalIngest;
      delete require.cache[slowBrainModulePath];
    },
  };
}

describe("slow brain greeting guard", () => {
  it("does not let greeting turns write history-derived heavy facts back into flat memory", async () => {
    const restoreEnv = applyEnv({
      key: "test-key",
      base_url: "http://example.com",
      model: "test-model",
      REMI_EPISODE_MEMORY_ENABLED: "1",
    });
    const { hooks, repo } = createMemoryRepo();
    const ingestCalls = [];
    const { runSlowBrain, restore } = loadMockedSlowBrain({
      completeImpl: async () =>
        JSON.stringify({
          user_facts: [
            {
              key: "发生事件",
              value: "狗被杀了",
            },
          ],
          conversation_summary: "用户只是在打招呼。",
        }),
      hasConfigImpl: () => true,
      ingestImpl: async (...args) => {
        ingestCalls.push(args);
      },
    });

    try {
      await runSlowBrain({
        userId: "user-greeting-guard",
        userMessage: "你好呀",
        assistantReply: "我在。",
        history: [
          { role: "user", content: "点点那次闯祸之后，家里赔了十几万。" },
          { role: "assistant", content: "我知道，那条债务线一直压着你。" },
        ],
        slowBrain: new SlowBrainStore(),
        memoryRepo: repo,
      });

      assert.deepEqual(
        hooks.upserts.filter((entry) => !entry.key.startsWith("__rem_")),
        [],
      );
      assert.deepEqual(ingestCalls, []);
    } finally {
      restore();
      restoreEnv();
    }
  });
});
