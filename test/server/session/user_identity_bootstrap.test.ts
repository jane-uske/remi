const assert = require("assert").strict;
const path = require("path");

const { FakeWebSocket } = require("../../helpers/fake_ws");
const { DEV_STORAGE_USER_ID } = require("../../../infra/user_identity");

describe("session user identity bootstrap", () => {
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
});
