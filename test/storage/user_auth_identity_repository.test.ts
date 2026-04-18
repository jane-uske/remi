const assert = require("assert").strict;
const path = require("path");

const database = require("../../storage/database");
const repoPath = path.resolve(
  __dirname,
  "../../storage/repositories/user_auth_identity_repository.ts",
);

describe("user auth identity repository", () => {
  let originalQuery;

  beforeEach(() => {
    originalQuery = database.query;
  });

  afterEach(() => {
    database.query = originalQuery;
    delete require.cache[repoPath];
  });

  it("upserts auth identities and returns the linked internal user id", async () => {
    const calls = [];
    database.query = async (text, params) => {
      calls.push({ text, params });
      if (/RETURNING user_id/.test(text)) {
        return { rows: [{ user_id: "00000000-0000-4000-8000-00000000c1e0" }] };
      }
      return { rows: [], rowCount: 1 };
    };

    const { ensureUserAuthIdentity } = require(repoPath);
    const userId = await ensureUserAuthIdentity({
      userId: "00000000-0000-4000-8000-00000000c1e0",
      provider: "clerk",
      providerUserId: "user_clerk_123",
      email: "remi@example.com",
    });

    assert.equal(userId, "00000000-0000-4000-8000-00000000c1e0");
    assert.equal(calls.length, 2);
    assert.match(calls[0].text, /INSERT INTO users/);
    assert.match(calls[1].text, /INSERT INTO user_auth_identities/);
    assert.deepEqual(calls[1].params, [
      "00000000-0000-4000-8000-00000000c1e0",
      "clerk",
      "user_clerk_123",
      "remi@example.com",
    ]);
  });
});
