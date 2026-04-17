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

describe("pipeline tts transport routing", () => {
  async function runOnce(ttsTransport, runner) {
    const ws = new FakeWebSocket();
    const ctx = new RemiSessionContext(`tts-${ttsTransport}`);
    const ic = new InterruptController();
    const avatar = new AvatarController();
    await runner.runPipeline(ws, "测试输入", ic, avatar, null, ctx, 1, `trace-${ttsTransport}`, {
      ttsTransport,
    });
    return ws.parsedMessages();
  }

  it("keeps streaming for auto sessions when stream TTS is available", async () => {
    let streamCalls = 0;
    const runner = loadMockedRunner({
      canStream: true,
      streamImpl: async (text, onChunk) => {
        streamCalls += 1;
        onChunk({
          pcm: Buffer.from([0x01, 0x02, 0x03, 0x04]),
          sampleRate: 24000,
          channels: 1,
          bitsPerSample: 16,
        });
      },
      synthesize: async () => Buffer.from("voice"),
    });

    try {
      const messages = await runOnce("auto", runner);
      assert.equal(streamCalls > 0, true);
      assert.equal(messages.some((msg) => msg?.type === "voice_pcm_chunk"), true);
      assert.equal(messages.some((msg) => msg?.type === "voice"), false);
    } finally {
      runner.restore();
    }
  });

  it("forces buffered voice for buffered_voice sessions even when stream TTS is available", async () => {
    let streamCalls = 0;
    const runner = loadMockedRunner({
      canStream: true,
      streamImpl: async () => {
        streamCalls += 1;
      },
      synthesize: async () => Buffer.from("voice"),
    });

    try {
      const messages = await runOnce("buffered_voice", runner);
      assert.equal(streamCalls, 0);
      assert.equal(messages.some((msg) => msg?.type === "voice_pcm_chunk"), false);
      assert.equal(messages.some((msg) => msg?.type === "voice"), true);
    } finally {
      runner.restore();
    }
  });

  it("keeps streaming for pcm_stream_v1 sessions when stream TTS is available", async () => {
    let streamCalls = 0;
    const runner = loadMockedRunner({
      canStream: true,
      streamImpl: async (_text, onChunk) => {
        streamCalls += 1;
        onChunk({
          pcm: Buffer.from([0x01, 0x02, 0x03, 0x04]),
          sampleRate: 24000,
          channels: 1,
          bitsPerSample: 16,
        });
      },
      synthesize: async () => Buffer.from("voice"),
    });

    try {
      const messages = await runOnce("pcm_stream_v1", runner);
      assert.equal(streamCalls > 0, true);
      assert.equal(messages.some((msg) => msg?.type === "voice_pcm_chunk"), true);
      assert.equal(messages.some((msg) => msg?.type === "voice"), false);
    } finally {
      runner.restore();
    }
  });

  it("falls back to buffered voice when streaming fails before the first chunk", async () => {
    const runner = loadMockedRunner({
      canStream: true,
      streamImpl: async () => {
        throw new Error("stream boot failed");
      },
      synthesize: async () => Buffer.from("voice"),
    });

    try {
      const messages = await runOnce("pcm_stream_v1", runner);
      assert.equal(messages.some((msg) => msg?.type === "voice_pcm_chunk"), false);
      assert.equal(messages.some((msg) => msg?.type === "voice"), true);
    } finally {
      runner.restore();
    }
  });
});
