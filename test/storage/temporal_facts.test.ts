const assert = require("assert").strict;
const {
  InMemoryTemporalFactsRepository,
} = require("../../storage/repositories/in_memory_temporal_facts");

// M3-P2 §14：bi-temporal 长期事实层。
// 用内存实现测试，PG 实现共享同一接口语义。
describe("TemporalFactsRepository (in-memory)", () => {
  let repo;

  beforeEach(() => {
    repo = new InMemoryTemporalFactsRepository();
  });

  it("ingest creates a fact with t_invalid=null", async () => {
    await repo.ingest("u1", { subject: "工作", predicate: "状态", object: "在还债" });
    const facts = await repo.recall("u1");
    assert.equal(facts.length, 1);
    assert.equal(facts[0].subject, "工作");
    assert.equal(facts[0].object, "在还债");
    assert.equal(facts[0].tInvalid, null);
  });

  it("ingest with same subject+predicate different object invalidates old fact", async () => {
    await repo.ingest("u1", { subject: "工作", predicate: "状态", object: "在还债" });
    await repo.ingest("u1", { subject: "工作", predicate: "状态", object: "已还清" });

    const current = await repo.recall("u1");
    assert.equal(current.length, 1);
    assert.equal(current[0].object, "已还清");
    assert.equal(current[0].tInvalid, null);

    // 旧事实应该有 tInvalid
    const timeline = await repo.history("u1", "工作");
    assert.equal(timeline.length, 2);
    const old = timeline.find((f) => f.object === "在还债");
    assert.ok(old);
    assert.ok(old.tInvalid !== null, "old fact should be invalidated");
  });

  it("ingest with same subject+predicate+object is a no-op (no duplicate)", async () => {
    await repo.ingest("u1", { subject: "名字", predicate: "是", object: "小王" });
    await repo.ingest("u1", { subject: "名字", predicate: "是", object: "小王" });
    const facts = await repo.recall("u1");
    assert.equal(facts.length, 1);
  });

  it("recall with asOf returns facts valid at that point in time", async () => {
    const t1 = new Date("2026-06-01T00:00:00Z");
    const t2 = new Date("2026-06-15T00:00:00Z");

    await repo.ingest("u1", { subject: "工作", predicate: "状态", object: "在还债", tValid: t1 });
    await repo.ingest("u1", { subject: "工作", predicate: "状态", object: "已还清", tValid: t2 });

    // 回溯到 6月10日：应该看到"在还债"
    const midPoint = new Date("2026-06-10T00:00:00Z");
    const factsAtMid = await repo.recall("u1", { asOf: midPoint });
    assert.equal(factsAtMid.length, 1);
    assert.equal(factsAtMid[0].object, "在还债");

    // 当前：应该看到"已还清"
    const factsNow = await repo.recall("u1");
    assert.equal(factsNow.length, 1);
    assert.equal(factsNow[0].object, "已还清");
  });

  it("recall returns facts sorted by salience DESC", async () => {
    await repo.ingest("u1", { subject: "A", predicate: "p", object: "low", salience: 0.2 });
    await repo.ingest("u1", { subject: "B", predicate: "p", object: "high", salience: 0.9 });
    const facts = await repo.recall("u1");
    assert.equal(facts[0].subject, "B");
    assert.equal(facts[1].subject, "A");
  });

  it("recall respects k limit", async () => {
    for (let i = 0; i < 5; i++) {
      await repo.ingest("u1", { subject: `fact-${i}`, predicate: "p", object: `v${i}` });
    }
    const facts = await repo.recall("u1", { k: 2 });
    assert.equal(facts.length, 2);
  });

  it("history returns all versions of a subject in t_valid DESC order", async () => {
    const t1 = new Date("2026-01-01");
    const t2 = new Date("2026-06-01");
    const t3 = new Date("2026-06-20");
    await repo.ingest("u1", { subject: "城市", predicate: "居住", object: "上海", tValid: t1 });
    await repo.ingest("u1", { subject: "城市", predicate: "居住", object: "北京", tValid: t2 });
    await repo.ingest("u1", { subject: "城市", predicate: "居住", object: "深圳", tValid: t3 });

    const timeline = await repo.history("u1", "城市");
    assert.equal(timeline.length, 3);
    assert.equal(timeline[0].object, "深圳"); // most recent
    assert.equal(timeline[2].object, "上海"); // oldest
  });

  it("different users do not interfere", async () => {
    await repo.ingest("u1", { subject: "名字", predicate: "是", object: "小王" });
    await repo.ingest("u2", { subject: "名字", predicate: "是", object: "小李" });
    const u1 = await repo.recall("u1");
    const u2 = await repo.recall("u2");
    assert.equal(u1.length, 1);
    assert.equal(u1[0].object, "小王");
    assert.equal(u2.length, 1);
    assert.equal(u2[0].object, "小李");
  });
});
