import { strict as assert } from "node:assert";
import { describe, it, afterEach } from "mocha";

import {
  HISTORY_GAP_MARKER,
  TIME_CONTEXT_MARKER,
  buildHistoryGapMarker,
  formatNow,
} from "../../brain/time_context";
import { buildPrompt } from "../../brain/prompt_builder";
import { RemiSessionContext } from "../../brains/remi_session_context";
import { resetConfig } from "../../server/config";
import type { DbMessage } from "../../storage/types";

const HOUR = 60 * 60 * 1000;

function fakeMessage(
  id: string,
  role: "user" | "assistant",
  content: string,
  createdAt: Date,
): DbMessage {
  return { id, session_id: "s-history-gap", role, content, created_at: createdAt };
}

function setHistoryGapFlag(enabled: boolean): void {
  process.env.REMI_HISTORY_GAP_MARKER_ENABLED = enabled ? "1" : "0";
  resetConfig();
}

function clearHistoryGapFlag(): void {
  delete process.env.REMI_HISTORY_GAP_MARKER_ENABLED;
  resetConfig();
}

// 2026-07-03 生产坏样本（第三轮）：跨会话加载的最近历史里有昨天的坏对话原文
// （含 assistant 自己说的"明天周一还得早起""肚子还绞痛吗"）。对模型而言，
// 自己昨天的原话是最强 few-shot，权重盖过 system 层所有时效合同——历史被当成
// "正在进行的对话"，其中的身体状态/日程/时间全部穿越到今天。
//
// 本文件验证"历史时段"断层标记三层：
//  1) 纯函数 buildHistoryGapMarker（brain/time_context.ts）的阈值 + 文案
//  2) buildPrompt 的落点（动态尾部，紧邻 timeContext，不进可缓存前缀）
//  3) RemiSessionContext 的数据通道（hydrateHistoryFromDb → lastHistoryAt）
//     与 flag 门控（buildHistoryGapMarkerBlock）

describe("buildHistoryGapMarker（纯函数，brain/time_context.ts）", () => {
  it(">3h（5 小时）：注入，含标记、绝对时间与换算指令", () => {
    const now = new Date("2026-07-03T10:00:00+08:00");
    const lastHistoryAt = new Date("2026-07-03T05:00:00+08:00"); // 5h 前
    const block = buildHistoryGapMarker({
      now,
      lastHistoryAt,
      timeZone: "Asia/Shanghai",
      locale: "zh-CN",
    });
    assert.ok(block, "应注入断层提示");
    assert.ok(block!.startsWith(HISTORY_GAP_MARKER), "以【历史时段】开头");
    assert.ok(block!.includes("5 小时前"), "含相对间隔描述（复用 describeGap）");
    const whenText = formatNow(lastHistoryAt, "Asia/Shanghai", "zh-CN");
    assert.ok(block!.includes(whenText), "含历史最后一轮的绝对日期/时间");
    assert.ok(block!.includes("换算到今天"), "含把历史时间词换算到今天的指令");
    assert.ok(block!.includes("身体状态"), "点名身体状态/日程/情绪这类最容易穿越的内容");
    assert.ok(block!.includes("不是刚刚"), "明确提醒历史不是刚刚发生的");
  });

  it(">3h（3 天）：相对间隔按天描述", () => {
    const now = new Date("2026-07-03T10:00:00+08:00");
    const lastHistoryAt = new Date(now.getTime() - 3 * 24 * HOUR);
    const block = buildHistoryGapMarker({
      now,
      lastHistoryAt,
      timeZone: "Asia/Shanghai",
      locale: "zh-CN",
    });
    assert.ok(block);
    assert.ok(block!.includes("3 天前"));
  });

  it("<3h（2 小时）：不注入", () => {
    const now = new Date("2026-07-03T10:00:00+08:00");
    const lastHistoryAt = new Date("2026-07-03T08:00:00+08:00"); // 2h 前
    const block = buildHistoryGapMarker({
      now,
      lastHistoryAt,
      timeZone: "Asia/Shanghai",
      locale: "zh-CN",
    });
    assert.equal(block, null);
  });

  it("无历史（lastHistoryAt=null）：不注入", () => {
    const block = buildHistoryGapMarker({
      now: new Date(),
      lastHistoryAt: null,
      timeZone: null,
      locale: null,
    });
    assert.equal(block, null);
  });
});

describe("buildPrompt 集成：historyGapMarker 落在动态尾部、紧邻 timeContext", () => {
  const historyGapMarker =
    `${HISTORY_GAP_MARKER}上面这段对话历史的最后一轮发生在 7月2日 09:00（约 1 天前），不是刚刚：` +
    `其中提到的身体状态、日程、情绪都是当时的记录，此刻未必还成立；历史里出现的"明天/今晚/周一"等时间词` +
    `以当时为准，换算到今天再理解。接续话题可以，但别把当时的状态当成现在。`;
  const timeContext = `${TIME_CONTEXT_MARKER}现在是 2026年7月3日星期五 10:00。`;

  it("与 timeContext 一起注入时，两者按序合并进最后一条 user 消息，且不进 messages[0]", () => {
    const messages = buildPrompt({
      memory: [],
      emotion: "neutral",
      history: [
        { role: "user", content: "在吗" },
        { role: "assistant", content: "在的～" },
      ],
      userMessage: "我回来啦",
      historyGapMarker,
      timeContext,
    });

    // 不污染可缓存前缀（system 消息，messages[0]）
    assert.ok(!messages[0].content.includes(HISTORY_GAP_MARKER), "不出现在 system 前缀里");

    const last = messages[messages.length - 1];
    assert.equal(last.role, "user");
    assert.ok(last.content.includes(HISTORY_GAP_MARKER), "historyGapMarker 落进最后一条消息");
    assert.ok(last.content.includes(TIME_CONTEXT_MARKER), "timeContext 也落进同一条消息");
    assert.ok(last.content.trim().endsWith("我回来啦"), "原始 userMessage 仍在最末尾");
    assert.ok(
      last.content.indexOf(HISTORY_GAP_MARKER) < last.content.indexOf(TIME_CONTEXT_MARKER),
      "historyGapMarker 顺序应在 timeContext 之前（先说历史是旧的，再声明现在几点）",
    );
  });

  it("只提供 historyGapMarker（无 timeContext）时仍正常注入动态尾部", () => {
    const messages = buildPrompt({
      memory: [],
      emotion: "neutral",
      history: [],
      userMessage: "嗨",
      historyGapMarker,
    });
    const last = messages[messages.length - 1];
    assert.equal(last.role, "user");
    assert.ok(last.content.includes(HISTORY_GAP_MARKER));
    assert.ok(last.content.trim().endsWith("嗨"));
  });

  it("不提供 historyGapMarker 时不注入，原有行为不变", () => {
    const messages = buildPrompt({
      memory: [],
      emotion: "neutral",
      history: [],
      userMessage: "嗨",
    });
    const last = messages[messages.length - 1];
    assert.equal(last.content, "嗨");
    assert.ok(!last.content.includes(HISTORY_GAP_MARKER));
  });
});

describe("RemiSessionContext.hydrateHistoryFromDb → lastHistoryAt/firstHistoryAt", () => {
  it("从 DbMessage[] 中取最早/最晚 created_at（按值取 min/max，不依赖入参顺序）", () => {
    const ctx = new RemiSessionContext("conn-hgm-order");
    const t0 = new Date("2026-07-01T09:00:00+08:00");
    const t1 = new Date("2026-07-01T09:05:00+08:00");
    const t2 = new Date("2026-07-02T08:00:00+08:00"); // 最新
    // 故意打乱顺序（不是严格 ASC），验证实现按 created_at 取值而非位置假设
    ctx.hydrateHistoryFromDb([
      fakeMessage("m2", "assistant", "回复2", t1),
      fakeMessage("m1", "user", "消息1", t0),
      fakeMessage("m3", "user", "消息3", t2),
    ]);
    assert.equal(ctx.firstHistoryAt?.getTime(), t0.getTime());
    assert.equal(ctx.lastHistoryAt?.getTime(), t2.getTime());
  });

  it("无历史时保持 null", () => {
    const ctx = new RemiSessionContext("conn-hgm-empty");
    assert.equal(ctx.lastHistoryAt, null);
    assert.equal(ctx.firstHistoryAt, null);
  });

  it("resetSessionArtifacts 连同 history 一起清空历史时间元信息", () => {
    const ctx = new RemiSessionContext("conn-hgm-reset");
    ctx.hydrateHistoryFromDb([fakeMessage("m1", "user", "hi", new Date())]);
    assert.ok(ctx.lastHistoryAt, "hydrate 后应有值");
    ctx.resetSessionArtifacts();
    assert.equal(ctx.lastHistoryAt, null);
    assert.equal(ctx.firstHistoryAt, null);
  });
});

describe("RemiSessionContext.buildHistoryGapMarkerBlock（flag 门控）", () => {
  afterEach(() => {
    clearHistoryGapFlag();
  });

  it("flag 默认开（未设置环境变量）：>3h 注入", () => {
    clearHistoryGapFlag();
    const ctx = new RemiSessionContext("conn-hgm-default-on");
    const now = new Date("2026-07-03T10:00:00+08:00");
    ctx.hydrateHistoryFromDb([
      fakeMessage("m1", "user", "肚子好疼，明天周一还要早起", new Date("2026-07-02T22:00:00+08:00")),
    ]);
    const block = ctx.buildHistoryGapMarkerBlock(now);
    assert.ok(block, "默认应开启注入");
    assert.ok(block!.startsWith(HISTORY_GAP_MARKER));
  });

  it("<3h：不注入", () => {
    const ctx = new RemiSessionContext("conn-hgm-recent");
    const now = new Date("2026-07-03T10:00:00+08:00");
    ctx.hydrateHistoryFromDb([
      fakeMessage("m1", "user", "在的", new Date("2026-07-03T09:00:00+08:00")), // 1h 前
    ]);
    assert.equal(ctx.buildHistoryGapMarkerBlock(now), null);
  });

  it("无历史：不注入", () => {
    const ctx = new RemiSessionContext("conn-hgm-nohist");
    assert.equal(ctx.buildHistoryGapMarkerBlock(new Date()), null);
  });

  it("flag off：即使 >3h 也不注入", () => {
    setHistoryGapFlag(false);
    const ctx = new RemiSessionContext("conn-hgm-flagoff");
    const now = new Date("2026-07-03T10:00:00+08:00");
    ctx.hydrateHistoryFromDb([
      fakeMessage("m1", "user", "肚子好疼", new Date("2026-07-02T22:00:00+08:00")),
    ]);
    assert.equal(ctx.buildHistoryGapMarkerBlock(now), null, "flag off 应恒 null");
  });
});
