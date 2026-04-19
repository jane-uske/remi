const assert = require("assert").strict;
const path = require("path");

const { AvatarController } = require("../../../avatar/avatar_controller");
const { RemiSessionContext } = require("../../../brains/remi_session_context");
const { InterruptController } = require("../../../voice/interrupt_controller");
const { FakeWebSocket } = require("../../helpers/fake_ws");

function loadMockedRunner({
  canStream,
  streamImpl,
  synthesize,
  synthesizeResult,
}) {
  const runnerPath = path.resolve(__dirname, "../../../server/pipeline/runner.ts");
  const conversationAgentPath = path.resolve(__dirname, "../../../agents/conversation_agent.ts");
  const avatarIntentPath = path.resolve(__dirname, "../../../agents/avatar_intent_agent.ts");
  const ttsPath = path.resolve(__dirname, "../../../voice/tts.ts");
  const ttsStreamPath = path.resolve(__dirname, "../../../voice/tts_stream.ts");
  const loggerPath = path.resolve(__dirname, "../../../infra/logger.ts");
  const appStatePath = path.resolve(__dirname, "../../../infra/app_state.ts");

  const appState = require(appStatePath);
  const previousDbReady = appState.isDbReady();
  const previousConversationAgent = require.cache[conversationAgentPath];
  const previousAvatarIntent = require.cache[avatarIntentPath];
  const previousTts = require.cache[ttsPath];
  const previousTtsStream = require.cache[ttsStreamPath];
  const previousLogger = require.cache[loggerPath];

  require.cache[conversationAgentPath] = {
    id: conversationAgentPath,
    filename: conversationAgentPath,
    loaded: true,
    exports: {
      chatStream: async function* () {
        yield "你好。";
      },
    },
  };
  require.cache[avatarIntentPath] = {
    id: avatarIntentPath,
    filename: avatarIntentPath,
    loaded: true,
    exports: { inferAvatarIntentFromReply: async () => null },
  };
  require.cache[ttsPath] = {
    id: ttsPath,
    filename: ttsPath,
    loaded: true,
    exports: {
      canStreamTextToSpeech: () => canStream,
      streamTextToSpeech: streamImpl,
    },
  };
  require.cache[ttsStreamPath] = {
    id: ttsStreamPath,
    filename: ttsStreamPath,
    loaded: true,
    exports: {
      isTtsEnabled: () => true,
      synthesize,
      synthesizeResult,
    },
  };
  require.cache[loggerPath] = {
    id: loggerPath,
    filename: loggerPath,
    loaded: true,
    exports: {
      createLogger: () => ({
        info() {},
        warn() {},
        error() {},
        debug() {},
      }),
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
    },
  };
  appState.setDbReady(false);

  delete require.cache[runnerPath];
  const { runPipeline } = require(runnerPath);

  return {
    runPipeline,
    restore() {
      if (previousConversationAgent) {
        require.cache[conversationAgentPath] = previousConversationAgent;
      } else {
        delete require.cache[conversationAgentPath];
      }
      if (previousAvatarIntent) {
        require.cache[avatarIntentPath] = previousAvatarIntent;
      } else {
        delete require.cache[avatarIntentPath];
      }
      if (previousTts) {
        require.cache[ttsPath] = previousTts;
      } else {
        delete require.cache[ttsPath];
      }
      if (previousTtsStream) {
        require.cache[ttsStreamPath] = previousTtsStream;
      } else {
        delete require.cache[ttsStreamPath];
      }
      if (previousLogger) {
        require.cache[loggerPath] = previousLogger;
      } else {
        delete require.cache[loggerPath];
      }
      appState.setDbReady(previousDbReady);
      delete require.cache[runnerPath];
    },
  };
}

describe("pipeline tts lip sync transport", () => {
  async function runOnce(ttsTransport, runner) {
    const ws = new FakeWebSocket();
    const ctx = new RemiSessionContext(`tts-lip-${ttsTransport}`);
    const ic = new InterruptController();
    const avatar = new AvatarController();
    await runner.runPipeline(ws, "测试输入", ic, avatar, null, ctx, 7, `trace-lip-${ttsTransport}`, {
      ttsTransport,
    });
    return ws.parsedMessages();
  }

  it("sends a replace lip-sync timeline with buffered voice", async () => {
    const runner = loadMockedRunner({
      canStream: false,
      streamImpl: async () => {},
      synthesize: async () => Buffer.from("voice"),
      synthesizeResult: async () => ({
        audio: Buffer.from("voice"),
        lipSync: {
          source: "provider_word_boundary_derived",
          mode: "replace",
          complete: true,
          cues: [
            {
              offsetMs: 40,
              durationMs: 180,
              viseme: "aa",
              weight: 0.72,
              token: "你好",
            },
          ],
        },
      }),
    });

    try {
      const messages = await runOnce("buffered_voice", runner);
      const lipSync = messages.find((msg) => msg?.type === "tts_lip_sync");
      assert.ok(lipSync);
      assert.equal(lipSync.generationId, 7);
      assert.equal(lipSync.mode, "replace");
      assert.equal(lipSync.complete, true);
      assert.equal(lipSync.cues.length, 1);
      assert.equal(messages.some((msg) => msg?.type === "voice"), true);
    } finally {
      runner.restore();
    }
  });

  it("streams append lip-sync chunks without blocking pcm audio", async () => {
    const runner = loadMockedRunner({
      canStream: true,
      streamImpl: async (_text, onChunk, _signal, _emotion, onLipSyncChunk) => {
        onLipSyncChunk?.({
          source: "provider_word_boundary_derived",
          mode: "append",
          complete: false,
          cues: [
            {
              offsetMs: 0,
              durationMs: 140,
              viseme: "aa",
              weight: 0.68,
              token: "你",
            },
          ],
        });
        onChunk({
          pcm: Buffer.from([0x01, 0x02, 0x03, 0x04]),
          sampleRate: 24000,
          channels: 1,
          bitsPerSample: 16,
        });
      },
      synthesize: async () => Buffer.from("voice"),
      synthesizeResult: async () => ({
        audio: Buffer.from("voice"),
      }),
    });

    try {
      const messages = await runOnce("pcm_stream_v1", runner);
      const lipSyncMessages = messages.filter((msg) => msg?.type === "tts_lip_sync");
      assert.equal(messages.some((msg) => msg?.type === "voice_pcm_chunk"), true);
      assert.equal(lipSyncMessages.length, 2);
      assert.equal(lipSyncMessages[0].mode, "append");
      assert.equal(lipSyncMessages[0].complete, false);
      assert.equal(lipSyncMessages[1].complete, true);
      assert.deepEqual(lipSyncMessages[1].cues, []);
    } finally {
      runner.restore();
    }
  });
});
