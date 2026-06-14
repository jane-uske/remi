const assert = require("assert").strict;
const path = require("path");

const { RemiSessionContext } = require("../../brains/remi_session_context");

/**
 * RW-P1-4a：验证 RemiWorld 传入的世界情境（situationalContext）确实进入
 * 喂给快脑的 prompt 输入（strategyHints），从而成为对话的 ground truth。
 * 镜像 test/brain/route_message_memory_overlay.test.ts 的 mock 思路：
 * 替换 fastBrainStream 捕获 input，断言 strategyHints 含情境块。
 */
function loadMockedRouteMessage(captureFn: (input: any) => void) {
  const fastBrainModulePath = path.resolve(__dirname, "../../brains/reply_stream.ts");
  const brainRouterModulePath = path.resolve(
    __dirname,
    "../../brains/context_orchestrator.ts",
  );
  const fastBrainModule = require(fastBrainModulePath);
  const originalFastBrainStream = fastBrainModule.fastBrainStream;

  fastBrainModule.fastBrainStream = async function* (input: any) {
    captureFn(input);
    yield "嗯。";
  };
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

describe("RW-P1-4a 世界情境进入 prompt", () => {
  it("situationalContext 注入 strategyHints，成为对话地基", async () => {
    const ctx = new RemiSessionContext("world-situational");
    const captured: any[] = [];
    const { routeMessage, restore } = loadMockedRouteMessage((input) =>
      captured.push(input),
    );
    const situational =
      "你正和用户待在你自己的小世界里——黄昏的浮空小岛。\n" +
      "就在用户走过来和你说话之前，你在长椅边发呆。\n" +
      "用户此刻就站在你身边，面对面和你说话。";
    try {
      await drain(
        routeMessage(ctx, "你刚刚在做什么呀", "neutral", undefined, {
          situationalContext: situational,
          inputSource: "text",
        }),
      );
      assert.equal(captured.length, 1, "应调用一次快脑");
      const hints: string = captured[0].strategyHints ?? "";
      assert.ok(hints.includes("你此刻的处境"), "strategyHints 应含情境标题");
      assert.ok(hints.includes("在长椅边发呆"), "应含她刚在做的事");
      assert.ok(hints.includes("身边"), "应含用户在身边");
    } finally {
      restore();
    }
  });

  it("不传 situationalContext 时不注入情境块（普通聊天不受影响）", async () => {
    const ctx = new RemiSessionContext("world-situational-none");
    const captured: any[] = [];
    const { routeMessage, restore } = loadMockedRouteMessage((input) =>
      captured.push(input),
    );
    try {
      await drain(
        routeMessage(ctx, "今天天气不错", "neutral", undefined, {
          inputSource: "text",
        }),
      );
      assert.equal(captured.length, 1);
      const hints: string = captured[0].strategyHints ?? "";
      assert.ok(!hints.includes("你此刻的处境"), "无情境时不应出现情境块");
    } finally {
      restore();
    }
  });
});
