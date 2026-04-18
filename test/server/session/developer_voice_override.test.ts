const assert = require("assert").strict;
const path = require("path");

const { loadSessionHarness, waitFor } = require("../../helpers/session_harness");

const ttsRuntimeOverridesPath = path.resolve(
  __dirname,
  "../../../voice/tts_runtime_overrides.ts",
);
const ttsVolcPath = path.resolve(__dirname, "../../../voice/tts_volc.ts");

async function withEnv(overrides, fn) {
  const restore = Object.entries(overrides).map(([key, value]) => {
    const previous = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
    return () => {
      if (previous === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous;
      }
    };
  });

  try {
    return await fn();
  } finally {
    for (const undo of restore.reverse()) undo();
  }
}

describe("session developer voice override wiring", () => {
  afterEach(() => {
    delete require.cache[ttsRuntimeOverridesPath];
    delete require.cache[ttsVolcPath];
  });

  it("switches the current session Volc voice without restart", async () => {
    withEnv(
      {
        VOLC_TTS_API_KEY: "volc-key",
        VOLC_TTS_RESOURCE_ID: "seed-tts-2.0",
        VOLC_TTS_VOICE_TYPE: "zh_female_lingling_uranus_bigtts",
      },
      async () => {
        const { resolveVolcTtsConfig } = require(ttsVolcPath);
        const { ws, session, restore } = loadSessionHarness();
        try {
          ws.emitMessage(
            Buffer.from(
              JSON.stringify({
                type: "dev_set_tts_voice",
                voiceType: "zh_female_custom_runtime_bigtts",
              }),
            ),
          );

          await waitFor(() =>
            ws.parsedMessages().some((msg) => msg?.type === "dev_tts_voice_applied"),
          );

          const last = ws.parsedMessages().at(-1);
          assert.equal(last?.type, "dev_tts_voice_applied");
          assert.equal(last?.voiceType, "zh_female_custom_runtime_bigtts");
          assert.equal(
            resolveVolcTtsConfig(undefined, undefined, { connId: session.connId })?.voiceType,
            "zh_female_custom_runtime_bigtts",
          );
        } finally {
          restore();
        }
      },
    );
  });

  it("clears the session voice override when reset to env default or the session closes", async () => {
    withEnv(
      {
        VOLC_TTS_API_KEY: "volc-key",
        VOLC_TTS_RESOURCE_ID: "seed-tts-2.0",
        VOLC_TTS_VOICE_TYPE: "zh_female_lingling_uranus_bigtts",
      },
      async () => {
        const {
          getSessionTtsRuntimeOverride,
        } = require(ttsRuntimeOverridesPath);
        const { ws, session, restore } = loadSessionHarness();
        try {
          ws.emitMessage(
            Buffer.from(
              JSON.stringify({
                type: "dev_set_tts_voice",
                voiceType: "zh_female_custom_runtime_bigtts",
              }),
            ),
          );
          await waitFor(
            () =>
              getSessionTtsRuntimeOverride(session.connId)?.volcVoiceType ===
              "zh_female_custom_runtime_bigtts",
          );
          assert.equal(
            getSessionTtsRuntimeOverride(session.connId)?.volcVoiceType,
            "zh_female_custom_runtime_bigtts",
          );

          ws.emitMessage(
            Buffer.from(
              JSON.stringify({
                type: "dev_set_tts_voice",
                voiceType: "__env_default__",
              }),
            ),
          );
          await waitFor(() => getSessionTtsRuntimeOverride(session.connId) === null);
          assert.equal(getSessionTtsRuntimeOverride(session.connId), null);

          ws.emitMessage(
            Buffer.from(
              JSON.stringify({
                type: "dev_set_tts_voice",
                voiceType: "zh_female_custom_runtime_bigtts",
              }),
            ),
          );
          await waitFor(
            () =>
              getSessionTtsRuntimeOverride(session.connId)?.volcVoiceType ===
              "zh_female_custom_runtime_bigtts",
          );
        } finally {
          restore();
        }

        assert.equal(getSessionTtsRuntimeOverride(session.connId), null);
      },
    );
  });
});
