const assert = require("assert").strict;
const path = require("path");

const { FakeWebSocket } = require("../../helpers/fake_ws");
const { DEV_STORAGE_USER_ID } = require("../../../infra/user_identity");

describe("session user identity bootstrap", function () {
  // This suite intentionally busts module caches to verify bootstrap identity
  // behavior against a fresh session module, so the cold import budget needs to
  // reflect the current session module size in test runs.
  this.timeout(60000);

  it("sets brain.userId from request identity before async initialization completes", () => {
    const appState = require(path.resolve(__dirname, "../../../infra/app_state.ts"));
    const previousDbReady = appState.isDbReady();
    const previousRedisReady = appState.isRedisReady();
    const previousMemoryMode = appState.getMemoryMode();
    appState.setDbReady(false);
    appState.setRedisReady(false);
    appState.setMemoryMode("in-memory");

    const sessionPath = path.resolve(__dirname, "../../../server/session/index.ts");
    delete require.cache[require.resolve(sessionPath)];
    const { createSession } = require(sessionPath);

    const ws = new FakeWebSocket();
    try {
      const session = createSession(ws, { headers: {} } as any);
      assert.equal(session.storageUserId, DEV_STORAGE_USER_ID);
      assert.equal(session.brain.userId, DEV_STORAGE_USER_ID);
    } finally {
      ws.close();
      appState.setDbReady(previousDbReady);
      appState.setRedisReady(previousRedisReady);
      appState.setMemoryMode(previousMemoryMode);
      delete require.cache[require.resolve(sessionPath)];
    }
  });

  it("hydrates the saved persona preset after resolving the storage user id", async () => {
    const appState = require(path.resolve(__dirname, "../../../infra/app_state.ts"));
    const previousDbReady = appState.isDbReady();
    appState.setDbReady(true);

    const ensureStorageUserPath = path.resolve(
      __dirname,
      "../../../storage/repositories/dev_identity.ts",
    );
    const sessionRepositoryPath = path.resolve(
      __dirname,
      "../../../storage/repositories/session_repository.ts",
    );
    const messageRepositoryPath = path.resolve(
      __dirname,
      "../../../storage/repositories/message_repository.ts",
    );
    const pgMemoryRepositoryPath = path.resolve(
      __dirname,
      "../../../storage/repositories/pg_memory_repository.ts",
    );
    const personaPresetRepositoryPath = path.resolve(
      __dirname,
      "../../../storage/repositories/user_persona_preset_repository.ts",
    );
    const relationshipStatePath = path.resolve(
      __dirname,
      "../../../memory/relationship_state.ts",
    );
    const bootstrapPath = path.resolve(__dirname, "../../../server/session/bootstrap.ts");

    const devIdentityRepo = require(ensureStorageUserPath);
    const sessionRepo = require(sessionRepositoryPath);
    const messageRepo = require(messageRepositoryPath);
    const pgMemoryRepo = require(pgMemoryRepositoryPath);
    const personaPresetRepo = require(personaPresetRepositoryPath);
    const relationshipState = require(relationshipStatePath);

    const originalEnsureStorageUser = devIdentityRepo.ensureStorageUser;
    const originalCreateDbSession = sessionRepo.createSession;
    const originalGetUserMessagesPage = messageRepo.getUserMessagesPage;
    const originalGetPgMemoryRepository = pgMemoryRepo.getPgMemoryRepository;
    const originalGetUserPersonaPreset = personaPresetRepo.getUserPersonaPreset;
    const originalRelationshipStateEnabled = relationshipState.relationshipStateEnabled;
    const originalLoadPersistentRelationshipState = relationshipState.loadPersistentRelationshipState;

    delete require.cache[require.resolve(bootstrapPath)];

    devIdentityRepo.ensureStorageUser = async () => "resolved-user-id";
    sessionRepo.createSession = async () => ({ id: "session-1" });
    messageRepo.getUserMessagesPage = async () => ({ messages: [], nextCursor: null });
    pgMemoryRepo.getPgMemoryRepository = () => ({
      getByKey: async () => null,
      getAll: async () => [],
    });
    personaPresetRepo.getUserPersonaPreset = async (userId) => {
      assert.equal(userId, "resolved-user-id");
      return "playful_attached";
    };
    relationshipState.relationshipStateEnabled = () => true;
    relationshipState.loadPersistentRelationshipState = async () => ({
      version: "v1",
      updatedAt: Date.now(),
      lastEmotion: "sad",
      userProfile: { interests: [], personalityNotes: [] },
      relationship: {
        familiarity: 0.62,
        emotionalBond: 0.58,
        turnCount: 12,
        preferredTopics: ["工作"],
      },
      topicHistory: [{ topic: "工作", depth: 5, lastTurn: 12, sentiment: "negative" }],
      moodTrajectory: [{ turn: 12, mood: "低落" }],
      conversationSummary: "最近一直在聊工作压力。",
      proactiveTopics: ["工作"],
      sharedMoments: [
        {
          turn: 12,
          summary: "工作压力还没过去",
          topic: "工作",
          kind: "stress",
          mood: "低落",
          salience: 0.9,
          unresolved: true,
        },
      ],
      episodes: [],
      topicThreads: [],
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
    });

    try {
      const { initializeSessionStorage } = require(bootstrapPath);
      const { RemiSessionContext } = require("../../../brains/remi_session_context.ts");
      const brain = new RemiSessionContext("bootstrap-test");

      let capturedSessionId = null;
      await initializeSessionStorage({
        connId: "conn-1",
        storageUserId: DEV_STORAGE_USER_ID,
        authPrincipal: null,
        brain,
        historyPageSize: 20,
        setSessionId: (sessionId) => {
          capturedSessionId = sessionId;
        },
        sendHistoryPage: async () => {},
      });

      assert.equal(brain.userId, "resolved-user-id");
      assert.equal(brain.persona.profile.presetId, "playful_attached");
      assert.equal(brain.persona.profile.label, "活泼黏人");
      assert.equal(brain.persona.liveState.closeness, "relaxed");
      assert.equal(brain.persona.liveState.topicPull, "工作");
      assert.equal(brain.persona.liveState.attention, "hooked");
      assert.equal(brain.persona.liveState.relationalStance.mode, "anchored_care");
      assert.equal(capturedSessionId, "session-1");
    } finally {
      devIdentityRepo.ensureStorageUser = originalEnsureStorageUser;
      sessionRepo.createSession = originalCreateDbSession;
      messageRepo.getUserMessagesPage = originalGetUserMessagesPage;
      pgMemoryRepo.getPgMemoryRepository = originalGetPgMemoryRepository;
      personaPresetRepo.getUserPersonaPreset = originalGetUserPersonaPreset;
      relationshipState.relationshipStateEnabled = originalRelationshipStateEnabled;
      relationshipState.loadPersistentRelationshipState = originalLoadPersistentRelationshipState;
      delete require.cache[require.resolve(bootstrapPath)];
      appState.setDbReady(previousDbReady);
    }
  });
});
