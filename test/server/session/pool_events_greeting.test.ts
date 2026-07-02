import { strict as assert } from "node:assert";
import { describe, it, beforeEach, afterEach } from "mocha";
const path = require("path");

import { resetConfig } from "../../../server/config";
import { textSessionPool, attachEventsSink, detachEventsSink, type PoolEntry } from "../../../server/session/pool";
import { noteRemiSelfLastSeen, __resetGreetingOpenerStateForTest } from "../../../server/session/greeting_opener";
import { clearNsfw } from "../../../brains/nsfw_mode";
import type { MessageSink } from "../../../server/gateway/types";

const HOUR = 60 * 60 * 1000;

// scheduleGreetingOpener's timer/delay (GREETING_DELAY_MS = 2500) is not
// injectable through the pool.ts → attachEventsSink call site (it always uses
// the production default), unlike the direct unit tests in
// greeting_opener.test.ts which pass a short delayMs. These SSE-path tests
// therefore mock server/pipeline the same way, but wait past the real delay
// with a short poll instead of asserting synchronously.
async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Minimal fake MessageSink — records every send() call, never actually closes. */
function fakeSink(): MessageSink & { sent: string[] } {
  return {
    sent: [] as string[],
    readyState: 1,
    send(data: string) {
      this.sent.push(data);
    },
  };
}

describe("SSE events sink → greeting opener wiring (pool.ts + sse_chat.ts integration)", function () {
  // 这些用例故意等真实的 GREETING_DELAY_MS(2500ms)，waitFor 上限 4s，
  // mocha 默认 2s 会先杀——放大到 15s 覆盖真实延迟 + CI 抖动。
  this.timeout(15000);
  const pipelinePath = path.resolve(__dirname, "../../../server/pipeline/index.ts");
  const greetingOpenerPath = path.resolve(__dirname, "../../../server/session/greeting_opener.ts");
  const poolPath = path.resolve(__dirname, "../../../server/session/pool.ts");

  let previousPipeline: NodeModule | undefined;
  let pipelineCalls: any[][];

  function installMockPipeline(): void {
    previousPipeline = require.cache[pipelinePath];
    pipelineCalls = [];
    require.cache[pipelinePath] = {
      id: pipelinePath,
      filename: pipelinePath,
      loaded: true,
      exports: {
        runPipeline: async (...args: any[]) => {
          pipelineCalls.push(args);
        },
      },
    } as unknown as NodeModule;
    // Force fresh copies of greeting_opener + pool so they pick up the mocked
    // pipeline module (require.cache swap must happen before they're required).
    delete require.cache[greetingOpenerPath];
    delete require.cache[poolPath];
  }

  function restoreMockPipeline(): void {
    delete require.cache[greetingOpenerPath];
    delete require.cache[poolPath];
    if (previousPipeline) {
      require.cache[pipelinePath] = previousPipeline;
    } else {
      delete require.cache[pipelinePath];
    }
  }

  // Re-require pool.ts + greeting_opener.ts fresh each test so the mocked
  // pipeline module is in effect (mirrors greeting_opener.test.ts's own
  // loadGreetingOpenerModule() pattern).
  function loadFreshModules() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pool = require(poolPath);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const greetingOpener = require(greetingOpenerPath);
    return { pool, greetingOpener };
  }

  beforeEach(() => {
    installMockPipeline();
    process.env.REMI_GREETING_OPENER_ENABLED = "1";
    resetConfig();
  });

  afterEach(() => {
    restoreMockPipeline();
    resetConfig();
  });

  it("events 连接建立后（entry 已 bootstrap 完成）触发一次开场语，推给 events sink", async () => {
    const { pool, greetingOpener } = loadFreshModules();
    greetingOpener.__resetGreetingOpenerStateForTest();
    greetingOpener.__resetCrossChannelGreetingStateForTest();

    const entry: PoolEntry = await pool.textSessionPool.acquire("events-user-1", null);
    entry.brain.remiSelfFocus = "还惦记着你昨天说的面试";
    greetingOpener.noteRemiSelfLastSeen(entry.connId, Date.now() - 2 * HOUR);

    const sink = fakeSink();
    pool.attachEventsSink(entry, sink);

    await waitFor(() => pipelineCalls.length > 0);

    assert.equal(pipelineCalls.length, 1, "events 连接应该触发一次 runPipeline");
    const [passedSink, userMessage, , , , , , , options] = pipelineCalls[0];
    assert.equal(passedSink, sink, "runPipeline 应该用 events 的持久 sink，而不是某个 request-scoped sink");
    assert.ok(userMessage.includes("还惦记着你昨天说的面试"));
    assert.equal(options.silenceNudge, true);

    pool.textSessionPool.stop();
  });

  it("同一 entry 上 events 二次 (re)connect 不重复触发", async () => {
    const { pool, greetingOpener } = loadFreshModules();
    greetingOpener.__resetGreetingOpenerStateForTest();
    greetingOpener.__resetCrossChannelGreetingStateForTest();

    const entry: PoolEntry = await pool.textSessionPool.acquire("events-user-2", null);
    entry.brain.remiSelfFocus = "上次聊的旅行计划";
    greetingOpener.noteRemiSelfLastSeen(entry.connId, Date.now() - 2 * HOUR);

    const firstSink = fakeSink();
    pool.attachEventsSink(entry, firstSink);
    await waitFor(() => pipelineCalls.length > 0);
    assert.equal(pipelineCalls.length, 1);

    // 模拟标签页刷新：旧连接断开，新连接接上同一个 entry。
    pool.detachEventsSink(entry, firstSink);
    const secondSink = fakeSink();
    pool.attachEventsSink(entry, secondSink);

    // 给它一个观察窗口，确认真的不会再触发（而不是刚好还没到而误判"通过"）。
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(pipelineCalls.length, 1, "第二次 events (re)connect 不应重复触发开场语");

    pool.textSessionPool.stop();
  });

  it("跨通道去重：同一 userId 的两个不同 connId（模拟 WS + SSE）在 30 分钟窗口内只触发一次", async () => {
    const { pool, greetingOpener } = loadFreshModules();
    greetingOpener.__resetGreetingOpenerStateForTest();
    greetingOpener.__resetCrossChannelGreetingStateForTest();

    // 两个不同的 pool entry（不同 connId），但共享同一个已解析的 userId——
    // 模拟同一个人的桌面 WS 会话和网页 SSE 会话。acquire() 按 storageUserId 去重，
    // 这里为了制造"两个真正独立的 connId"场景，直接构造第二个 entry 而不经过
    // acquire()（该函数会把同 storageUserId 的请求路由到同一个 entry，不足以
    // 制造跨通道场景）。
    const entryA: PoolEntry = await pool.textSessionPool.acquire("events-user-3a", null);
    entryA.brain.setUserId("shared-user-id-xyz");
    entryA.brain.remiSelfFocus = "通道 A 的素材";
    greetingOpener.noteRemiSelfLastSeen(entryA.connId, Date.now() - 2 * HOUR);

    const entryB: PoolEntry = await pool.textSessionPool.acquire("events-user-3b", null);
    entryB.brain.setUserId("shared-user-id-xyz"); // 同一个人，不同连接/设备
    entryB.brain.remiSelfFocus = "通道 B 的素材";
    greetingOpener.noteRemiSelfLastSeen(entryB.connId, Date.now() - 2 * HOUR);

    const sinkA = fakeSink();
    const sinkB = fakeSink();
    pool.attachEventsSink(entryA, sinkA);
    pool.attachEventsSink(entryB, sinkB);

    await waitFor(() => pipelineCalls.length >= 1);
    // 给第二个通道一个公平的机会——如果它也会触发，应该在这个窗口内发生。
    await new Promise((resolve) => setTimeout(resolve, 300));

    assert.equal(pipelineCalls.length, 1, "同一用户跨通道 30 分钟内只应触发一次开场语");

    pool.textSessionPool.stop();
  });

  it("无 userId（brain.userId 为空）时不参与跨通道去重，两个匿名 entry 各自独立判定", async () => {
    const { pool, greetingOpener } = loadFreshModules();
    greetingOpener.__resetGreetingOpenerStateForTest();
    greetingOpener.__resetCrossChannelGreetingStateForTest();

    const entryA: PoolEntry = await pool.textSessionPool.acquire("anon-user-a", null);
    entryA.brain.remiSelfFocus = "匿名 A 的素材";
    greetingOpener.noteRemiSelfLastSeen(entryA.connId, Date.now() - 2 * HOUR);

    const entryB: PoolEntry = await pool.textSessionPool.acquire("anon-user-b", null);
    entryB.brain.remiSelfFocus = "匿名 B 的素材";
    greetingOpener.noteRemiSelfLastSeen(entryB.connId, Date.now() - 2 * HOUR);

    pool.attachEventsSink(entryA, fakeSink());
    pool.attachEventsSink(entryB, fakeSink());

    await waitFor(() => pipelineCalls.length >= 2);
    assert.equal(pipelineCalls.length, 2, "无 userId 时两个独立匿名连接应各自触发");

    pool.textSessionPool.stop();
  });

  afterEach(() => {
    clearNsfw("events-user-1");
    clearNsfw("events-user-2");
  });
});
