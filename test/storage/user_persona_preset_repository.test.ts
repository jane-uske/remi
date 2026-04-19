const assert = require("assert").strict;
const path = require("path");

const database = require("../../storage/database");
const { listPersonaPresets } = require("../../persona/presets.ts");

const repoPath = path.resolve(
  __dirname,
  "../../storage/repositories/user_persona_preset_repository.ts",
);

describe("user persona preset repository", () => {
  let originalQuery;

  beforeEach(() => {
    originalQuery = database.query;
  });

  afterEach(() => {
    database.query = originalQuery;
    delete require.cache[repoPath];
  });

  it("returns null when no active preset exists for the user", async () => {
    database.query = async (text, params) => {
      assert.match(text, /SELECT preset_id FROM user_persona_presets/);
      assert.deepEqual(params, ["user-1"]);
      return { rows: [] };
    };

    const { getUserPersonaPreset } = require(repoPath);
    const presetId = await getUserPersonaPreset("user-1");

    assert.equal(presetId, null);
  });

  it("upserts one active preset per user and reloads the latest value", async () => {
    const state = new Map();
    const calls = [];
    const presets = listPersonaPresets();
    const firstPresetId = presets[0].id;
    const secondPresetId = presets[1].id;

    database.query = async (text, params) => {
      calls.push({ text, params });
      if (/SELECT preset_id FROM user_persona_presets/.test(text)) {
        const presetId = state.get(params[0]);
        return {
          rows: presetId ? [{ preset_id: presetId }] : [],
        };
      }
      if (/INSERT INTO user_persona_presets/.test(text)) {
        state.set(params[0], params[1]);
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${text}`);
    };

    const { getUserPersonaPreset, saveUserPersonaPreset } = require(repoPath);

    await saveUserPersonaPreset("user-1", firstPresetId);
    assert.equal(await getUserPersonaPreset("user-1"), firstPresetId);

    await saveUserPersonaPreset("user-1", secondPresetId);
    assert.equal(await getUserPersonaPreset("user-1"), secondPresetId);

    assert.match(calls[0].text, /INSERT INTO user_persona_presets/);
    assert.match(calls[0].text, /ON CONFLICT \(user_id\) DO UPDATE/);
    assert.deepEqual(calls[0].params, ["user-1", firstPresetId]);
    assert.deepEqual(calls[1].params, ["user-1"]);
    assert.deepEqual(calls[2].params, ["user-1", secondPresetId]);
    assert.deepEqual(calls[3].params, ["user-1"]);
  });

  it("treats invalid stored preset ids as absent", async () => {
    database.query = async () => ({
      rows: [{ preset_id: "not-a-real-preset" }],
    });

    const { getUserPersonaPreset } = require(repoPath);
    const presetId = await getUserPersonaPreset("user-1");

    assert.equal(presetId, null);
  });

  it("surfaces database write failures when the user row is missing", async () => {
    const error = new Error("insert or update on table \"user_persona_presets\" violates foreign key constraint");
    database.query = async () => {
      throw error;
    };

    const { saveUserPersonaPreset } = require(repoPath);

    await assert.rejects(
      saveUserPersonaPreset("user-1", listPersonaPresets()[0].id),
      error,
    );
  });
});
