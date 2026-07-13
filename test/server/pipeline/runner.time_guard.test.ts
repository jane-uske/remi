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

function loadMockedRunner({ chatStream, saveMessage, warnSink, synthCalls }: any) {
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
    exports: {
      isTtsEnabled: () => true,
      synthesize: async (text: string) => {
        synthCalls?.push(text);
        return Buffer.from("fake");
      },
    },
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
  const synthCalls: string[] = [];
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
      synthCalls,
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
        synthCalls,
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

  // ── GUARD-03：守卫粒度=真句，不再让 TTS chunk 合并的无辜邻句陪葬 ──────
  //
  // SentenceChunker 会把 <minTtsChars（默认 16）的短句 hold 进下一块，
  // 一个 pushSentence 收到的 chunk 可能是「坏短句 + 无辜邻句」。旧行为整块
  // drop（2026-07-04 实测误杀）；新行为按真句边界重判，只丢违规子句。

  it("GUARD-03: drops only the violating sub-sentence when a short bad sentence merged with an innocent neighbor", async () => {
    // 9 字坏短句（<16）会被 chunker hold 住并入下一句 → 一个合并 chunk
    const badShort = `反正周${weekdayCharWithOffset(3)}还远着呢。`;
    const innocent = "早点睡觉做个好梦明天会更好。";
    const opener = "今晚就聊到这里吧我们说了很多。";
    const r = await runGuardCase({
      guardMode: "drop",
      replyChunks: [opener, badShort, innocent],
    });

    // 终稿与持久化都只剔坏句，无辜邻句保留
    assert.equal(r.chatEnd.finalContent, `${opener}${innocent}`);
    assert.equal(r.assistantSaved.content, `${opener}${innocent}`);
    // TTS 侧：无辜邻句仍然说出口，坏句没有
    assert(
      r.synthCalls.some((t: string) => t.includes("早点睡觉")),
      `innocent neighbor must still reach TTS, got: ${JSON.stringify(r.synthCalls)}`,
    );
    assert.equal(
      r.synthCalls.some((t: string) => t.includes("还远着呢")),
      false,
      "violating sentence must not reach TTS",
    );
    // WARN 记录的是真句而非整个 chunk
    const guardWarn = r.warnLogs.find((l: any) => l.message.includes("ReplyTimeGuard"));
    assert(guardWarn, "expected ReplyTimeGuard WARN log");
    assert.equal(guardWarn.data.sentence.includes("早点睡觉"), false);
  });

  it("GUARD-03: a fully-violating merged chunk is still dropped whole while clean chunks survive", async () => {
    const opener = "今晚就聊到这里吧我们说了很多。";
    const bad1 = `反正周${weekdayCharWithOffset(3)}还远着呢。`; // 9 字 → hold
    const bad2 = `今天是周${weekdayCharWithOffset(3)}呀。`; // 合并后 ≥16 → 整块出来
    const r = await runGuardCase({
      guardMode: "drop",
      replyChunks: [opener, bad1, bad2],
    });

    assert.equal(r.chatEnd.finalContent, opener);
    assert.equal(r.assistantSaved.content, opener);
    assert.equal(
      r.synthCalls.some((t: string) => t.includes("周")),
      false,
      "no weekday sentence may reach TTS",
    );
  });

  it("GUARD-03: a now-indicator in sentence A no longer condemns a period word in sentence B (cross-sentence pollution)", async () => {
    // 运行时挑一个「对当前小时不合法」的时段词，保证旧整块判定必然误杀
    const { legalPeriodWordsForHour } = require("../../../utils/reply_time_guard");
    const hourNow = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Shanghai",
        hour: "numeric",
        hourCycle: "h23",
      }).format(new Date()),
    );
    const legal = legalPeriodWordsForHour(hourNow);
    const illegalWord = ["凌晨", "上午", "下午", "晚上"].find((w) => !legal.has(w));
    assert(illegalWord, "expected at least one illegal period word for any hour");

    // "现在好困呀。"（6 字 <8 eager min）被 hold → 与下一句合成一个 chunk：
    // 现在时指示词在 A 句、时段词在 B 句（B 句自身无现在时指示词）
    const r = await runGuardCase({
      guardMode: "drop",
      replyChunks: ["现在好困呀。", `${illegalWord}的街道很安静。`],
    });

    assert.equal("finalContent" in r.chatEnd, false, "nothing should be dropped");
    assert.equal(r.assistantSaved.content, `现在好困呀。${illegalWord}的街道很安静。`);
    assert.equal(
      r.warnLogs.some((l: any) => l.message.includes("ReplyTimeGuard")),
      false,
      "cross-sentence pollution must not trigger the guard",
    );
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
