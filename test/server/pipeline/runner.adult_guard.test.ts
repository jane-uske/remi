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
  const appStatePath = path.resolve(__dirname, "../../../infra/app_state.ts");

  const appState = require(appStatePath);
  const previousDbReady = appState.isDbReady();
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
      appState.setDbReady(previousDbReady);
      delete require.cache[runnerPath];
    },
  };
}

describe("pipeline adult guard", () => {
  it("sanitizes unsafe adult phrasing before chat chunks and TTS see it", async () => {
    await withEnv({ REMI_ADULT_MODE: "1" }, async () => {
      const spoken = [];
      const { runPipeline, restore } = loadMockedRunner({
        chatStream: async function* () {
          yield "骚逼都湿了呢～你是不是又想被我操？";
        },
        synthesize: async (text) => {
          spoken.push(text);
          return Buffer.from("voice");
        },
      });

      try {
        const ws = new FakeWebSocket();
        const ctx = new RemiSessionContext("adult-guard");
        ctx.persona.liveState.adultSceneState = {
          mode: "flirt",
          allowedExplicit: false,
          initiatedByUser: false,
          turnsSinceLastExplicitCue: 1,
          cooldownOrBoundaryHit: false,
          explicitCueStreak: 0,
          beat: "entry",
          intensity: "tease",
        };
        const ic = new InterruptController();
        const avatar = new AvatarController();

        await runPipeline(ws, "哈喽Remi，今天好无聊啊～你呢？", ic, avatar, null, ctx, 1, "trace-adult-guard");

        const streamed = ws.parsedMessages()
          .filter((msg) => msg?.type === "chat_chunk")
          .map((msg) => msg.content)
          .join("");

        assert.ok(!streamed.includes("骚逼"));
        assert.ok(!streamed.includes("被我操"));
        assert.ok(streamed.includes("继续逗我"));
        assert.equal(spoken.length > 0, true);
        assert.ok(!spoken.some((text) => text.includes("被我操")));
      } finally {
        restore();
      }
    });
  });

  it("strips leaked performance directions before chat chunks and TTS see them", async () => {
    await withEnv({ REMI_ADULT_MODE: "1" }, async () => {
      const spoken = [];
      const { runPipeline, restore } = loadMockedRunner({
        chatStream: async function* () {
          yield "我靠在你肩上，呼吸轻缓地和你同步，声音低沉，“你说我骚……”指尖轻轻划过你的锁骨，“现在，轮到你来决定——是继续这样暧昧下去，还是……”尾音拖得极长。";
        },
        synthesize: async (text) => {
          spoken.push(text);
          return Buffer.from("voice");
        },
      });

      try {
        const ws = new FakeWebSocket();
        const ctx = new RemiSessionContext("adult-guard-performance");
        ctx.persona.liveState.adultSceneState = {
          mode: "explicit",
          allowedExplicit: true,
          initiatedByUser: true,
          turnsSinceLastExplicitCue: 0,
          cooldownOrBoundaryHit: false,
          explicitCueStreak: 1,
          beat: "entry",
          intensity: "charged",
        };
        const ic = new InterruptController();
        const avatar = new AvatarController();

        await runPipeline(ws, "继续。", ic, avatar, null, ctx, 1, "trace-adult-guard-performance");

        const streamed = ws.parsedMessages()
          .filter((msg) => msg?.type === "chat_chunk")
          .map((msg) => msg.content)
          .join("");

        assert.ok(streamed.includes("我靠在你肩上"));
        assert.ok(streamed.includes("指尖轻轻划过你的锁骨"));
        assert.ok(!streamed.includes("声音低沉"));
        assert.ok(!streamed.includes("尾音拖得极长"));
        assert.equal(spoken.length > 0, true);
        assert.ok(!spoken.some((text) => text.includes("声音低沉")));
        assert.ok(!spoken.some((text) => text.includes("尾音拖得极长")));
      } finally {
        restore();
      }
    });
  });
});
