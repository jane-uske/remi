// 回复出口时间守卫 × chat_end finalContent（2026-07-04 收口）
//
// 生产案：守卫 drop 了坏句（TTS/持久化都拦住了），但 chat_chunk 流式文本
// 早已闪现并留在聊天界面上——体感等于守卫没干活。收口方案：chat_end 在
// 确实 drop 过句子时携带剔除后的终稿 finalContent，前端用它覆盖流式累积。
//
// 本文件测 finalContent 的出现条件（服务端侧）：
//   1. drop 生效（部分句被丢）→ chat_end 带 finalContent，且与持久化文本一致
//   2. 无违规 → chat_end 不带 finalContent 字段（前端行为不变）
//   3. 全部句子被丢（兜底放行）→ 不带 finalContent，原文照常持久化
//   4. detect 模式 → 只记 WARN，不 drop，不带 finalContent
const assert = require("assert").strict;
const path = require("path");

const { AvatarController } = require("../../../avatar/avatar_controller");
const { RemiSessionContext } = require("../../../brains/remi_session_context");
const { InterruptController } = require("../../../voice/interrupt_controller");
const { FakeWebSocket } = require("../../helpers/fake_ws");
const { resetConfig } = require("../../../server/config");

/** 取「Asia/Shanghai 的今天 + offset 天」的星期字（一二三四五六日）。 */
function weekdayCharWithOffset(offsetDays: number): string {
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const short = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    weekday: "short",
  }).format(new Date());
  const today = map[short] ?? new Date().getDay();
  return ["日", "一", "二", "三", "四", "五", "六"][(today + offsetDays) % 7];
}

async function withEnv(overrides: Record<string, string | undefined>, fn: () => Promise<void>) {
  const restore = Object.entries(overrides).map(([key, value]) => {
    const previous = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    return () => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    };
  });
  resetConfig();
  try {
    await fn();
  } finally {
    for (const undo of restore.reverse()) undo();
    resetConfig();
  }
}

function loadMockedRunner({ chatStream, saveMessage, warnSink }: any) {
  const runnerPath = path.resolve(__dirname, "../../../server/pipeline/runner.ts");
  const conversationAgentPath = path.resolve(__dirname, "../../../agents/conversation_agent.ts");
  const avatarIntentPath = path.resolve(__dirname, "../../../agents/avatar_intent_agent.ts");
  const ttsPath = path.resolve(__dirname, "../../../voice/tts.ts");
  const ttsStreamPath = path.resolve(__dirname, "../../../voice/tts_stream.ts");
  const loggerPath = path.resolve(__dirname, "../../../infra/logger.ts");
  const messageRepoPath = path.resolve(
    __dirname,
    "../../../storage/repositories/message_repository.ts",
  );
  const appStatePath = path.resolve(__dirname, "../../../infra/app_state.ts");

  const appState = require(appStatePath);
  const previousDbReady = appState.isDbReady();
  appState.setDbReady(true);

  const mockedPaths = [
    conversationAgentPath,
    avatarIntentPath,
    ttsPath,
    ttsStreamPath,
    loggerPath,
    messageRepoPath,
  ];
  const prev: Record<string, any> = {};
  for (const p of mockedPaths) prev[p] = require.cache[p];

  require.cache[conversationAgentPath] = {
    id: conversationAgentPath, filename: conversationAgentPath, loaded: true,
    exports: { chatStream },
  };
  require.cache[avatarIntentPath] = {
    id: avatarIntentPath, filename: avatarIntentPath, loaded: true,
    exports: { inferAvatarIntentFromReply: async () => null },
  };
  require.cache[ttsPath] = {
    id: ttsPath, filename: ttsPath, loaded: true,
    exports: { canStreamTextToSpeech: () => false, streamTextToSpeech: async () => {} },
  };
  require.cache[ttsStreamPath] = {
    id: ttsStreamPath, filename: ttsStreamPath, loaded: true,
    exports: { isTtsEnabled: () => true, synthesize: async () => Buffer.from("fake") },
  };
  require.cache[messageRepoPath] = {
    id: messageRepoPath, filename: messageRepoPath, loaded: true,
    exports: { saveMessage },
  };
  require.cache[loggerPath] = {
    id: loggerPath, filename: loggerPath, loaded: true,
    exports: {
      createLogger: () => ({
        info() {}, error() {}, debug() {},
        warn: (message: string, data: any) => warnSink(message, data),
      }),
      logger: { info() {}, warn() {}, error() {}, debug() {} },
    },
  };

  delete require.cache[runnerPath];
  const { runPipeline } = require(runnerPath);
  return {
    runPipeline,
    restore() {
      for (const p of mockedPaths) {
        if (prev[p]) require.cache[p] = prev[p];
        else delete require.cache[p];
      }
      appState.setDbReady(previousDbReady);
      delete require.cache[runnerPath];
    },
  };
}

interface RunCase {
  guardMode: string;
  replyChunks: string[];
}

async function runGuardCase({ guardMode, replyChunks }: RunCase) {
  const warnLogs: Array<{ message: string; data: any }> = [];
  const savedMessages: Array<{ role: string; content: string }> = [];
  let result: any = null;

  await withEnv({ REMI_REPLY_TIME_GUARD: guardMode, REMI_TZ: "Asia/Shanghai" }, async () => {
    const { runPipeline, restore } = loadMockedRunner({
      chatStream: async function* () {
        for (const chunk of replyChunks) yield chunk;
      },
      saveMessage: async (sessionId: string, role: string, content: string) => {
        savedMessages.push({ role, content });
        return { id: "m1", session_id: sessionId, role, content, created_at: new Date() };
      },
      warnSink: (message: string, data: any) => warnLogs.push({ message, data }),
    });
    try {
      const ws = new FakeWebSocket();
      const ctx = new RemiSessionContext("guard-final-content");
      const ic = new InterruptController();
      const avatar = new AvatarController();
      await runPipeline(ws, "有点困了", ic, avatar, "session-guard", ctx, 1, "trace-guard");
      const messages = ws.parsedMessages();
      result = {
        chatEnd: messages.find((m: any) => m?.type === "chat_end"),
        streamedText: messages
          .filter((m: any) => m?.type === "chat_chunk")
          .map((m: any) => m.content)
          .join(""),
        assistantSaved: savedMessages.find((m) => m.role === "assistant"),
        warnLogs,
      };
    } finally {
      restore();
    }
  });
  return result;
}

describe("pipeline time guard chat_end finalContent", () => {
  it("carries finalContent when a violating sentence was dropped, matching the persisted text", async () => {
    const badSentence = `周${weekdayCharWithOffset(3)}早起确实折磨人。`;
    const r = await runGuardCase({
      guardMode: "drop",
      replyChunks: [badSentence, "早点睡吧。"],
    });

    // 流式文本包含坏句（已知缺口：chunk 流不做句级缓冲，坏句会闪现）
    assert.equal(r.streamedText, `${badSentence}早点睡吧。`);
    // chat_end 携带剔除后的终稿
    assert.equal(r.chatEnd.finalContent, "早点睡吧。");
    // 终稿与持久化文本一致
    assert.equal(r.assistantSaved.content, "早点睡吧。");
    // WARN 日志实锤
    const guardWarn = r.warnLogs.find((l: any) => l.message.includes("ReplyTimeGuard"));
    assert(guardWarn, "expected ReplyTimeGuard WARN log");
    assert.equal(guardWarn.data.mode, "drop");
  });

  it("omits finalContent entirely when nothing was dropped (clean reply)", async () => {
    const r = await runGuardCase({
      guardMode: "drop",
      replyChunks: ["今晚早点休息哦。", "晚安好梦。"],
    });

    assert.equal("finalContent" in r.chatEnd, false, "clean reply must not carry finalContent");
    assert.equal(r.assistantSaved.content, "今晚早点休息哦。晚安好梦。");
    assert.equal(
      r.warnLogs.some((l: any) => l.message.includes("ReplyTimeGuard")),
      false,
    );
  });

  it("omits finalContent and keeps the original text when ALL sentences were flagged (mute-prevention fallback)", async () => {
    const badSentence = `周${weekdayCharWithOffset(3)}早起确实折磨人。`;
    const r = await runGuardCase({
      guardMode: "drop",
      replyChunks: [badSentence],
    });

    assert.equal("finalContent" in r.chatEnd, false, "all-dropped fallback must not carry finalContent");
    // 兜底：原文照常持久化（不能让她哑巴）
    assert.equal(r.assistantSaved.content, badSentence);
    const fallbackWarn = r.warnLogs.find((l: any) =>
      l.message.includes("all sentences flagged"),
    );
    assert(fallbackWarn, "expected the all-flagged fallback WARN log");
  });

  it("detect mode: logs the violation but neither drops nor carries finalContent", async () => {
    const badSentence = `周${weekdayCharWithOffset(3)}早起确实折磨人。`;
    const r = await runGuardCase({
      guardMode: "detect",
      replyChunks: [badSentence, "早点睡吧。"],
    });

    assert.equal("finalContent" in r.chatEnd, false);
    // detect 只观察不拦截：坏句照常持久化
    assert.equal(r.assistantSaved.content, `${badSentence}早点睡吧。`);
    const guardWarn = r.warnLogs.find((l: any) => l.message.includes("ReplyTimeGuard"));
    assert(guardWarn, "expected ReplyTimeGuard WARN log in detect mode");
    assert.equal(guardWarn.data.mode, "detect");
  });
});
