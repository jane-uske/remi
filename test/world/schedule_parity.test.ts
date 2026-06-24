import { strict as assert } from "node:assert";
import { describe, it } from "mocha";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { scheduledBehaviorAt, BEHAVIOR_SPOTS } from "../../world/schedule";
import { weatherAt } from "../../world/weather";
import { worldTimePhaseAt, worldTimeProfileAt } from "../../world/worldTime";

// ── 一致性锁 ───────────────────────────────────────────────────────────────
// 做法：FIXTURE。server world/* 是 web/src/lib/world/* 的逐字节移植；服务端不能
// import web，所以在 web 侧（scripts/gen_world_parity_fixture.mjs 用 ts-node 跑 web
// 版）对一组固定 epoch（网格 + 种子随机，N=1200）生成黄金 fixture JSON 提交进
// test/world/fixtures/schedule_parity.json。这里读 fixture，比对 world/* 输出与
// web 版逐字节一致——任一份纯函数漂移立刻红。
//
// 局限：fixture 是 web 版某一时刻的快照，不是 live 双跑。若 web 与 server 同时同向
// 改错，fixture 重新生成后不会报警（但 PR diff 会暴露 world/* 改动）。覆盖范围限于
// 生成时撒的 epoch 集合（一整天逐 7 分钟网格 × 4 天 + ±400 天种子随机），刻意覆盖
// phase 边界（5/11/17/21 时）、多个 105s 行为 slot、各种 6h 天气 slot。
//
// 重新生成：编辑过任一 world/* 或 web/src/lib/world/* 纯函数后，跑
//   node scripts/gen_world_parity_fixture.mjs

interface Sample {
  epochMs: number;
  behavior: string;
  behaviorWithWeather: string;
  weatherState: string;
  weatherLabel: string;
  indoorOnly: boolean;
  phase: string;
  phaseLabel: string;
  behaviorPool: string[];
}

const fixturePath = resolve(__dirname, "fixtures/schedule_parity.json");
const fixture: { _meta: { count: number }; samples: Sample[] } = JSON.parse(
  readFileSync(fixturePath, "utf8"),
);

describe("world/* ↔ web/src/lib/world/* 一致性锁（黄金 fixture）", () => {
  it("fixture 非空且 ≥1000 样本", () => {
    assert.ok(fixture.samples.length >= 1000, `样本数 ${fixture.samples.length} < 1000`);
    assert.equal(fixture.samples.length, fixture._meta.count, "count 元数据与样本数一致");
  });

  it("scheduledBehaviorAt（无天气）逐字节匹配 web 版", () => {
    for (const s of fixture.samples) {
      assert.equal(
        scheduledBehaviorAt(s.epochMs),
        s.behavior,
        `behavior mismatch @ ${s.epochMs}`,
      );
    }
  });

  it("scheduledBehaviorAt（带天气过滤）逐字节匹配 web 版", () => {
    for (const s of fixture.samples) {
      const actual = scheduledBehaviorAt(s.epochMs, weatherAt(s.epochMs));
      assert.equal(actual, s.behaviorWithWeather, `behaviorWithWeather mismatch @ ${s.epochMs}`);
    }
  });

  it("weatherAt（state / label / indoorOnly）逐字节匹配 web 版", () => {
    for (const s of fixture.samples) {
      const w = weatherAt(s.epochMs);
      assert.equal(w.state, s.weatherState, `weatherState mismatch @ ${s.epochMs}`);
      assert.equal(w.label, s.weatherLabel, `weatherLabel mismatch @ ${s.epochMs}`);
      assert.equal(w.indoorOnly, s.indoorOnly, `indoorOnly mismatch @ ${s.epochMs}`);
    }
  });

  it("worldTimePhaseAt / phaseLabel / behaviorPool 逐字节匹配 web 版", () => {
    for (const s of fixture.samples) {
      assert.equal(worldTimePhaseAt(s.epochMs), s.phase, `phase mismatch @ ${s.epochMs}`);
      const profile = worldTimeProfileAt(s.epochMs);
      assert.equal(profile.label, s.phaseLabel, `phaseLabel mismatch @ ${s.epochMs}`);
      assert.deepEqual(
        profile.behaviorPool.slice(),
        s.behaviorPool,
        `behaviorPool mismatch @ ${s.epochMs}`,
      );
    }
  });

  // 常数断言兜底：即使 fixture 被误删/重生，下面的硬常量仍锁住关键阈值/label/slot，
  // 与 web/src/lib/world 的 :44-85 label、:155 SLOT、:53 weather 阈值对齐。
  it("BEHAVIOR_SPOTS 的 id→label 锁定（叙事措辞唯一来源）", () => {
    const map = Object.fromEntries(BEHAVIOR_SPOTS.map((b) => [b.id, b.label]));
    assert.deepEqual(map, {
      reading: "在书架边看书",
      window: "在窗边看海",
      flowers: "在花圃打理花",
      bench: "在长椅边发呆",
      music: "在电脑前听音乐",
    });
  });

  it("phase 边界锁定（5/11/17/21 时切换）", () => {
    const at = (h: number) => worldTimePhaseAt(new Date(2026, 0, 1, h, 0, 0).getTime());
    assert.equal(at(4), "night");
    assert.equal(at(5), "morning");
    assert.equal(at(10), "morning");
    assert.equal(at(11), "day");
    assert.equal(at(16), "day");
    assert.equal(at(17), "dusk");
    assert.equal(at(20), "dusk");
    assert.equal(at(21), "night");
  });
});
