const assert = require("assert").strict;
const path = require("path");

describe("session developer preset helpers", () => {
  const developerPath = path.resolve(__dirname, "../../../server/session/developer.ts");
  const episodeRepoPath = path.resolve(
    __dirname,
    "../../../storage/repositories/episode_repository.ts",
  );
  const database = require("../../../storage/database");
  let originalQuery;

  beforeEach(() => {
    originalQuery = database.query;
  });

  afterEach(() => {
    database.query = originalQuery;
    delete require.cache[developerPath];
    delete require.cache[episodeRepoPath];
  });

  it("clears V2 episodes when relationship state is reset", async () => {
    const calls = [];
    database.query = async (text, params) => {
      calls.push({ text, params });
      return { rows: [], rowCount: 3 };
    };

    const { resetDeveloperState } = require(developerPath);

    const deletedKeys = [];
    const hydratedStates = [];
    let localCleared = 0;

    const runtime = {
      ws: {},
      brain: {
        userId: "user-dev-1",
        memory: {
          clearLocal: async () => {
            localCleared += 1;
          },
          getPersistentBackend: () => ({
            delete: async (key) => {
              deletedKeys.push(key);
            },
          }),
        },
        persistentRelationshipRepo: null,
        slowBrain: {
          hydratePersistentState: (state) => {
            hydratedStates.push(state);
          },
        },
        resetSessionArtifacts() {},
      },
      resetDeveloperLiveState() {},
      persistRelationshipContinuityState: async () => {},
    };

    await resetDeveloperState(runtime, { scope: "relationship" });

    assert.equal(calls.length, 2);
    assert.match(calls[0].text, /DELETE FROM messages m/);
    assert.deepEqual(calls[0].params, ["user-dev-1"]);
    assert.match(calls[1].text, /DELETE FROM episodes/);
    assert.deepEqual(calls[1].params, ["user-dev-1"]);
    assert.equal(localCleared, 0);
    assert.equal(deletedKeys.length, 1);
    assert.equal(hydratedStates.length, 1);
  });

  it("factory-resets all persistent memory when scope is all", async () => {
    const calls = [];
    database.query = async (text, params) => {
      calls.push({ text, params });
      return { rows: [], rowCount: 3 };
    };

    const { resetDeveloperState } = require(developerPath);

    const hydratedStates = [];
    let localCleared = 0;

    const runtime = {
      ws: {},
      brain: {
        userId: "user-dev-1",
        memory: {
          clearLocal: async () => {
            localCleared += 1;
          },
          getPersistentBackend: () => ({
            delete: async () => {},
          }),
        },
        persistentRelationshipRepo: null,
        slowBrain: {
          hydratePersistentState: (state) => {
            hydratedStates.push(state);
          },
        },
        resetSessionArtifacts() {},
      },
      resetDeveloperLiveState() {},
      persistRelationshipContinuityState: async () => {},
    };

    await resetDeveloperState(runtime, { scope: "all" });

    assert.equal(localCleared, 1);
    assert.equal(calls.length, 3);
    assert.match(calls[0].text, /DELETE FROM messages m/);
    assert.deepEqual(calls[0].params, ["user-dev-1"]);
    assert.match(calls[1].text, /DELETE FROM episodes/);
    assert.deepEqual(calls[1].params, ["user-dev-1"]);
    assert.match(calls[2].text, /DELETE FROM memories WHERE user_id = \$1/);
    assert.deepEqual(calls[2].params, ["user-dev-1"]);
    assert.equal(hydratedStates.length, 1);
  });

  it("does not clear persistent state when applying a preset", async () => {
    const calls = [];
    database.query = async (text, params) => {
      calls.push({ text, params });
      return { rows: [], rowCount: 0 };
    };

    const { applyDeveloperPreset } = require(developerPath);

    const personaPresets = [];
    const relationshipStates = [];
    let persisted = 0;

    const runtime = {
      ws: {},
      brain: {
        userId: "user-dev-1",
        memory: {
          clearLocal: async () => {},
          getPersistentBackend: () => ({
            delete: async () => {},
          }),
        },
        persistentRelationshipRepo: null,
        slowBrain: {
          hydratePersistentState() {},
        },
        applyPersonaPreset: (presetId) => {
          personaPresets.push(presetId);
        },
        hydratePersistentRelationshipState: (state) => {
          relationshipStates.push(state);
        },
        resetSessionArtifacts() {},
      },
      resetDeveloperLiveState() {},
      persistRelationshipContinuityState: async () => {
        persisted += 1;
      },
    };

    await applyDeveloperPreset(runtime, {
      personaPreset: "playful",
      relationshipPreset: "long_term",
      resetScope: "all",
    });

    assert.equal(calls.length, 0);
    assert.deepEqual(personaPresets, ["playful"]);
    assert.equal(relationshipStates.length, 1);
    assert.equal(persisted, 1);
  });
});
