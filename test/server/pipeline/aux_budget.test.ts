const assert = require("assert").strict;
const path = require("path");

const { AvatarController } = require("../../../avatar/avatar_controller");
const { RemiSessionContext } = require("../../../brains/remi_session_context");
const { InterruptController } = require("../../../voice/interrupt_controller");
const { FakeWebSocket } = require("../../helpers/fake_ws");

function setEnvFlag(key, value) {
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
}

function loadMockedRouteMessage({ fastBrainStream, runSlowBrain }) {
  const fastBrainModulePath = path.resolve(__dirname, "../../../brains/fast_brain.ts");
  const slowBrainModulePath = path.resolve(__dirname, "../../../brains/slow_brain.ts");
  const brainRouterModulePath = path.resolve(__dirname, "../../../brains/brain_router.ts");
  const fastBrainModule = require(fastBrainModulePath);
  const slowBrainModule = require(slowBrainModulePath);

  const originalFastBrainStream = fastBrainModule.fastBrainStream;
  const originalRunSlowBrain = slowBrainModule.runSlowBrain;

  fastBrainModule.fastBrainStream = fastBrainStream;
  slowBrainModule.runSlowBrain = runSlowBrain;

  delete require.cache[brainRouterModulePath];
  const { routeMessage } = require(brainRouterModulePath);

  return {
    routeMessage,
    restore() {
      fastBrainModule.fastBrainStream = originalFastBrainStream;
      slowBrainModule.runSlowBrain = originalRunSlowBrain;
      delete require.cache[brainRouterModulePath];
    },
  };
}

function loadMockedRunner({ chatStream, inferAvatarIntentFromReply, synthesize }) {
  const runnerPath = path.resolve(__dirname, "../../../server/pipeline/runner.ts");
  const conversationAgentPath = path.resolve(__dirname, "../../../agents/conversation_agent.ts");
  const avatarIntentPath = path.resolve(__dirname, "../../../agents/avatar_intent_agent.ts");
  const ttsPath = path.resolve(__dirname, "../../../voice/tts.ts");
  const ttsStreamPath = path.resolve(__dirname, "../../../voice/tts_stream.ts");
  const appStatePath = path.resolve(__dirname, "../../../infra/app_state.ts");

  const appState = require(appStatePath);
  const previousDbReady = appState.isDbReady();

  require(conversationAgentPath);
  require(avatarIntentPath);

  const previousConversationAgent = require.cache[conversationAgentPath];
  const previousAvatarIntent = require.cache[avatarIntentPath];
  const previousTts = require.cache[ttsPath];
  const previousTtsStream = require.cache[ttsStreamPath];

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
    exports: { inferAvatarIntentFromReply },
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
  appState.setDbReady(false);

  delete require.cache[runnerPath];
  const { runPipeline } = require(runnerPath);

  return {
    runPipeline,
    restore() {
      delete require.cache[conversationAgentPath];
      delete require.cache[avatarIntentPath];
      delete require.cache[ttsPath];
      delete require.cache[ttsStreamPath];
      if (previousConversationAgent) {
        require.cache[conversationAgentPath] = previousConversationAgent;
      }
      if (previousAvatarIntent) {
        require.cache[avatarIntentPath] = previousAvatarIntent;
      }
      if (previousTts) {
        require.cache[ttsPath] = previousTts;
      }
      if (previousTtsStream) {
        require.cache[ttsStreamPath] = previousTtsStream;
      }
      appState.setDbReady(previousDbReady);
      delete require.cache[runnerPath];
    },
  };
}

describe("auxiliary llm budget gates", () => {
  it("skips slow brain when REMI_SLOW_BRAIN_ENABLED=0 but preserves the main reply path", async () => {
    const restoreEnv = setEnvFlag("REMI_SLOW_BRAIN_ENABLED", "0");
    const slowBrainCalls = [];
    const { routeMessage, restore } = loadMockedRouteMessage({
      fastBrainStream: async function* () {
        yield "主回复仍然正常";
      },
      runSlowBrain: async (...args) => {
        slowBrainCalls.push(args);
      },
    });

    try {
      const ctx = new RemiSessionContext("budget-slow-brain");
      const chunks = [];
      for await (const chunk of routeMessage(ctx, "继续聊", "neutral")) {
        chunks.push(chunk);
      }

      assert.equal(chunks.join(""), "主回复仍然正常");
      assert.deepEqual(ctx.history, [
        { role: "user", content: "继续聊" },
        { role: "assistant", content: "主回复仍然正常" },
      ]);
      assert.equal(slowBrainCalls.length, 0);
    } finally {
      restore();
      restoreEnv();
    }
  });

  it("skips avatar intent when REMI_AVATAR_INTENT_ENABLED=0 without affecting chat_end or TTS", async () => {
    const restoreEnv = setEnvFlag("REMI_AVATAR_INTENT_ENABLED", "0");
    const avatarIntentCalls = [];
    const { runPipeline, restore } = loadMockedRunner({
      chatStream: async function* () {
        yield "这一句主回复";
      },
      inferAvatarIntentFromReply: async (...args) => {
        avatarIntentCalls.push(args);
        return {
          intent: {
            emotion: "neutral",
            gesture: "none",
            gestureIntensity: 0,
            facialAccent: "none",
            energy: 0,
            holdMs: 500,
            source: "rule",
          },
          beats: [],
        };
      },
      synthesize: async () => Buffer.from("voice"),
    });

    try {
      const ws = new FakeWebSocket();
      const ctx = new RemiSessionContext("budget-avatar-intent");
      const ic = new InterruptController();
      const avatar = new AvatarController();

      await runPipeline(ws, "测试输入", ic, avatar, null, ctx, 1, "trace-budget");

      const messages = ws.parsedMessages();
      assert.equal(avatarIntentCalls.length, 0);
      assert.equal(messages.some((msg) => msg?.type === "avatar_intent"), false);
      assert.equal(messages.some((msg) => msg?.type === "chat_end"), true);
      assert.equal(messages.some((msg) => msg?.type === "voice"), true);
    } finally {
      restore();
      restoreEnv();
    }
  });
});
