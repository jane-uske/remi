const assert = require("assert").strict;
const path = require("path");

const { AvatarController } = require("../../../avatar/avatar_controller");
const { RemiSessionContext } = require("../../../brains/remi_session_context");
const { InterruptController } = require("../../../voice/interrupt_controller");
const { FakeWebSocket } = require("../../helpers/fake_ws");

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

function loadMockedRunner({ chatStream, synthesize }) {
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
  const debugLogs = [];

  require.cache[conversationAgentPath] = {
    id: conversationAgentPath,
    filename: conversationAgentPath,
    loaded: true,
    exports: { chatStream },
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
      canStreamTextToSpeech: () => false,
      streamTextToSpeech: async () => {},
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
        debug(message, data) {
          debugLogs.push({ message, data });
        },
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
    debugLogs,
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

describe("pipeline tts chunking", () => {
  it("queues a soft-break first segment without regressing text streaming", async () => {
    await withEnv(
      {
        TTS_EAGER_THRESHOLD: "24",
        TTS_EAGER_LOOKAHEAD_CHARS: "10",
        TTS_EAGER_SOFT_BREAK_MIN_CHARS: "24",
      },
      async () => {
        const reply =
          "如果这件事情你现在还想继续往前推一点点再多观察一下的话，我们最好先把主链路稳定住。";
        const expectedFirstSegment =
          "如果这件事情你现在还想继续往前推一点点再多观察一下的话，";
        const synthesizeCalls = [];
        const { runPipeline, debugLogs, restore } = loadMockedRunner({
          chatStream: async function* () {
            for (const ch of reply) {
              yield ch;
            }
          },
          synthesize: async (text) => {
            synthesizeCalls.push(text);
            return Buffer.from("voice");
          },
        });

        try {
          const ws = new FakeWebSocket();
          const ctx = new RemiSessionContext("tts-chunking");
          const ic = new InterruptController();
          const avatar = new AvatarController();

          await runPipeline(ws, "测试输入", ic, avatar, null, ctx, 1, "trace-tts-chunking");

          const messages = ws.parsedMessages();
          const streamedText = messages
            .filter((msg) => msg?.type === "chat_chunk")
            .map((msg) => msg.content)
            .join("");
          const firstSegmentLog = debugLogs.find(
            (entry) =>
              entry.message === "[TTS segment queued]" &&
              entry.data?.segmentIndex === 1,
          );

          assert.equal(streamedText, reply);
          assert.equal(messages.some((msg) => msg?.type === "interrupt"), false);
          assert.equal(synthesizeCalls[0], expectedFirstSegment);
          assert.equal(firstSegmentLog?.data?.boundaryType, "soft_break");
          assert.equal(firstSegmentLog?.data?.chars, expectedFirstSegment.length);
          assert.equal(firstSegmentLog?.data?.preview, expectedFirstSegment);
        } finally {
          restore();
        }
      },
    );
  });
});
