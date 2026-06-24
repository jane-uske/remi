const assert = require("assert").strict;

const {
  InMemoryRemiSelfRepository,
} = require("../../storage/repositories/in_memory_remi_self");
const {
  getRemiSelfRepository,
  __resetRemiSelfRepositoryForTest,
} = require("../../storage/repositories/remi_self_repository_factory");

function rec(overrides = {}) {
  const now = new Date("2026-06-24T12:00:00Z");
  return {
    mood: "好奇",
    energy: "medium",
    currentFocus: "你说要换工作，进展怎么样了",
    topicPull: "换工作",
    lastSeenAt: now,
    lastSavedAt: now,
    ...overrides,
  };
}

// DL-P1b: RemiSelf 持久层接口语义（内存实现；PG 实现共享同一接口语义）。
describe("RemiSelfRepository (in-memory)", () => {
  let repo;
  beforeEach(() => {
    repo = new InMemoryRemiSelfRepository();
  });

  it("load 无记录返回 null", async () => {
    assert.equal(await repo.load("u1"), null);
  });

  it("save 后 load 取回同一份", async () => {
    await repo.save("u1", rec());
    const got = await repo.load("u1");
    assert.equal(got.mood, "好奇");
    assert.equal(got.energy, "medium");
    assert.equal(got.currentFocus, "你说要换工作，进展怎么样了");
    assert.equal(got.topicPull, "换工作");
  });

  it("save 同 user 是 upsert（更新不堆叠）", async () => {
    await repo.save("u1", rec({ mood: "开心" }));
    await repo.save("u1", rec({ mood: "低落", energy: "low" }));
    const got = await repo.load("u1");
    assert.equal(got.mood, "低落");
    assert.equal(got.energy, "low");
  });

  it("不同 user 互不干扰", async () => {
    await repo.save("u1", rec({ mood: "开心" }));
    await repo.save("u2", rec({ mood: "委屈" }));
    assert.equal((await repo.load("u1")).mood, "开心");
    assert.equal((await repo.load("u2")).mood, "委屈");
  });

  it("load 返回防御性拷贝（外部修改不污染存储）", async () => {
    await repo.save("u1", rec());
    const got = await repo.load("u1");
    got.mood = "被外部改了";
    assert.equal((await repo.load("u1")).mood, "好奇");
  });

  it("currentFocus 允许 null", async () => {
    await repo.save("u1", rec({ currentFocus: null }));
    assert.equal((await repo.load("u1")).currentFocus, null);
  });
});

// 无 DATABASE_URL（isDbReady=false）时工厂返回内存实现，且跨调用为同一进程级单例
// （卖点：同进程内重连仍记得）。
describe("getRemiSelfRepository factory (no DB → in-memory singleton)", () => {
  afterEach(() => {
    __resetRemiSelfRepositoryForTest();
  });

  it("无 DB 时返回内存实现，跨 get 调用是同一实例（记录跨『重连』保留）", async () => {
    const r1 = getRemiSelfRepository();
    await r1.save("u1", rec({ mood: "平静" }));
    const r2 = getRemiSelfRepository(); // 模拟重连后重新取
    const got = await r2.load("u1");
    assert.ok(got, "同进程内单例应保留记录");
    assert.equal(got.mood, "平静");
  });

  it("__resetRemiSelfRepositoryForTest 清空内存存储", async () => {
    const r1 = getRemiSelfRepository();
    await r1.save("u1", rec());
    __resetRemiSelfRepositoryForTest();
    const r2 = getRemiSelfRepository();
    assert.equal(await r2.load("u1"), null);
  });
});
