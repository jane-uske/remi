const assert = require("assert").strict;
const path = require("path");

const database = require("../../storage/database");

const schemaManagerPath = path.resolve(
  __dirname,
  "../../storage/schema_manager.ts",
);

describe("storage schema manager", () => {
  let originalGetPool;

  beforeEach(() => {
    originalGetPool = database.getPool;
  });

  afterEach(() => {
    database.getPool = originalGetPool;
    delete require.cache[schemaManagerPath];
  });

  it("applies the shared schema.sql against the initialized pool", async () => {
    const calls = [];
    database.getPool = () => ({
      query: async (sql) => {
        calls.push(sql);
        return { rows: [], rowCount: 0 };
      },
    });

    const { ensureStorageSchema } = require(schemaManagerPath);
    await ensureStorageSchema();

    assert.equal(calls.length, 1);
    assert.match(calls[0], /CREATE TABLE IF NOT EXISTS users/);
    assert.match(calls[0], /CREATE TABLE IF NOT EXISTS sessions/);
    assert.match(calls[0], /CREATE INDEX IF NOT EXISTS idx_messages_session_id/);
  });
});
