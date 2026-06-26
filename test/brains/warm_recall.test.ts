const assert = require("assert").strict;
const { WarmRecallCache } = require("../../brains/warm_recall");

const MEM = [
  { key: "名字", value: "小明" },
  { key: "当前未完主线", value: "工作压力：最近项目延期" },
];

describe("WarmRecallCache (VOICE_BEST_PRACTICES 杠杆1)", () => {
  it("reuses recall when fresh and topic overlaps (prediction miss, recall salvaged)", () => {
    const c = new WarmRecallCache();
    c.store("我最近工作压力好大", MEM, 1000);
    // final 与 partial 主题高度重叠（前缀续写），但不是严格前缀 → 预测会 miss，召回仍应复用
    const got = c.take("我最近工作压力好大，晚上也睡不着", {
      ttlMs: 8000,
      minOverlap: 0.5,
      now: 2000,
    });
    assert.deepEqual(got, MEM);
  });

  it("is one-shot: a second take returns null", () => {
    const c = new WarmRecallCache();
    c.store("我最近工作压力好大", MEM, 1000);
    assert.deepEqual(
      c.take("我最近工作压力好大", { ttlMs: 8000, minOverlap: 0.5, now: 1500 }),
      MEM,
    );
    assert.equal(
      c.take("我最近工作压力好大", { ttlMs: 8000, minOverlap: 0.5, now: 1500 }),
      null,
    );
  });

  it("returns null when stale (older than ttl)", () => {
    const c = new WarmRecallCache();
    c.store("我最近工作压力好大", MEM, 1000);
    assert.equal(
      c.take("我最近工作压力好大", { ttlMs: 8000, minOverlap: 0.5, now: 1000 + 8001 }),
      null,
    );
  });

  it("returns null on topic drift (low overlap) — protects against stale-topic memory", () => {
    const c = new WarmRecallCache();
    c.store("我最近工作压力好大", MEM, 1000);
    // 用户其实说的是完全不同的事 → 不应复用工作相关召回
    assert.equal(
      c.take("帮我推荐一部周末看的电影", { ttlMs: 8000, minOverlap: 0.5, now: 1500 }),
      null,
    );
  });

  it("ignores too-short partials and empty memory", () => {
    const c = new WarmRecallCache();
    c.store("嗯", MEM, 1000); // <4 chars
    assert.equal(c.has(), false);
    c.store("我最近工作压力好大", [], 1000); // empty memory
    assert.equal(c.has(), false);
  });

  it("store overwrites the previous entry (only the latest partial is warm)", () => {
    const c = new WarmRecallCache();
    c.store("我最近工作压力好大", MEM, 1000);
    const NEXT = [{ key: "城市", value: "上海" }];
    c.store("周末想去哪里玩比较好", NEXT, 1100);
    // 旧 partial 主题已被覆盖
    assert.equal(
      c.take("我最近工作压力好大", { ttlMs: 8000, minOverlap: 0.5, now: 1200 }),
      null,
    );
  });

  it("clear() drops the warm entry", () => {
    const c = new WarmRecallCache();
    c.store("我最近工作压力好大", MEM, 1000);
    assert.equal(c.has(), true);
    c.clear();
    assert.equal(c.has(), false);
  });
});
