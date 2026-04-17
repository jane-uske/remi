const assert = require("assert").strict;
const path = require("path");

const { AvatarController } = require("../../../avatar/avatar_controller");
const { RemiSessionContext } = require("../../../brains/remi_session_context");
const { InterruptController } = require("../../../voice/interrupt_controller");
const { FakeWebSocket } = require("../../helpers/fake_ws");

async function waitFor(predicate, timeoutMs = 500): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timeout after ${timeoutMs}ms`);
}

function loadMockedRunner({ chatStream, saveMessage, ttsStream, ttsModule, inferAvatarIntentFromReply }) {
  const runnerPath = path.resolve(__dirname, "../../../server/pipeline/runner.ts");
  const conversationAgentPath = path.resolve(__dirname, "../../../agents/conversation_agent.ts");
  const messageRepositoryPath = path.resolve(
    __dirname,
    "../../../storage/repositories/message_repository.ts",
  );
  const avatarIntentPath = path.resolve(__dirname, "../../../agents/avatar_intent_agent.ts");
  const appStatePath = path.resolve(__dirname, "../../../infra/app_state.ts");
  const ttsStreamPath = path.resolve(__dirname, "../../../voice/tts_stream.ts");
  const ttsPath = path.resolve(__dirname, "../../../voice/tts.ts");

  const appState = require(appStatePath);

  const originalConversationAgentModule = require.cache[conversationAgentPath];
  const originalMessageRepositoryModule = require.cache[messageRepositoryPath];
  const originalAvatarIntentModule = require.cache[avatarIntentPath];
  const originalTtsStreamModule = require.cache[ttsStreamPath];
  const originalTtsModule = require.cache[ttsPath];
  const previousDbReady = appState.isDbReady();

  require.cache[conversationAgentPath] = {
    id: conversationAgentPath,
    filename: conversationAgentPath,
    loaded: true,
    exports: { chatStream },
  };
  require.cache[messageRepositoryPath] = {
    id: messageRepositoryPath,
    filename: messageRepositoryPath,
    loaded: true,
    exports: { saveMessage },
  };
  require.cache[avatarIntentPath] = {
    id: avatarIntentPath,
    filename: avatarIntentPath,
    loaded: true,
    exports: {
      inferAvatarIntentFromReply:
        inferAvatarIntentFromReply ?? (async () => null),
    },
  };
  if (ttsStream) {
    require.cache[ttsStreamPath] = {
      id: ttsStreamPath,
      filename: ttsStreamPath,
      loaded: true,
      exports: ttsStream,
    };
  }
  if (ttsModule) {
    require.cache[ttsPath] = {
      id: ttsPath,
      filename: ttsPath,
      loaded: true,
      exports: ttsModule,
    };
  }
  appState.setDbReady(true);

  delete require.cache[runnerPath];
  const { runPipeline } = require(runnerPath);

  return {
    runPipeline,
    restore() {
      if (originalConversationAgentModule) {
        require.cache[conversationAgentPath] = originalConversationAgentModule;
      } else {
        delete require.cache[conversationAgentPath];
      }
      if (originalMessageRepositoryModule) {
        require.cache[messageRepositoryPath] = originalMessageRepositoryModule;
      } else {
        delete require.cache[messageRepositoryPath];
      }
      if (originalAvatarIntentModule) {
        require.cache[avatarIntentPath] = originalAvatarIntentModule;
      } else {
        delete require.cache[avatarIntentPath];
      }
      if (originalTtsStreamModule) {
        require.cache[ttsStreamPath] = originalTtsStreamModule;
      } else {
        delete require.cache[ttsStreamPath];
      }
      if (originalTtsModule) {
        require.cache[ttsPath] = originalTtsModule;
      } else {
        delete require.cache[ttsPath];
      }
      appState.setDbReady(previousDbReady);
      delete require.cache[runnerPath];
    },
  };
}

describe("pipeline interruption persistence", () => {
  it("does not persist an interrupted assistant partial as a normal assistant message", async () => {
    let releasePending = () => {};
    const pending = new Promise((resolve) => {
      releasePending = resolve;
    });
    const savedMessages = [];
    const { runPipeline, restore } = loadMockedRunner({
      chatStream: async function* (_ctx, _text, _emotion, signal) {
        yield "我先说一半";
        await pending;
        if (signal?.aborted) {
          return;
        }
        yield "，这句不该被保存";
      },
      saveMessage: async (sessionId, role, content) => {
        savedMessages.push({ sessionId, role, content });
        return {
          id: "msg-1",
          session_id: sessionId,
          role,
          content,
          created_at: new Date(),
        };
      },
    });

    try {
      const ws = new FakeWebSocket();
      const ctx = new RemiSessionContext("conn-test");
      const ic = new InterruptController();
      const avatar = new AvatarController();
      const pipelinePromise = runPipeline(
        ws,
        "继续说",
        ic,
        avatar,
        "session-1",
        ctx,
        1,
        "trace-1",
      );

      await waitFor(() =>
        ws.parsedMessages().some((msg) => msg && msg.type === "chat_chunk"),
      );
      ic.interrupt();
      releasePending();

      await pipelinePromise;

      assert.deepEqual(
        savedMessages.map((msg) => [msg.role, msg.content]),
        [["user", "继续说"]],
      );
      assert.equal(ctx.lastInterruptedReply, "我先说一半");
    } finally {
      restore();
    }
  });

  it("releases the pipeline promptly after abort even if TTS does not settle", async () => {
    const { runPipeline, restore } = loadMockedRunner({
      chatStream: async function* () {
        yield "我先说一句完整的话。";
      },
      saveMessage: async () => ({
        id: "msg-1",
        session_id: "session-1",
        role: "user",
        content: "继续说",
        created_at: new Date(),
      }),
      ttsStream: {
        isTtsEnabled: () => true,
        synthesize: async () => new Promise(() => {}),
      },
      ttsModule: {
        canStreamTextToSpeech: () => false,
        streamTextToSpeech: async () => {},
      },
    });

    try {
      const ws = new FakeWebSocket();
      const ctx = new RemiSessionContext("conn-test");
      const ic = new InterruptController();
      const avatar = new AvatarController();
      const pipelinePromise = runPipeline(
        ws,
        "继续说",
        ic,
        avatar,
        "session-1",
        ctx,
        1,
        "trace-early-abort",
      );

      await waitFor(() =>
        ws.parsedMessages().some((msg) => msg && msg.type === "chat_chunk"),
      );
      ic.interrupt();

      await Promise.race([
        pipelinePromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("pipeline did not release after abort")), 200),
        ),
      ]);
    } finally {
      restore();
    }
  });

  it("releases the pipeline promptly after abort even if avatar intent is still pending", async () => {
    let releaseAvatarIntent = () => {};
    const pendingAvatarIntent = new Promise((resolve) => {
      releaseAvatarIntent = resolve;
    });
    const { runPipeline, restore } = loadMockedRunner({
      chatStream: async function* () {
        yield "我先说一句完整的话。";
      },
      saveMessage: async () => ({
        id: "msg-1",
        session_id: "session-1",
        role: "user",
        content: "继续说",
        created_at: new Date(),
      }),
      inferAvatarIntentFromReply: async () => {
        await pendingAvatarIntent;
        return null;
      },
    });

    try {
      const ws = new FakeWebSocket();
      const ctx = new RemiSessionContext("conn-test");
      const ic = new InterruptController();
      const avatar = new AvatarController();
      const pipelinePromise = runPipeline(
        ws,
        "继续说",
        ic,
        avatar,
        "session-1",
        ctx,
        1,
        "trace-avatar-intent-abort",
      );

      await waitFor(() =>
        ws.parsedMessages().some((msg) => msg && msg.type === "chat_chunk"),
      );
      ic.interrupt();

      await Promise.race([
        pipelinePromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("pipeline still blocked by avatar intent after abort")), 200),
        ),
      ]);

      releaseAvatarIntent();
    } finally {
      restore();
    }
  });
});
