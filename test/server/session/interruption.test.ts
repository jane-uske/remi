const assert = require("assert").strict;
const path = require("path");
const { InterruptController } = require("../../../voice/interrupt_controller");
const { RemiSessionContext } = require("../../../brains/remi_session_context");
const { routeMessage } = require("../../../brains/context_orchestrator");
const { loadSessionHarness, waitFor } = require("../../helpers/session_harness");
const { hasExplicitCarryForwardCue } = require("../../../server/session/interruption");

function loadMockedRouteMessage({ fastBrainStream, runSlowBrain }) {
  const fastBrainModulePath = path.resolve(__dirname, "../../../brains/reply_stream.ts");
  const slowBrainModulePath = path.resolve(__dirname, "../../../brains/background_analysis.ts");
  const brainRouterModulePath = path.resolve(__dirname, "../../../brains/context_orchestrator.ts");
  const fastBrainModule = require(fastBrainModulePath);
  const slowBrainModule = require(slowBrainModulePath);

  const originalFastBrainStream = fastBrainModule.fastBrainStream;
  const originalRunSlowBrain = slowBrainModule.runSlowBrain;

  fastBrainModule.fastBrainStream = fastBrainStream;
  slowBrainModule.runSlowBrain = runSlowBrain;

  delete require.cache[brainRouterModulePath];
  const { routeMessage: mockedRouteMessage } = require(brainRouterModulePath);

  return {
    routeMessage: mockedRouteMessage,
    restore() {
      fastBrainModule.fastBrainStream = originalFastBrainStream;
      slowBrainModule.runSlowBrain = originalRunSlowBrain;
      delete require.cache[brainRouterModulePath];
    },
  };
}

describe("interruption handling", () => {
  it("tracks interrupt controller lifecycle", () => {
    const ic = new InterruptController();
    const interrupted = [];

    ic.on("interrupted", () => interrupted.push(ic.state));

    const signal = ic.begin();
    assert.equal(ic.state, "generating");
    assert.equal(ic.active, true);
    assert.equal(signal.aborted, false);

    ic.markSpeaking();
    assert.equal(ic.state, "speaking");

    const didInterrupt = ic.interrupt();
    assert.equal(didInterrupt, true);
    assert.equal(ic.state, "idle");
    assert.equal(ic.active, false);
    assert.equal(signal.aborted, true);
    assert.deepEqual(interrupted, ["idle"]);
  });

  it("marks topic continuation when the user clearly continues the previous topic", () => {
    const ctx = new RemiSessionContext("test-conn");
    ctx.updateLiveState("neutral", "我想优化一下语音体验", "好，我们先看 turn-taking");
    ctx.updateLiveState("neutral", "继续说刚才那个语音体验", "可以");

    assert.equal(ctx.persona.liveState.isContinuingTopic, true);
    assert.equal(ctx.persona.liveState.wasInterrupted, false);
    assert.ok(ctx.persona.liveState.lastTopicSummary.length > 0);
  });

  it("does not mark memory callback intent on unrelated ordinary text", () => {
    const ctx = new RemiSessionContext("test-conn");
    for (let i = 0; i < 8; i += 1) ctx.slowBrain.recordTurn();
    ctx.slowBrain.bumpRelationship({ familiarityDelta: 0.6, emotionalBondDelta: 0.5 });
    ctx.slowBrain.setProactiveTopics(["工作那件事后来缓一点了吗"]);
    ctx.slowBrain.recordSharedMoment({
      summary: "上次你提到工作上被误解后一直很委屈。",
      topic: "工作",
      mood: "委屈",
      hook: "工作那件事后来缓一点了吗",
      createdAt: 620,
      unresolved: true,
    });

    ctx.updateLiveState("neutral", "我今天中午吃了面", "嗯");
    assert.notEqual(ctx.persona.liveState.proactiveIntent, "callback");

    ctx.updateLiveState("neutral", "继续", "嗯");
    assert.equal(ctx.persona.liveState.proactiveIntent, "callback");
  });

  it("only marks a real interruption, not slow brain cancellation", () => {
    const ctx = new RemiSessionContext("test-conn");
    ctx.beginSlowBrain();
    ctx.cancelSlowBrain();
    assert.equal(ctx.persona.liveState.wasInterrupted, false);

    ctx.markInterrupted();
    assert.equal(ctx.persona.liveState.wasInterrupted, true);

    ctx.updateLiveState("happy", "随便聊聊", "好呀");
    assert.equal(ctx.persona.liveState.wasInterrupted, false);
    assert.equal(ctx.persona.liveState.currentMood, "happy");
    assert.equal(ctx.persona.liveState.emotionalState, "开心");
  });

  it("returns the last interrupted reply for a carry-forward query", async () => {
    const ctx = new RemiSessionContext("test-conn");
    ctx.lastInterruptedReply = "我刚才说到语音真人感最重要的是接话时机。";

    const chunks = [];
    for await (const chunk of routeMessage(
      ctx,
      "刚才说到哪了",
      "neutral",
    )) {
      chunks.push(chunk);
    }

    assert.equal(chunks.join(""), "我刚才说到：我刚才说到语音真人感最重要的是接话时机。");
  });

  it("keeps interrupted partials out of history and slow brain", async () => {
    let releasePending = () => {};
    const pending = new Promise((resolve) => {
      releasePending = resolve;
    });
    const slowBrainCalls = [];
    const { routeMessage: mockedRouteMessage, restore } = loadMockedRouteMessage({
      fastBrainStream: async function* () {
        yield "我先说一半";
        await pending;
      },
      runSlowBrain: async (...args) => {
        slowBrainCalls.push(args);
      },
    });

    try {
      const ctx = new RemiSessionContext("test-conn");
      const ac = new AbortController();
      const chunks = [];

      for await (const chunk of mockedRouteMessage(ctx, "请继续", "neutral", ac.signal)) {
        chunks.push(chunk);
        ac.abort();
        releasePending();
      }

      assert.deepEqual(chunks, ["我先说一半"]);
      assert.equal(ctx.history.length, 0);
      assert.equal(slowBrainCalls.length, 0);
      assert.equal(ctx.lastInterruptedReply, "我先说一半");
      assert.equal(ctx.persona.liveState.wasInterrupted, true);
    } finally {
      restore();
    }
  });

  it("uses the in-flight assistant draft for carry-forward on immediate text interruption", async function () {
    this.timeout(5000);
    const { ws, session, pipelineCalls, restore } = loadSessionHarness();
    try {
      session.brain.currentAssistantDraft = "我刚才想说先把打断承接做好。";
      session.interrupt.begin();

      ws.emitMessage(
        Buffer.from(
          JSON.stringify({
            type: "chat",
            content: "不是那个意思，我想说的是先把误触发压住",
          }),
        ),
      );

      await waitFor(() => pipelineCalls.length === 1);
      assert.equal(pipelineCalls[0].options?.interruptionType, "correction");
      assert.ok(pipelineCalls[0].options?.carryForwardHint?.includes("先把打断承接做好"));
      assert.equal(session.brain.lastInterruptedReply, "我刚才想说先把打断承接做好。");
    } finally {
      restore();
    }
  });

  it("does not emit interrupt when text chat starts from idle", async () => {
    const { ws, pipelineCalls, restore } = loadSessionHarness();
    try {
      ws.emitMessage(
        Buffer.from(
          JSON.stringify({
            type: "chat",
            content: "这是一条正常开始的新消息",
          }),
        ),
      );

      await waitFor(() => pipelineCalls.length === 1);
      const interrupts = ws.parsedMessages().filter((msg) => msg?.type === "interrupt");
      assert.equal(interrupts.length, 0, `messages=${JSON.stringify(ws.parsedMessages())}`);
    } finally {
      restore();
    }
  });

  it("hasExplicitCarryForwardCue: 仅对显式承接/修正为真（文本复读机修复）", () => {
    // 显式承接/修正 → 允许把上一句 carry-forward
    assert.equal(hasExplicitCarryForwardCue("接着说"), true);
    assert.equal(hasExplicitCarryForwardCue("继续"), true);
    assert.equal(hasExplicitCarryForwardCue("然后呢"), true);
    assert.equal(hasExplicitCarryForwardCue("不是那个意思，我想说的是先压误触发"), true);
    assert.equal(hasExplicitCarryForwardCue("应该是明天"), true);
    // 全新问题（线上复读机的实际输入）→ 绝不 carry-forward 上一句
    assert.equal(hasExplicitCarryForwardCue("随便推荐我一部周末看的电影"), false);
    assert.equal(hasExplicitCarryForwardCue("我家猫叫团子今天又把水杯打翻了"), false);
    assert.equal(hasExplicitCarryForwardCue("用Python帮我写个快速排序"), false);
    assert.equal(hasExplicitCarryForwardCue("睡不着，脑子里乱糟糟的"), false);
    assert.equal(hasExplicitCarryForwardCue("   "), false);
  });
});
