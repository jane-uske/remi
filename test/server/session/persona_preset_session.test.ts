const assert = require("assert").strict;
const path = require("path");
const appState = require("../../../infra/app_state.ts");

const { FakeWebSocket } = require("../../helpers/fake_ws");
const { loadSessionHarness, waitFor } = require("../../helpers/session_harness");

const SESSION_EVENT_TIMEOUT_MS = 5000;

describe("session persona preset protocol", function () {
  // Cold-loading server/session/index.ts under ts-node is slow enough that the
  // default Mocha budget trips before the protocol assertions even start.
  this.timeout(60000);

  it("routes get/set persona preset messages through the session router", () => {
    const { attachSessionMessageHandlers } = require("../../../server/session/message_router.ts");

    const ws = new FakeWebSocket();
    const calls = [];

    attachSessionMessageHandlers({
      ws,
      connId: "conn-persona-router",
      storageUserId: "user-persona-router",
      parseHistoryCursor: () => null,
      sendHistoryPage: async () => {},
      handleAudioPcm: () => {
        throw new Error("unexpected binary audio path");
      },
      runDevApplyPreset: () => {
        throw new Error("unexpected dev preset path");
      },
      runDevSetTtsVoice: () => {
        throw new Error("unexpected dev voice path");
      },
      runDevResetState: () => {
        throw new Error("unexpected dev reset path");
      },
      handleGetPersonaPreset: () => {
        calls.push({ type: "get" });
      },
      handleSetPersonaPreset: (data) => {
        calls.push({ type: "set", data });
      },
      handleDuplexStart: () => {
        throw new Error("unexpected duplex start");
      },
      handleDuplexStop: () => {
        throw new Error("unexpected duplex stop");
      },
      handleAudioStream: () => {
        throw new Error("unexpected audio stream");
      },
      handleAudioChunk: () => {
        throw new Error("unexpected audio chunk");
      },
      handleAudioEnd: () => {
        throw new Error("unexpected audio end");
      },
      handlePlaybackStart: () => {
        throw new Error("unexpected playback start");
      },
      handlePlaybackEnd: () => {
        throw new Error("unexpected playback end");
      },
      handleClientContext: () => {
        throw new Error("unexpected client context");
      },
      handleChat: () => {
        throw new Error("unexpected chat path");
      },
    });

    ws.emitMessage(JSON.stringify({ type: "get_persona_preset" }));
    ws.emitMessage(JSON.stringify({ type: "set_persona_preset", presetId: "playful_attached" }));

    assert.deepEqual(calls, [
      { type: "get" },
      { type: "set", data: { type: "set_persona_preset", presetId: "playful_attached" } },
    ]);
  });

  it("emits the current persona preset when requested", async () => {
    const { ws, session, restore } = loadSessionHarness();
    try {
      await waitFor(() => session.personaPresetBootstrapReady === true, SESSION_EVENT_TIMEOUT_MS);

      const stateMessagesBefore = ws
        .parsedMessages()
        .filter(
          (msg) =>
            msg?.type === "persona_preset_state" &&
            msg.presetId === session.brain.persona.profile.presetId,
        ).length;

      ws.emitMessage(JSON.stringify({ type: "get_persona_preset" }));

      await waitFor(
        () =>
          ws
            .parsedMessages()
            .filter(
              (msg) =>
                msg?.type === "persona_preset_state" &&
                msg.presetId === session.brain.persona.profile.presetId,
            ).length > stateMessagesBefore,
        SESSION_EVENT_TIMEOUT_MS,
      );
    } finally {
      restore();
    }
  });

  it("rejects set_persona_preset when presetId is missing or invalid", async () => {
    const repoPath = path.resolve(
      __dirname,
      "../../../storage/repositories/user_persona_preset_repository.ts",
    );
    const repo = require(repoPath);
    const originalSave = repo.saveUserPersonaPreset;
    const saveCalls = [];
    repo.saveUserPersonaPreset = async (...args) => {
      saveCalls.push(args);
    };

    try {
      const { ws, session, restore } = loadSessionHarness();
      try {
        const initialPresetId = session.brain.persona.profile.presetId;
        await waitFor(
          () =>
            ws
              .parsedMessages()
              .some(
                (msg) =>
                  msg?.type === "persona_preset_state" &&
                  msg.presetId === initialPresetId,
              ),
          SESSION_EVENT_TIMEOUT_MS,
        );

        ws.emitMessage(JSON.stringify({ type: "set_persona_preset" }));
        ws.emitMessage(JSON.stringify({ type: "set_persona_preset", presetId: "not_real" }));

        await waitFor(
          () => ws.parsedMessages().filter((msg) => msg?.type === "error").length >= 2,
          SESSION_EVENT_TIMEOUT_MS,
        );

        const errors = ws.parsedMessages().filter((msg) => msg?.type === "error");
        assert.match(errors[0]?.content ?? "", /preset/i);
        assert.match(errors[1]?.content ?? "", /preset/i);
        assert.equal(session.brain.persona.profile.presetId, initialPresetId);
        assert.equal(saveCalls.length, 0);
      } finally {
        restore();
      }
    } finally {
      repo.saveUserPersonaPreset = originalSave;
      delete require.cache[repoPath];
    }
  });

  it("applies the preset, persists it, and emits persona_preset_state", async () => {
    const repoPath = path.resolve(
      __dirname,
      "../../../storage/repositories/user_persona_preset_repository.ts",
    );
    const repo = require(repoPath);
    const originalSave = repo.saveUserPersonaPreset;
    const saveCalls = [];
    repo.saveUserPersonaPreset = async (...args) => {
      saveCalls.push(args);
    };

    try {
      const { ws, session, restore } = loadSessionHarness();
      try {
        session.sessionId = "session-1";
        await waitFor(
          () =>
            ws
              .parsedMessages()
              .some(
                (msg) =>
                  msg?.type === "persona_preset_state" &&
                  msg.presetId === session.brain.persona.profile.presetId,
              ),
          SESSION_EVENT_TIMEOUT_MS,
        );

        ws.emitMessage(JSON.stringify({ type: "set_persona_preset", presetId: "playful_attached" }));

        await waitFor(
          () =>
            ws
              .parsedMessages()
              .some(
                (msg) =>
                  msg?.type === "persona_preset_state" && msg.presetId === "playful_attached",
              ),
          SESSION_EVENT_TIMEOUT_MS,
        );

        assert.equal(session.brain.persona.profile.presetId, "playful_attached");
        assert.deepEqual(saveCalls, [[session.brain.userId, "playful_attached"]]);
      } finally {
        restore();
      }
    } finally {
      repo.saveUserPersonaPreset = originalSave;
      delete require.cache[repoPath];
    }
  });

  it("rejects writes before async bootstrap settles, then uses the resolved user after bootstrap", async () => {
    const previousDbReady = appState.isDbReady();
    const previousRedisReady = appState.isRedisReady();
    const previousMemoryMode = appState.getMemoryMode();
    appState.setDbReady(true);
    appState.setRedisReady(false);
    appState.setMemoryMode("in-memory");

    const bootstrapPath = path.resolve(__dirname, "../../../server/session/bootstrap.ts");
    const sessionPath = path.resolve(__dirname, "../../../server/session/index.ts");
    const repoPath = path.resolve(
      __dirname,
      "../../../storage/repositories/user_persona_preset_repository.ts",
    );

    const bootstrap = require(bootstrapPath);
    const repo = require(repoPath);
    const originalInitialize = bootstrap.initializeSessionStorage;
    const originalSave = repo.saveUserPersonaPreset;

    const saveCalls = [];
    let releaseBootstrap;
    const bootstrapReady = new Promise((resolve) => {
      releaseBootstrap = resolve;
    });

    bootstrap.initializeSessionStorage = async ({ brain, setSessionId }) => {
      await bootstrapReady;
      brain.setUserId("resolved-user-id");
      brain.applyUserPersonaPreset("calm_healing");
      setSessionId("session-1");
    };
    repo.saveUserPersonaPreset = async (...args) => {
      saveCalls.push(args);
    };

    delete require.cache[require.resolve(sessionPath)];

    try {
      const { createSession } = require(sessionPath);
      const ws = new FakeWebSocket();
      const session = createSession(ws, { headers: {}, url: "/ws" });

      try {
        ws.emitMessage(JSON.stringify({ type: "set_persona_preset", presetId: "playful_attached" }));

        await waitFor(
          () =>
            ws
              .parsedMessages()
              .some(
                (msg) =>
                  msg?.type === "error" &&
                  /bootstrap|ready|稍后/i.test(String(msg.content ?? "")),
              ),
          SESSION_EVENT_TIMEOUT_MS,
        );

        assert.equal(session.brain.userId, session.storageUserId);
        assert.equal(session.brain.persona.profile.presetId, "witty_warm");
        assert.equal(saveCalls.length, 0);

        releaseBootstrap();

        await waitFor(
          () =>
            ws
              .parsedMessages()
              .some(
                (msg) => msg?.type === "persona_preset_state" && msg.presetId === "calm_healing",
              ),
          SESSION_EVENT_TIMEOUT_MS,
        );

        ws.emitMessage(JSON.stringify({ type: "set_persona_preset", presetId: "playful_attached" }));

        await waitFor(
          () =>
            ws
              .parsedMessages()
              .filter(
                (msg) =>
                  msg?.type === "persona_preset_state" && msg.presetId === "playful_attached",
              ).length >= 1,
          SESSION_EVENT_TIMEOUT_MS,
        );

        assert.equal(session.brain.userId, "resolved-user-id");
        assert.equal(session.brain.persona.profile.presetId, "playful_attached");
        assert.deepEqual(saveCalls, [["resolved-user-id", "playful_attached"]]);
      } finally {
        ws.close();
      }
    } finally {
      bootstrap.initializeSessionStorage = originalInitialize;
      repo.saveUserPersonaPreset = originalSave;
      delete require.cache[require.resolve(sessionPath)];
      delete require.cache[require.resolve(bootstrapPath)];
      delete require.cache[require.resolve(repoPath)];
      appState.setDbReady(previousDbReady);
      appState.setRedisReady(previousRedisReady);
      appState.setMemoryMode(previousMemoryMode);
    }
  });

  it("does not leak a live preset change when repository persistence fails", async () => {
    const previousDbReady = appState.isDbReady();
    const previousRedisReady = appState.isRedisReady();
    const previousMemoryMode = appState.getMemoryMode();
    appState.setDbReady(true);
    appState.setRedisReady(false);
    appState.setMemoryMode("in-memory");

    const bootstrapPath = path.resolve(__dirname, "../../../server/session/bootstrap.ts");
    const sessionPath = path.resolve(__dirname, "../../../server/session/index.ts");
    const repoPath = path.resolve(
      __dirname,
      "../../../storage/repositories/user_persona_preset_repository.ts",
    );

    const bootstrap = require(bootstrapPath);
    const repo = require(repoPath);
    const originalInitialize = bootstrap.initializeSessionStorage;
    const originalSave = repo.saveUserPersonaPreset;

    bootstrap.initializeSessionStorage = async ({ brain, setSessionId }) => {
      brain.setUserId("resolved-user-id");
      brain.applyUserPersonaPreset("calm_healing");
      setSessionId("session-1");
    };
    repo.saveUserPersonaPreset = async () => {
      throw new Error("db write failed");
    };

    delete require.cache[require.resolve(sessionPath)];

    try {
      const { createSession } = require(sessionPath);
      const ws = new FakeWebSocket();
      const session = createSession(ws, { headers: {}, url: "/ws" });

      try {
        await waitFor(
          () =>
            ws
              .parsedMessages()
              .some(
                (msg) => msg?.type === "persona_preset_state" && msg.presetId === "calm_healing",
              ),
          SESSION_EVENT_TIMEOUT_MS,
        );

        ws.emitMessage(JSON.stringify({ type: "set_persona_preset", presetId: "playful_attached" }));

        await waitFor(
          () =>
            ws
              .parsedMessages()
              .some(
                (msg) =>
                  msg?.type === "error" &&
                  /preset|db write failed|失败/i.test(String(msg.content ?? "")),
              ),
          SESSION_EVENT_TIMEOUT_MS,
        );

        assert.equal(session.brain.persona.profile.presetId, "calm_healing");
        assert.equal(
          ws
            .parsedMessages()
            .some(
              (msg) => msg?.type === "persona_preset_state" && msg.presetId === "playful_attached",
            ),
          false,
        );
      } finally {
        ws.close();
      }
    } finally {
      bootstrap.initializeSessionStorage = originalInitialize;
      repo.saveUserPersonaPreset = originalSave;
      delete require.cache[require.resolve(sessionPath)];
      delete require.cache[require.resolve(bootstrapPath)];
      delete require.cache[require.resolve(repoPath)];
      appState.setDbReady(previousDbReady);
      appState.setRedisReady(previousRedisReady);
      appState.setMemoryMode(previousMemoryMode);
    }
  });
});
