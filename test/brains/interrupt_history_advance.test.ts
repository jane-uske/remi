const assert = require("assert").strict;
const path = require("path");

const { RemiSessionContext } = require("../../brains/remi_session_context");

/**
 * BC-001 复读机根因回归。
 *
 * 根因：被打断的轮次（signal.aborted）原本在 routeMessage 里直接 return，跳过
 * `ctx.history.push`，使这一轮在 prompt 的唯一来源 ctx.history 里零痕迹。线上连发
 * （上一条仍在生成 / 合成 TTS、SSE 还开着时发新消息 → abort → req.on("close") →
 * interrupt）会让下一轮拿到几乎相同的陈旧历史 → prompt 近乎一致 → 上游 provider
 * 对相同 prompt 返回逐字相同补全 → 逐字复读。
 *
 * 修复：被打断轮也推进历史（user 必推；已生成的非空、非 fallback 回复也推）。
 * 镜像 test/brains/world_situational_context.test.ts 的 mock 思路：替换
 * fastBrainStream，让它先吐回复再让本轮 signal abort，模拟"回复已流出但仍被打断"。
 */
function loadMockedRouteMessage(streamImpl: (input: any) => AsyncGenerator<string>) {
  const fastBrainModulePath = path.resolve(__dirname, "../../brains/reply_stream.ts");
  const brainRouterModulePath = path.resolve(
    __dirname,
    "../../brains/context_orchestrator.ts",
  );
  const fastBrainModule = require(fastBrainModulePath);
  const originalFastBrainStream = fastBrainModule.fastBrainStream;

  fastBrainModule.fastBrainStream = streamImpl;
  delete require.cache[brainRouterModulePath];
  const { routeMessage } = require(brainRouterModulePath);

  return {
    routeMessage,
    restore() {
      fastBrainModule.fastBrainStream = originalFastBrainStream;
      delete require.cache[brainRouterModulePath];
    },
  };
}

async function drain(gen: AsyncGenerator<string>) {
  const out: string[] = [];
  for await (const chunk of gen) out.push(chunk);
  return out;
}

describe("BC-001 被打断轮推进历史（复读机根因回归）", () => {
  it("回复已流出但被打断：user + 已生成回复都进历史（不再冻结 prompt）", async () => {
    const ctx = new RemiSessionContext("interrupt-history");
    const ac = new AbortController();
    const reply = "嗯……终于舍得回来了呀？在我这儿歇会儿。";
    const { routeMessage, restore } = loadMockedRouteMessage(async function* () {
      yield reply;
      // 模拟：文本已全部流出后，用户连发的新消息把上一条 SSE abort 掉
      ac.abort();
    });
    try {
      await drain(
        routeMessage(ctx, "我回来了", "neutral", ac.signal, { inputSource: "text" }),
      );
      assert.deepEqual(
        ctx.history.map((m: { role: string; content: string }) => [m.role, m.content]),
        [
          ["user", "我回来了"],
          ["assistant", reply],
        ],
        "被打断轮的 user 与已生成回复都应推进历史，避免下一轮 prompt 冻结复读",
      );
      assert.equal(ctx.lastInterruptedReply, reply, "lastInterruptedReply 行为保持不变");
    } finally {
      restore();
    }
  });

  it("打断时还没生成任何回复：只推 user，不写空 assistant", async () => {
    const ctx = new RemiSessionContext("interrupt-history-empty");
    const ac = new AbortController();
    const { routeMessage, restore } = loadMockedRouteMessage(async function* () {
      ac.abort();
      // 不 yield 任何内容
    });
    try {
      await drain(
        routeMessage(ctx, "在吗", "neutral", ac.signal, { inputSource: "text" }),
      );
      assert.deepEqual(
        ctx.history.map((m: { role: string; content: string }) => [m.role, m.content]),
        [["user", "在吗"]],
        "空回复被打断时只推 user，不应写入空 assistant 轮",
      );
    } finally {
      restore();
    }
  });

  it("已生成内容是 fallback 兜底串：被打断也不把兜底串写进历史", async () => {
    const ctx = new RemiSessionContext("interrupt-history-fallback");
    const ac = new AbortController();
    const { routeMessage, restore } = loadMockedRouteMessage(async function* () {
      yield "啊…刚刚脑子卡了一下，你再说一次好不好？";
      ac.abort();
    });
    try {
      await drain(
        routeMessage(ctx, "讲个故事", "neutral", ac.signal, { inputSource: "text" }),
      );
      assert.deepEqual(
        ctx.history.map((m: { role: string; content: string }) => [m.role, m.content]),
        [["user", "讲个故事"]],
        "fallback 兜底串不应进历史污染后续 prompt（与正常路径守卫一致）",
      );
    } finally {
      restore();
    }
  });
});
