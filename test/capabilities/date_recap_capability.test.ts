const assert = require("assert").strict;
const path = require("path");

function loadDateRecapCapability({
  isDbReady = true,
  getUserMessagesInRange = async () => [],
  completeWithOptions = async () => "按你那边昨天的聊天记录看，昨天主要在聊任务优先级和移动端语音问题。",
} = {}) {
  const appStatePath = path.resolve(__dirname, "../../infra/app_state.ts");
  const repoPath = path.resolve(
    __dirname,
    "../../storage/repositories/message_repository.ts",
  );
  const llmPath = path.resolve(__dirname, "../../llm/qwen_client.ts");
  const capabilityPath = path.resolve(
    __dirname,
    "../../capabilities/date_recap_capability.ts",
  );

  const appStateModule = require(appStatePath);
  const repoModule = require(repoPath);
  const llmModule = require(llmPath);

  const originalIsDbReady = appStateModule.isDbReady;
  const originalGetUserMessagesInRange = repoModule.getUserMessagesInRange;
  const originalCompleteWithOptions = llmModule.completeWithOptions;

  appStateModule.isDbReady = () => isDbReady;
  repoModule.getUserMessagesInRange = getUserMessagesInRange;
  llmModule.completeWithOptions = completeWithOptions;

  delete require.cache[capabilityPath];
  const capability = require(capabilityPath);

  return {
    ...capability,
    restore() {
      appStateModule.isDbReady = originalIsDbReady;
      repoModule.getUserMessagesInRange = originalGetUserMessagesInRange;
      llmModule.completeWithOptions = originalCompleteWithOptions;
      delete require.cache[capabilityPath];
    },
  };
}

describe("date recap capability", () => {
  it("matches relative-date recap questions", () => {
    const {
      matchDateRecapIntent,
      restore,
    } = loadDateRecapCapability();
    try {
      assert.deepEqual(matchDateRecapIntent("昨天我们聊了什么"), {
        kind: "relative",
        offsetDays: 1,
        referenceLabel: "昨天",
      });
      assert.deepEqual(matchDateRecapIntent("前天我们主要聊了什么"), {
        kind: "relative",
        offsetDays: 2,
        referenceLabel: "前天",
      });
    } finally {
      restore();
    }
  });

  it("matches explicit-date recap questions and ignores non-recap asks", () => {
    const {
      matchDateRecapIntent,
      restore,
    } = loadDateRecapCapability();
    try {
      assert.deepEqual(matchDateRecapIntent("4月14号我们聊过什么"), {
        kind: "absolute",
        month: 4,
        day: 14,
        year: undefined,
        referenceLabel: "4月14日",
      });
      assert.equal(matchDateRecapIntent("昨天几点了"), null);
      assert.equal(matchDateRecapIntent("上周我们聊了什么"), null);
    } finally {
      restore();
    }
  });

  it("resolves yesterday into the correct local-day range", () => {
    const {
      resolveDateRecapWindow,
      restore,
    } = loadDateRecapCapability();
    try {
      const window = resolveDateRecapWindow(
        { kind: "relative", offsetDays: 1, referenceLabel: "昨天" },
        new Date("2026-04-15T04:00:00.000Z"),
        "Asia/Shanghai",
      );
      assert.equal(window.dateLabel, "2026 年 4 月 14 日");
      assert.equal(window.startAt.toISOString(), "2026-04-13T16:00:00.000Z");
      assert.equal(window.endAt.toISOString(), "2026-04-14T16:00:00.000Z");
    } finally {
      restore();
    }
  });

  it("returns an honest unavailable reply when date history cannot be queried", async () => {
    const {
      tryHandleDateRecap,
      restore,
    } = loadDateRecapCapability({
      isDbReady: false,
    });
    try {
      const reply = await tryHandleDateRecap({
        userId: "user_001",
        userMessage: "昨天我们聊了什么",
        now: new Date("2026-04-15T04:00:00.000Z"),
        clientTimeZone: "Asia/Shanghai",
        serverTimeZone: "UTC",
      });
      assert.match(reply, /拿不到按日期的历史记录/);
    } finally {
      restore();
    }
  });

  it("drops the current recap question from today's recap before summarizing", async () => {
    const repoCalls = [];
    const llmCalls = [];
    const {
      tryHandleDateRecap,
      restore,
    } = loadDateRecapCapability({
      getUserMessagesInRange: async (...args) => {
        repoCalls.push(args);
        return [
          {
            id: "m1",
            session_id: "s1",
            role: "user",
            content: "先把移动语音单路径打通",
            created_at: new Date("2026-04-15T01:00:00.000Z"),
          },
          {
            id: "m2",
            session_id: "s1",
            role: "assistant",
            content: "好，先收口 push-to-talk 再看 prosody。",
            created_at: new Date("2026-04-15T01:01:00.000Z"),
          },
          {
            id: "m3",
            session_id: "s1",
            role: "user",
            content: "今天我们聊了什么",
            created_at: new Date("2026-04-15T04:00:10.000Z"),
          },
        ];
      },
      completeWithOptions: async (messages) => {
        llmCalls.push(messages);
        return "按你那边今天的聊天记录看，今天主要在聊移动语音链路收口。";
      },
    });

    try {
      const reply = await tryHandleDateRecap({
        userId: "user_001",
        userMessage: "今天我们聊了什么",
        now: new Date("2026-04-15T04:00:15.000Z"),
        clientTimeZone: "Asia/Shanghai",
        serverTimeZone: "UTC",
      });
      assert.equal(repoCalls.length, 1);
      assert.equal(reply, "按你那边今天的聊天记录看，今天主要在聊移动语音链路收口。");
      const transcript = llmCalls[0][1].content;
      assert.equal(transcript.includes("今天我们聊了什么"), false);
      assert.equal(transcript.includes("先把移动语音单路径打通"), true);
    } finally {
      restore();
    }
  });
});
