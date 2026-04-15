const assert = require("assert").strict;
const path = require("path");

const { waitFor } = require("../../helpers/session_harness");
const { FakeWebSocket } = require("../../helpers/fake_ws");
const { RELATIONSHIP_STATE_KEY } = require("../../../memory/relationship_state");

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

function loadSessionWithPersistentMemory({
  overlayEnabled = "1",
  entries = [],
} = {}) {
  const restoreEnv = applyEnv({
    REMI_PERSISTENT_MEMORY_OVERLAY_ENABLED: overlayEnabled,
    REMI_PERSISTENT_MEMORY_PRELOAD_LIMIT: "12",
  });

  const appStatePath = path.resolve(__dirname, "../../../infra/app_state.ts");
  const devIdentityPath = path.resolve(
    __dirname,
    "../../../storage/repositories/dev_identity.ts",
  );
  const sessionRepositoryPath = path.resolve(
    __dirname,
    "../../../storage/repositories/session_repository.ts",
  );
  const pgRepoPath = path.resolve(
    __dirname,
    "../../../storage/repositories/pg_memory_repository.ts",
  );
  const bootstrapPath = path.resolve(__dirname, "../../../server/session/bootstrap.ts");
  const historyPath = path.resolve(__dirname, "../../../server/session/history.ts");
  const lifecyclePath = path.resolve(__dirname, "../../../server/session/lifecycle.ts");
  const messageRouterPath = path.resolve(
    __dirname,
    "../../../server/session/message_router.ts",
  );
  const sessionPath = path.resolve(__dirname, "../../../server/session/index.ts");

  const appState = require(appStatePath);
  const previousDbReady = appState.isDbReady();
  const previousRedisReady = appState.isRedisReady();
  const previousMemoryMode = appState.getMemoryMode();
  appState.setDbReady(true);
  appState.setRedisReady(false);
  appState.setMemoryMode("postgres");

  const originalDevIdentity = require.cache[devIdentityPath];
  const originalSessionRepo = require.cache[sessionRepositoryPath];
  const originalPgRepo = require.cache[pgRepoPath];
  const hooks = { getAllCalls: 0, createSessionCalls: 0, ensureUserCalls: 0, upsertCalls: 0 };
  const persistentRepo = {
    async upsert(key, value) {
      hooks.upsertCalls += 1;
      hooks.lastUpsert = { key, value };
    },
    async getAll() {
      hooks.getAllCalls += 1;
      return entries.map((entry) => ({ ...entry }));
    },
    async getByKey(key) {
      const found = entries.find((entry) => entry.key === key);
      return found ? { ...found } : null;
    },
    async delete() {},
    async touch() {},
    async getStale() {
      return [];
    },
  };

  require.cache[devIdentityPath] = {
    id: devIdentityPath,
    filename: devIdentityPath,
    loaded: true,
    exports: {
      ensureStorageUser: async (userId) => {
        hooks.ensureUserCalls += 1;
        return userId;
      },
    },
  };
  require.cache[sessionRepositoryPath] = {
    id: sessionRepositoryPath,
    filename: sessionRepositoryPath,
    loaded: true,
    exports: {
      createSession: async () => {
        hooks.createSessionCalls += 1;
        return {
          id: "sess-1",
          user_id: "dev-user",
          started_at: new Date(),
          ended_at: null,
        };
      },
      endSession: async () => {},
    },
  };
  require.cache[pgRepoPath] = {
    id: pgRepoPath,
    filename: pgRepoPath,
    loaded: true,
    exports: {
      getPgMemoryRepository: () => persistentRepo,
    },
  };

  delete require.cache[bootstrapPath];
  delete require.cache[historyPath];
  delete require.cache[lifecyclePath];
  delete require.cache[messageRouterPath];
  delete require.cache[sessionPath];
  const { createSession } = require(sessionPath);
  const ws = new FakeWebSocket();
  const session = createSession(ws, {} as any);

  return {
    session,
    hooks,
    restore() {
      if (originalDevIdentity) {
        require.cache[devIdentityPath] = originalDevIdentity;
      } else {
        delete require.cache[devIdentityPath];
      }
      if (originalSessionRepo) {
        require.cache[sessionRepositoryPath] = originalSessionRepo;
      } else {
        delete require.cache[sessionRepositoryPath];
      }
      if (originalPgRepo) {
        require.cache[pgRepoPath] = originalPgRepo;
      } else {
        delete require.cache[pgRepoPath];
      }
      appState.setDbReady(previousDbReady);
      appState.setRedisReady(previousRedisReady);
      appState.setMemoryMode(previousMemoryMode);
      restoreEnv();
      delete require.cache[bootstrapPath];
      delete require.cache[historyPath];
      delete require.cache[lifecyclePath];
      delete require.cache[messageRouterPath];
      delete require.cache[sessionPath];
      ws.close();
    },
  };
}

describe("persistent memory overlay session wiring", () => {
  it("hydrates session memory from persistent storage during async initialization", async () => {
    const { session, hooks, restore } = loadSessionWithPersistentMemory({
      entries: [
        {
          key: "名字",
          value: "阿宁",
          importance: 0.5,
          accessCount: 0,
          createdAt: 100,
          lastAccessedAt: 200,
        },
        {
          key: RELATIONSHIP_STATE_KEY,
          value: JSON.stringify({
            version: "v1",
            updatedAt: 120,
            userProfile: {
              interests: ["散步"],
              personalityNotes: [],
            },
            relationship: {
              familiarity: 0.4,
              emotionalBond: 0.35,
              turnCount: 4,
              preferredTopics: ["睡眠"],
            },
            topicHistory: [
              { topic: "睡眠", depth: 2, lastTurn: 4, sentiment: "negative" },
            ],
            moodTrajectory: [
              { turn: 4, mood: "疲惫/烦躁" },
            ],
            conversationSummary: "最近一直在聊晚上睡不好。",
            proactiveTopics: ["昨晚睡得怎么样"],
            sharedMoments: [
              {
                summary: "上次你提到晚上睡不好，我们聊到睡前散步会不会有帮助。",
                topic: "睡眠",
                mood: "疲惫/烦躁",
                hook: "昨晚睡得怎么样",
                kind: "support",
                salience: 0.82,
                recurrenceCount: 2,
                unresolved: true,
                turn: 4,
                createdAt: 110,
                firstSeenAt: 100,
                lastReferencedAt: 0,
              },
            ],
          }),
          importance: 1,
          accessCount: 0,
          createdAt: 120,
          lastAccessedAt: 220,
        },
      ],
    });

    try {
      await waitFor(() => hooks.createSessionCalls === 1 && hooks.getAllCalls === 1, 800);
      const memories = await session.brain.memory.getAll();
      const slowBrainSnapshot = session.brain.slowBrain.getSnapshot();
      assert.equal(hooks.ensureUserCalls, 1);
      assert.equal(session.sessionId, "sess-1");
      assert.equal(session.brain.memory.hasPersistentBackend(), true);
      assert.deepEqual(memories.map((entry) => [entry.key, entry.value]), [["名字", "阿宁"]]);
      assert.equal(slowBrainSnapshot.relationship.turnCount, 4);
      assert.equal(slowBrainSnapshot.sharedMoments.length, 1);
      assert.equal(
        slowBrainSnapshot.sharedMoments[0].summary,
        "上次你提到晚上睡不好，我们聊到睡前散步会不会有帮助。",
      );
      assert.equal(slowBrainSnapshot.sharedMoments[0].kind, "support");
      assert.equal(slowBrainSnapshot.sharedMoments[0].unresolved, true);
    } finally {
      restore();
    }
  });

  it("falls back to pure session memory when overlay is disabled", async () => {
    const { session, hooks, restore } = loadSessionWithPersistentMemory({
      overlayEnabled: "0",
      entries: [
        {
          key: "城市",
          value: "杭州",
          importance: 0.5,
          accessCount: 0,
          createdAt: 100,
          lastAccessedAt: 300,
        },
      ],
    });

    try {
      await waitFor(() => hooks.createSessionCalls === 1, 800);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const memories = await session.brain.memory.getAll();
      assert.equal(hooks.getAllCalls, 0);
      assert.equal(session.brain.memory.hasPersistentBackend(), false);
      assert.deepEqual(memories, []);
    } finally {
      restore();
    }
  });

});
