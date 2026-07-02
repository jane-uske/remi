import { strict as assert } from "node:assert";
import { describe, it, beforeEach, afterEach } from "mocha";
const path = require("path");

import { RemiSessionContext } from "../../../brains/remi_session_context";
import { resetConfig } from "../../../server/config";
import {
  detectFarewellSignal,
  deriveFarewellFocus,
  selectGreetingMaterials,
  buildGreetingOpenerUserMessage,
  noteRemiSelfLastSeen,
  clearGreetingOpenerState,
  greetingOpenerEnabled,
  __resetGreetingOpenerStateForTest,
  type GreetingMaterials,
} from "../../../server/session/greeting_opener";
import { setNsfw, clearNsfw } from "../../../brains/nsfw_mode";

const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;

function enableGreetingFlag(on: boolean): void {
  if (on) process.env.REMI_GREETING_OPENER_ENABLED = "1";
  else process.env.REMI_GREETING_OPENER_ENABLED = "0";
  resetConfig();
}

function setOfflineLifeFlag(on: boolean): void {
  // selectGreetingMaterials 的素材 c 复用 offlineLifeEnabled()（同 loadAndApplyRemiSelf
  // 的 REMI_OFFLINE_LIFE_ENABLED 门控），默认 off——需要素材 c 非空的用例必须显式开它。
  if (on) process.env.REMI_OFFLINE_LIFE_ENABLED = "1";
  else delete process.env.REMI_OFFLINE_LIFE_ENABLED;
  resetConfig();
}

// ── 任务 B：告别检测正则 ────────────────────────────────────────────────

describe("detectFarewellSignal（告别意图检测）", () => {
  const positives = [
    "拜拜",
    "拜拜啦",
    "晚安",
    "我要睡了",
    "困了要睡了",
    "先去忙了",
    "我先走了",
    "回头聊",
    "明天见",
    "下次再聊吧",
    "先这样吧，回头聊",
    "不聊了，去忙了",
  ];
  for (const text of positives) {
    it(`命中："${text}"`, () => {
      assert.equal(detectFarewellSignal(text), true);
    });
  }

  it("不命中：日常陈述句", () => {
    assert.equal(detectFarewellSignal("今天天气不错"), false);
    assert.equal(detectFarewellSignal("我在忙一个项目"), false);
  });
  it("空字符串/纯空白不命中", () => {
    assert.equal(detectFarewellSignal(""), false);
    assert.equal(detectFarewellSignal("   "), false);
  });
});

// ── 任务 B：deriveFarewellFocus 优先级 ──────────────────────────────────

function fakeBrainWithSnapshot(overrides: {
  sharedMoments?: Array<{
    summary: string;
    unresolved: boolean;
    turn: number;
  }>;
  proactiveTopics?: string[];
  topicPull?: string;
  lastTopicSummary?: string;
}) {
  return {
    slowBrain: {
      getSnapshot: () => ({
        sharedMoments: (overrides.sharedMoments ?? []).map((m) => ({
          summary: m.summary,
          unresolved: m.unresolved,
          turn: m.turn,
          topic: "",
          mood: "",
          hook: "",
          semanticKeywords: [],
          kind: "bond" as const,
          salience: 0.5,
          recurrenceCount: 1,
          createdAt: 0,
          firstSeenAt: 0,
          lastReferencedAt: 0,
        })),
        proactiveTopics: overrides.proactiveTopics ?? [],
      }),
    },
    persona: {
      liveState: {
        topicPull: overrides.topicPull ?? "",
        lastTopicSummary: overrides.lastTopicSummary ?? "无最近话题",
      },
    },
  } as any;
}

describe("deriveFarewellFocus（收场钩子内容派生优先级）", () => {
  it("优先级 1：最新一条 unresolved sharedMoment（按 turn 降序）", () => {
    const brain = fakeBrainWithSnapshot({
      sharedMoments: [
        { summary: "旧的：换工作还没聊完", unresolved: true, turn: 3 },
        { summary: "新的：明天的面试还没聊完", unresolved: true, turn: 10 },
        { summary: "已解决的：搬家的事", unresolved: false, turn: 12 },
      ],
      topicPull: "无关话题",
    });
    const focus = deriveFarewellFocus(brain, "晚安");
    assert.ok(focus && focus.includes("明天的面试"), `应选 turn 最大的 unresolved，got: ${focus}`);
  });

  it("优先级 2：无 unresolved sharedMoment 时用 topicPull", () => {
    const brain = fakeBrainWithSnapshot({
      sharedMoments: [{ summary: "已解决", unresolved: false, turn: 5 }],
      topicPull: "周末爬山计划",
    });
    const focus = deriveFarewellFocus(brain, "拜拜");
    assert.equal(focus, "周末爬山计划");
  });

  it("优先级 2b：topicPull 为空时用 lastTopicSummary（非默认值）", () => {
    const brain = fakeBrainWithSnapshot({
      topicPull: "",
      lastTopicSummary: "你提到下周要搬家",
    });
    const focus = deriveFarewellFocus(brain, "先去忙了");
    assert.equal(focus, "你提到下周要搬家");
  });

  it("优先级 3：全无线索时兜底用告别消息本身", () => {
    const brain = fakeBrainWithSnapshot({});
    const focus = deriveFarewellFocus(brain, "我先睡了，今天聊得很开心");
    assert.ok(focus && focus.includes("我先睡了，今天聊得很开心"));
    assert.ok(focus!.startsWith("他上次走的时候聊到"));
  });

  it("全空（含空告别消息）→ null", () => {
    const brain = fakeBrainWithSnapshot({});
    assert.equal(deriveFarewellFocus(brain, ""), null);
  });
});

// ── 任务 A：selectGreetingMaterials 优先级 a→b→c ────────────────────────

describe("selectGreetingMaterials（开场素材优先级）", () => {
  const NOW = Date.UTC(2026, 0, 15, 10, 0, 0); // 上午10点（避开跨天边界告警）
  const TWO_HOURS_AGO = NOW - 2 * HOUR;

  beforeEach(() => setOfflineLifeFlag(true));
  afterEach(() => setOfflineLifeFlag(false));

  function makeBrain(input: {
    remiSelfFocus?: string | null;
    sharedMoments?: Array<{ summary: string; unresolved: boolean; turn: number }>;
    proactiveTopics?: string[];
  }): RemiSessionContext {
    const brain = new RemiSessionContext("materials-test");
    brain.remiSelfFocus = input.remiSelfFocus ?? null;
    // sharedMoments/proactiveTopics 走真实 slowBrain（无公开单条 setter），直接
    // 用 getSnapshot 会读到的私有字段——这里改用 hydratePersistentState 的最小
    // 等价路径：直接替换 getSnapshot 更简单可控，做法与本文件其余用例一致。
    const originalGetSnapshot = brain.slowBrain.getSnapshot.bind(brain.slowBrain);
    (brain.slowBrain as any).getSnapshot = () => ({
      ...originalGetSnapshot(),
      sharedMoments: (input.sharedMoments ?? []).map((m) => ({
        summary: m.summary,
        unresolved: m.unresolved,
        turn: m.turn,
        topic: "",
        mood: "",
        hook: "",
        semanticKeywords: [],
        kind: "bond" as const,
        salience: 0.5,
        recurrenceCount: 1,
        createdAt: 0,
        firstSeenAt: 0,
        lastReferencedAt: 0,
      })),
      proactiveTopics: input.proactiveTopics ?? [],
    });
    return brain;
  }

  it("素材 a（hookPayoff）来自 brain.remiSelfFocus", () => {
    const brain = makeBrain({ remiSelfFocus: "上次说要去爬山" });
    const materials = selectGreetingMaterials(brain, TWO_HOURS_AGO, NOW);
    assert.equal(materials.hookPayoff, "上次说要去爬山");
  });

  it("素材 b 优先 unresolved sharedMoment，其次 proactiveTopics 首条", () => {
    const brainWithMoment = makeBrain({
      sharedMoments: [{ summary: "换工作的事还没说完", unresolved: true, turn: 4 }],
      proactiveTopics: ["无关话题"],
    });
    const materialsA = selectGreetingMaterials(brainWithMoment, TWO_HOURS_AGO, NOW);
    assert.equal(materialsA.openThread, "换工作的事还没说完");

    const brainWithoutMoment = makeBrain({
      sharedMoments: [{ summary: "已解决", unresolved: false, turn: 1 }],
      proactiveTopics: ["最近的旅行计划"],
    });
    const materialsB = selectGreetingMaterials(brainWithoutMoment, TWO_HOURS_AGO, NOW);
    assert.equal(materialsB.openThread, "最近的旅行计划");
  });

  it("素材 c（offlineOpener）来自确定性 computeReturnNarrative，离线 <30min 时为 null", () => {
    const brain = makeBrain({});
    const shortOffline = selectGreetingMaterials(brain, NOW - 10 * MIN, NOW);
    assert.equal(shortOffline.offlineOpener, null);

    const longOffline = selectGreetingMaterials(brain, TWO_HOURS_AGO, NOW);
    assert.ok(longOffline.offlineOpener, "离线 2h 应算出开场句");
    assert.ok(longOffline.offlineOpener!.includes("你回来啦"));
  });

  it("REMI_OFFLINE_LIFE_ENABLED off 时素材 c 恒 null（即便离线够久）", () => {
    setOfflineLifeFlag(false);
    const brain = makeBrain({});
    const materials = selectGreetingMaterials(brain, TWO_HOURS_AGO, NOW);
    assert.equal(materials.offlineOpener, null, "flag off → 素材 c 不生效");
  });

  it("全部素材皆无 → 三个字段均为 null", () => {
    const brain = makeBrain({});
    const materials = selectGreetingMaterials(brain, NOW - 10 * MIN, NOW);
    assert.equal(materials.hookPayoff, null);
    assert.equal(materials.openThread, null);
    assert.equal(materials.offlineOpener, null);
  });

  it("三个素材可以同时并存", () => {
    const brain = makeBrain({
      remiSelfFocus: "还惦记着你的面试",
      sharedMoments: [{ summary: "搬家的事还没聊完", unresolved: true, turn: 2 }],
    });
    const materials = selectGreetingMaterials(brain, TWO_HOURS_AGO, NOW);
    assert.ok(materials.hookPayoff);
    assert.ok(materials.openThread);
    assert.ok(materials.offlineOpener);
  });
});

// ── 任务 A：buildGreetingOpenerUserMessage 文案约束 ─────────────────────

describe("buildGreetingOpenerUserMessage（开场指令文案）", () => {
  it("有素材时把候选一并塞进指令，且要求'挑一件、别堆砌'", () => {
    const materials: GreetingMaterials = {
      hookPayoff: "还惦记着你的面试",
      openThread: null,
      offlineOpener: null,
    };
    const msg = buildGreetingOpenerUserMessage(materials);
    assert.ok(msg.includes("还惦记着你的面试"));
    assert.ok(msg.includes("挑其中一件"));
    assert.ok(msg.includes("你先开口"));
  });

  it("离线人生素材附带白名单约束措辞", () => {
    const materials: GreetingMaterials = {
      hookPayoff: null,
      openThread: null,
      offlineOpener: "你回来啦～你不在的大约 2 个小时里我在窗边看海，这会儿已经午后了。",
    };
    const msg = buildGreetingOpenerUserMessage(materials);
    assert.ok(msg.includes("不要编造清单外的内容"));
    assert.ok(msg.includes("在窗边看海"));
  });

  it("全空素材时仍返回安全兜底指令，不抛错", () => {
    const materials: GreetingMaterials = { hookPayoff: null, openThread: null, offlineOpener: null };
    const msg = buildGreetingOpenerUserMessage(materials);
    assert.ok(msg.includes("轻松自然的问候"));
  });

  it("要求别问超过一个问题、别堆砌", () => {
    const materials: GreetingMaterials = { hookPayoff: "x", openThread: null, offlineOpener: null };
    const msg = buildGreetingOpenerUserMessage(materials);
    assert.ok(msg.includes("别一次问超过一个问题"));
    assert.ok(msg.includes("别写成汇报式列举"));
  });
});

// ── noteRemiSelfLastSeen / clearGreetingOpenerState 状态表 ──────────────

describe("noteRemiSelfLastSeen / clearGreetingOpenerState（会话状态表）", () => {
  beforeEach(() => {
    __resetGreetingOpenerStateForTest();
  });
  afterEach(() => {
    __resetGreetingOpenerStateForTest();
  });

  it("greetingOpenerEnabled 默认读取 REMI_GREETING_OPENER_ENABLED", () => {
    enableGreetingFlag(true);
    assert.equal(greetingOpenerEnabled(), true);
    enableGreetingFlag(false);
    assert.equal(greetingOpenerEnabled(), false);
    enableGreetingFlag(true);
  });

  it("clearGreetingOpenerState 清理后不残留状态（间接验证：不抛错，可重新 note）", () => {
    noteRemiSelfLastSeen("conn-x", Date.now());
    clearGreetingOpenerState("conn-x");
    // 清理后重新 note 应该正常工作（不因为"已存在"而报错或跳过）。
    noteRemiSelfLastSeen("conn-x", Date.now() - HOUR);
    // 没有直接的 getter，这里通过 scheduleGreetingOpener 的行为间接验证
    // （见下面 describe 块），此处只验证不抛错。
  });
});

// ── scheduleGreetingOpener 端到端触发条件 ───────────────────────────────
//
// 复用 test/server/session/continuity.test.ts 的 require.cache mocking 手法
// 来替换 server/pipeline（真正的 runPipeline 依赖 LLM/TTS，不适合单测）。

describe("scheduleGreetingOpener（开场语触发条件端到端）", () => {
  const pipelinePath = path.resolve(__dirname, "../../../server/pipeline/index.ts");
  const greetingOpenerPath = path.resolve(
    __dirname,
    "../../../server/session/greeting_opener.ts",
  );

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
    delete require.cache[greetingOpenerPath];
  }

  function restoreMockPipeline(): void {
    delete require.cache[greetingOpenerPath];
    if (previousPipeline) {
      require.cache[pipelinePath] = previousPipeline;
    } else {
      delete require.cache[pipelinePath];
    }
  }

  function loadGreetingOpenerModule() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(greetingOpenerPath);
  }

  function makeRuntime(input: {
    connId: string;
    brain: RemiSessionContext;
    lastInteractionAt?: number;
  }) {
    let currentChain = Promise.resolve();
    return {
      connId: input.connId,
      sink: {},
      brain: input.brain,
      interrupt: { active: false },
      avatar: {},
      sessionId: null,
      getPipelineChain: () => currentChain,
      setPipelineChain: (next: Promise<void>) => {
        currentChain = next;
      },
      getSilenceNudgeTimer: () => null,
      setSilenceNudgeTimer: () => {},
      getLastInteractionAt: () => input.lastInteractionAt ?? 0,
      setLastInteractionAt: () => {},
      getRecentInteractionCount: () => 0,
      setRecentInteractionCount: () => {},
      continuousConversationThreshold: 3,
      continuousConversationTimeoutMs: 5 * 60 * 1000,
      continuousSilenceFrames: 8,
      defaultSilenceFrames: 10,
      syncVadSilenceFrames: () => {},
      nextGenerationId: () => 1,
      createTraceId: (source: string, gen?: number) => `${source}-${gen ?? 0}`,
      bindActiveGeneration: () => {},
      getResolvedTtsTransport: () => "auto",
      _getChain: () => currentChain,
    };
  }

  beforeEach(() => {
    installMockPipeline();
    enableGreetingFlag(true);
    clearNsfw("greeting-e2e"); // safety: no leaked nsfw state between tests
  });

  afterEach(() => {
    enableGreetingFlag(false);
    restoreMockPipeline();
    clearNsfw("greeting-e2e");
  });

  it(">30 分钟离线 + 有素材 → 触发一次开场语", async () => {
    const { scheduleGreetingOpener, noteRemiSelfLastSeen, __resetGreetingOpenerStateForTest } =
      loadGreetingOpenerModule();
    __resetGreetingOpenerStateForTest();

    const brain = new RemiSessionContext("greeting-e2e");
    brain.remiSelfFocus = "还惦记着你的面试";
    noteRemiSelfLastSeen("greeting-e2e", Date.now() - 2 * HOUR);

    const runtime = makeRuntime({ connId: "greeting-e2e", brain });
    await scheduleGreetingOpener(runtime as any, Promise.resolve(), 5);
    await runtime._getChain();

    assert.equal(pipelineCalls.length, 1, "应该触发一次 runPipeline");
    const [, userMessage, , , , , , , options] = pipelineCalls[0];
    assert.ok(userMessage.includes("还惦记着你的面试"));
    assert.equal(options.silenceNudge, true);
  });

  it("<30 分钟离线 → 不触发", async () => {
    const { scheduleGreetingOpener, noteRemiSelfLastSeen, __resetGreetingOpenerStateForTest } =
      loadGreetingOpenerModule();
    __resetGreetingOpenerStateForTest();

    const brain = new RemiSessionContext("greeting-short");
    brain.remiSelfFocus = "还惦记着你的面试";
    noteRemiSelfLastSeen("greeting-short", Date.now() - 10 * MIN);

    const runtime = makeRuntime({ connId: "greeting-short", brain });
    await scheduleGreetingOpener(runtime as any, Promise.resolve(), 5);
    await runtime._getChain();

    assert.equal(pipelineCalls.length, 0, "<30min 不应触发");
  });

  it("无 RemiSelf 记录（lastSeenAtMs 未 note）→ 不触发", async () => {
    const { scheduleGreetingOpener, __resetGreetingOpenerStateForTest } = loadGreetingOpenerModule();
    __resetGreetingOpenerStateForTest();

    const brain = new RemiSessionContext("greeting-norecord");
    const runtime = makeRuntime({ connId: "greeting-norecord", brain });
    await scheduleGreetingOpener(runtime as any, Promise.resolve(), 5);
    await runtime._getChain();

    assert.equal(pipelineCalls.length, 0);
  });

  it("素材全空（无 focus/线头/离线叙事）→ 不触发，即便离线够久", async () => {
    const { scheduleGreetingOpener, noteRemiSelfLastSeen, __resetGreetingOpenerStateForTest } =
      loadGreetingOpenerModule();
    __resetGreetingOpenerStateForTest();

    const brain = new RemiSessionContext("greeting-nomaterial");
    // 无 remiSelfFocus，无 sharedMoments/proactiveTopics（默认空），
    // offline-life flag 默认 off → offlineOpener 也是 null。
    noteRemiSelfLastSeen("greeting-nomaterial", Date.now() - 2 * HOUR);

    const runtime = makeRuntime({ connId: "greeting-nomaterial", brain });
    await scheduleGreetingOpener(runtime as any, Promise.resolve(), 5);
    await runtime._getChain();

    assert.equal(pipelineCalls.length, 0, "全空素材不应触发");
  });

  it("每会话最多一次：连续调用两次只触发一次", async () => {
    const { scheduleGreetingOpener, noteRemiSelfLastSeen, __resetGreetingOpenerStateForTest } =
      loadGreetingOpenerModule();
    __resetGreetingOpenerStateForTest();

    const brain = new RemiSessionContext("greeting-once");
    brain.remiSelfFocus = "上次的话题";
    noteRemiSelfLastSeen("greeting-once", Date.now() - 2 * HOUR);

    const runtime = makeRuntime({ connId: "greeting-once", brain });
    await scheduleGreetingOpener(runtime as any, Promise.resolve(), 5);
    await runtime._getChain();
    await scheduleGreetingOpener(runtime as any, Promise.resolve(), 5);
    await runtime._getChain();

    assert.equal(pipelineCalls.length, 1, "第二次调用应被 sent 标记拦下");
  });

  it("flag off → 不触发", async () => {
    const { scheduleGreetingOpener, noteRemiSelfLastSeen, __resetGreetingOpenerStateForTest } =
      loadGreetingOpenerModule();
    __resetGreetingOpenerStateForTest();
    enableGreetingFlag(false);

    const brain = new RemiSessionContext("greeting-flagoff");
    brain.remiSelfFocus = "上次的话题";
    noteRemiSelfLastSeen("greeting-flagoff", Date.now() - 2 * HOUR);

    const runtime = makeRuntime({ connId: "greeting-flagoff", brain });
    await scheduleGreetingOpener(runtime as any, Promise.resolve(), 5);
    await runtime._getChain();

    assert.equal(pipelineCalls.length, 0);
  });

  it("最近 5 分钟内用户已发消息（延迟期间校验）→ 不触发", async () => {
    const { scheduleGreetingOpener, noteRemiSelfLastSeen, __resetGreetingOpenerStateForTest } =
      loadGreetingOpenerModule();
    __resetGreetingOpenerStateForTest();

    const brain = new RemiSessionContext("greeting-recent-user");
    brain.remiSelfFocus = "上次的话题";
    noteRemiSelfLastSeen("greeting-recent-user", Date.now() - 2 * HOUR);

    const runtime = makeRuntime({
      connId: "greeting-recent-user",
      brain,
      lastInteractionAt: Date.now() - 60_000, // 1 分钟前发过消息
    });
    await scheduleGreetingOpener(runtime as any, Promise.resolve(), 5);
    await runtime._getChain();

    assert.equal(pipelineCalls.length, 0, "用户近期已发消息应放弃触发");
  });

  it("NSFW 模式开启 → 不触发", async () => {
    const { scheduleGreetingOpener, noteRemiSelfLastSeen, __resetGreetingOpenerStateForTest } =
      loadGreetingOpenerModule();
    __resetGreetingOpenerStateForTest();

    const brain = new RemiSessionContext("greeting-nsfw");
    brain.remiSelfFocus = "上次的话题";
    noteRemiSelfLastSeen("greeting-nsfw", Date.now() - 2 * HOUR);
    setNsfw("greeting-nsfw", true, "user-nsfw-test");

    try {
      const runtime = makeRuntime({ connId: "greeting-nsfw", brain });
      await scheduleGreetingOpener(runtime as any, Promise.resolve(), 5);
      await runtime._getChain();

      assert.equal(pipelineCalls.length, 0, "NSFW 模式下不应触发开场语");
    } finally {
      clearNsfw("greeting-nsfw");
    }
  });

  it("等待 remiSelfLoaded 失败也不抛错（仅当作已完成继续判定）", async () => {
    const { scheduleGreetingOpener, noteRemiSelfLastSeen, __resetGreetingOpenerStateForTest } =
      loadGreetingOpenerModule();
    __resetGreetingOpenerStateForTest();

    const brain = new RemiSessionContext("greeting-loadfail");
    brain.remiSelfFocus = "上次的话题";
    noteRemiSelfLastSeen("greeting-loadfail", Date.now() - 2 * HOUR);

    const runtime = makeRuntime({ connId: "greeting-loadfail", brain });
    await assert.doesNotReject(
      scheduleGreetingOpener(runtime as any, Promise.reject(new Error("boom")), 5),
    );
    await runtime._getChain();
    assert.equal(pipelineCalls.length, 1, "load 失败不应阻止后续正常触发判定");
  });
});
