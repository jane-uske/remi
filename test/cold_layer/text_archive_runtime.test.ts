const assert = require("assert").strict;
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const {
  readTextArchiveEntries,
} = require("../../cold_layer/text_archive_ledger");

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

async function waitForEntries(filePath, count) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const entries = await readTextArchiveEntries(filePath);
    if (entries.length >= count) return entries;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return readTextArchiveEntries(filePath);
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

describe("text archive runtime hooks", () => {
  it("records a prompt-stage ledger entry from routeMessage on real text turns", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "text-archive-runtime-"));
    const ledgerPath = path.join(tempDir, "archive.jsonl");
    const restoreEnv = applyEnv({
      REMI_TEXT_ARCHIVE_LEDGER_ENABLED: "1",
      REMI_TEXT_ARCHIVE_LEDGER_PATH: ledgerPath,
      REMI_WORKING_MEMORY_ENABLED: "1",
      REMI_STRUCTURED_TURN_INTERPRETER: "1",
    });
    const { RemiSessionContext } = require("../../brains/remi_session_context");
    const { routeMessage, restore } = loadMockedRouteMessage(async function* () {
      yield "synthetic";
    });

    const ctx = new RemiSessionContext("archive-ledger-prompt");

    try {
      for await (const _ of routeMessage(
        ctx,
        "我住在上海，我每个月挣三千，得还到啥时候啊",
        "neutral",
        undefined,
        { inputSource: "text" },
      )) {
        // consume
      }

      const entries = await waitForEntries(ledgerPath, 2);
      assert.equal(entries.length >= 2, true);
      const promptEntry = entries.find((entry) => entry.stage === "prompt");
      const slowEntry = entries.find((entry) => entry.stage === "slow_brain");
      assert.ok(promptEntry);
      assert.ok(slowEntry);
      assert.equal(promptEntry.inputSource, "text");
      assert.equal(
        promptEntry.memoryWrites.some((write) => write.key === "城市" && write.value === "上海"),
        true,
      );
      assert.equal(promptEntry.prompt.deliberationBudget, "text_deliberate");
      assert.ok(promptEntry.prompt.currentContext.includes("当前主线"));
      assert.equal(promptEntry.turnId, slowEntry.turnId);
    } finally {
      restore();
      restoreEnv();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("records a slow-brain ledger entry with extracted moments and EpisodeV3 previews", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "text-archive-runtime-"));
    const ledgerPath = path.join(tempDir, "archive.jsonl");
    const restoreEnv = applyEnv({
      REMI_TEXT_ARCHIVE_LEDGER_ENABLED: "1",
      REMI_TEXT_ARCHIVE_LEDGER_PATH: ledgerPath,
      REMI_EPISODE_MEMORY_ENABLED: "1",
    });
    const { InMemoryRepository } = require("../../memory/memory_store");
    const { SlowBrainStore } = require("../../brains/slow_brain_store");
    const slowBrainPath = require.resolve("../../brains/slow_brain");
    const episodeStorePath = require.resolve("../../memory/episode_store");
    const qwenClientPath = require.resolve("../../llm/qwen_client");
    const originalEpisodeStore = require.cache[episodeStorePath];
    const originalQwenClient = require.cache[qwenClientPath];

    clearModule(slowBrainPath);
    stubModule(episodeStorePath, {
      ingest: async (moment) => ({
        id: "episode-1",
        user_id: moment.userId,
        title: (moment.topic || moment.summary).slice(0, 30),
        summary: moment.summary,
        topics: moment.topic ? [moment.topic] : [],
        mood: moment.mood,
        kind: moment.kind,
        salience: moment.salience,
        recurrence_count: 1,
        unresolved: moment.unresolved,
        first_seen_at: new Date(),
        last_seen_at: new Date(),
        last_referenced_at: null,
        centroid_embedding: [],
        origin_moment_summaries: [moment.summary],
        relationship_weight: moment.salience,
        status: moment.statusHint ?? (moment.unresolved ? "active" : "cooling"),
      }),
    });
    stubModule(qwenClientPath, {
      hasLlmConfig: () => false,
      complete: async () => {
        throw new Error("complete should not be called in text archive runtime test");
      },
    });
    const { runSlowBrain } = require("../../brains/slow_brain");

    try {
      await runSlowBrain({
        connId: "archive-ledger-slow",
        userId: "synthetic-user",
        userMessage: "点点追电瓶车害我赔了十几万，现在还欠七八万，真的快喘不过气。",
        assistantReply: "这确实把你压得很重，我们先别空算，先把还款结构拆清楚。",
        history: [],
        slowBrain: new SlowBrainStore(),
        memoryRepo: new InMemoryRepository(),
      });

      const entries = await waitForEntries(ledgerPath, 1);
      const slowEntry = entries.find((entry) => entry.stage === "slow_brain");
      assert.ok(slowEntry);
      assert.equal(slowEntry.memoryWrites.every((write) => write.source === "slow_extract"), true);
      assert.equal(slowEntry.extractedMoments.length > 0, true);
      assert.equal(slowEntry.episodeViews[0].domain, "money");
    } finally {
      clearModule(slowBrainPath);
      if (originalEpisodeStore) {
        require.cache[episodeStorePath] = originalEpisodeStore;
      } else {
        clearModule(episodeStorePath);
      }
      if (originalQwenClient) {
        require.cache[qwenClientPath] = originalQwenClient;
      } else {
        clearModule(qwenClientPath);
      }
      restoreEnv();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
