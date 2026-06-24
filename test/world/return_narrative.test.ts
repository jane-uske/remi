import { strict as assert } from "node:assert";
import { describe, it } from "mocha";

import {
  computeReturnNarrative,
  buildReturnNarrativeAnchor,
  buildReturnNarrativeOpener,
  type ReturnNarrative,
} from "../../world/return_narrative";
import { BEHAVIOR_SPOTS } from "../../world/schedule";

const MIN = 60_000;
const HOUR = 60 * MIN;

// 固定一个基准 now，让测试确定性可复现。worldTimePhaseAt 用本地时区 getHours()，
// 所以这里不假设具体 phase 值，只断言"取 now 的 phase"这条不变量。
const NOW = Date.UTC(2026, 5, 24, 14, 0, 0) + 1234;

describe("computeReturnNarrative（归来叙事纯函数）", () => {
  it("离线 <30min → null（不构成一段日子）", () => {
    assert.equal(computeReturnNarrative(NOW - 29 * MIN, NOW), null);
    assert.equal(computeReturnNarrative(NOW - 10 * MIN, NOW), null);
    assert.equal(computeReturnNarrative(NOW - 1, NOW), null);
  });

  it("时钟回拨（now < lastSeen）→ null", () => {
    assert.equal(computeReturnNarrative(NOW + 1000, NOW), null);
    assert.equal(computeReturnNarrative(NOW + HOUR, NOW), null);
  });

  it("恰好 30min → 非空（边界含）", () => {
    const n = computeReturnNarrative(NOW - 30 * MIN, NOW);
    assert.ok(n, "30min 应触发");
    assert.equal(n!.elapsedMinutes, 30);
  });

  it("2h 窗口：beats ≤3、按时长降序、连续 run 去重（相邻不重复）", () => {
    const n = computeReturnNarrative(NOW - 2 * HOUR, NOW);
    assert.ok(n);
    assert.ok(n!.beats.length >= 1 && n!.beats.length <= 3, `beats=${n!.beats.length}`);
    // 降序
    for (let i = 1; i < n!.beats.length; i++) {
      assert.ok(
        n!.beats[i - 1].approxMinutes >= n!.beats[i].approxMinutes,
        "beats 必须按 approxMinutes 降序",
      );
    }
    // 每个 beat 至少 1 分钟
    for (const b of n!.beats) assert.ok(b.approxMinutes >= 1);
    // 措辞 100% 来自查表
    const validLabels = new Set(BEHAVIOR_SPOTS.map((s) => s.label));
    for (const b of n!.beats) assert.ok(validLabels.has(b.label), `非法 label: ${b.label}`);
  });

  it("批量窗口不变量：恒 ≤3 beats、恒降序（连续相同 behaviorId 已合并为 run）", () => {
    // 连续相同 behaviorId 的相邻采样在 merge 阶段合并成一个 run，所以不会出现
    // "相邻两段做同一件事被拆成两 beat"。非相邻回访（窗边→看书→窗边）允许，因为
    // 那是两段真实分开的时间。这里扫一批窗口验证全局不变量恒成立。
    for (let dur = 30; dur <= 480; dur += 7) {
      const n = computeReturnNarrative(NOW - dur * MIN, NOW);
      if (!n) continue;
      assert.ok(n.beats.length <= 3, `dur=${dur} beats>${3}`);
      for (let i = 1; i < n.beats.length; i++) {
        assert.ok(
          n.beats[i - 1].approxMinutes >= n.beats[i].approxMinutes,
          `dur=${dur} 非降序`,
        );
      }
    }
  });

  it("同输入确定性可复现（多次调用结果逐字段一致）", () => {
    const a = computeReturnNarrative(NOW - 3 * HOUR, NOW)!;
    const b = computeReturnNarrative(NOW - 3 * HOUR, NOW)!;
    assert.deepEqual(a, b);
    assert.equal(buildReturnNarrativeAnchor(a), buildReturnNarrativeAnchor(b));
    assert.equal(buildReturnNarrativeOpener(a), buildReturnNarrativeOpener(b));
  });

  it("跨 phase 的窗口：phase / phaseLabel 取 now（不讲成时间旅行）", () => {
    // 选一个 6h 窗口（必然跨多个 phase），断言 phaseLabel = now 时刻的 phase。
    const now = Date.UTC(2026, 5, 24, 23, 30, 0); // 一个固定 now
    const n = computeReturnNarrative(now - 6 * HOUR, now)!;
    // 直接用同一 now 的工具函数核对（不复制阈值，避免脆性）。
    // worldTimeProfileAt 是 phaseLabel 的唯一来源。
    const { worldTimeProfileAt, worldTimePhaseAt } = require("../../world/worldTime");
    assert.equal(n.phase, worldTimePhaseAt(now));
    assert.equal(n.phaseLabel, worldTimeProfileAt(now).label);
  });
});

describe("buildReturnNarrativeAnchor（防编造事实锚）", () => {
  const n = computeReturnNarrative(NOW - 2 * HOUR, NOW)!;
  const anchor = buildReturnNarrativeAnchor(n);

  it("含『只能讲这些』白名单约束", () => {
    assert.ok(anchor.includes("只能讲这些"), "缺白名单约束");
  });

  it("含『确定性…真实经历…不是…编造』的事实锚声明", () => {
    assert.ok(anchor.includes("确定性") && anchor.includes("真实经历"));
    assert.ok(anchor.includes("编造"));
  });

  it("含黑名单反例（出门 / 见了别人 / 清单里没有的事 / 前后矛盾的时间）", () => {
    assert.ok(anchor.includes("出门"));
    assert.ok(anchor.includes("见了别人"));
    assert.ok(anchor.includes("清单里没有的事"));
    assert.ok(anchor.includes("前后矛盾的时间"));
  });

  it("只包含传入 beat 的 label，不混入其它 BEHAVIOR_SPOTS label", () => {
    const present = new Set(n.beats.map((b) => b.label));
    for (const spot of BEHAVIOR_SPOTS) {
      if (present.has(spot.label)) {
        assert.ok(anchor.includes(spot.label), `应含 ${spot.label}`);
      } else {
        assert.ok(!anchor.includes(spot.label), `不应混入未发生的 ${spot.label}`);
      }
    }
  });

  it("anchor 提及 now 的 phaseLabel + weatherLabel（按现在的时间天气讲）", () => {
    assert.ok(anchor.includes(n.phaseLabel));
    assert.ok(anchor.includes(n.weatherLabel));
  });
});

describe("buildReturnNarrativeOpener（P2 开场白，本期只写不接线）", () => {
  it("非空 beats：开场白带出第一个 beat 的 label", () => {
    const n = computeReturnNarrative(NOW - 2 * HOUR, NOW)!;
    const opener = buildReturnNarrativeOpener(n);
    assert.ok(opener.includes("你回来啦"));
    assert.ok(opener.includes(n.beats[0].label));
    assert.ok(opener.includes(n.phaseLabel));
  });

  it("空 beats（理论兜底）：仍返回自然开场白", () => {
    const fake: ReturnNarrative = {
      elapsedMinutes: 120,
      phase: "day",
      phaseLabel: "午后",
      weatherLabel: "晴",
      beats: [],
    };
    const opener = buildReturnNarrativeOpener(fake);
    assert.ok(opener.includes("你回来啦"));
    assert.ok(opener.includes("午后"));
  });
});
