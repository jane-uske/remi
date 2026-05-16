const assert = require("assert").strict;

const { InMemoryRepository } = require("../../memory/memory_store");
const { retrievePromptMemory } = require("../../memory/memory_agent");

function applyEnv(values) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

async function seedRepo(entries) {
  const repo = new InMemoryRepository();
  const now = Date.now();
  for (const entry of entries) {
    await repo.upsert(entry.key, entry.value, entry.importance);
    const stored = repo.entries.find((item) => item.key === entry.key);
    stored.createdAt = entry.createdAt ?? now;
    stored.lastAccessedAt = entry.lastAccessedAt ?? now;
    stored.importance = entry.importance ?? stored.importance;
  }
  return repo;
}

describe("prompt memory retrieval", () => {
  it("returns core facts from KV store", async () => {
    const repo = await seedRepo([
      { key: "名字", value: "小满", importance: 0.9, lastAccessedAt: 100 },
      { key: "城市", value: "杭州", importance: 0.7, lastAccessedAt: 200 },
      { key: "工作", value: "设计师", importance: 0.4, lastAccessedAt: 50 },
      { key: "运动喜好", value: "夜跑", importance: 0.6, lastAccessedAt: 500 },
    ]);

    const memories = await retrievePromptMemory(repo, {
      userMessage: "昨晚夜跑完还是有点失眠",
      maxEntries: 4,
    });

    const coreKeys = memories.filter((e) => ["名字", "城市", "工作"].includes(e.key));
    assert.ok(coreKeys.length >= 2, "should include at least 2 core facts");
    assert.equal(memories[0].key, "名字");
    assert.equal(memories[1].key, "城市");
  });

  it("returns only core facts for light-touch turns", async () => {
    const repo = await seedRepo([
      { key: "名字", value: "阿宁", importance: 0.9, lastAccessedAt: 100 },
      { key: "城市", value: "上海", importance: 0.7, lastAccessedAt: 150 },
      { key: "宠物", value: "猫", importance: 0.3, lastAccessedAt: 120 },
      { key: "收藏歌手", value: "王菲", importance: 0.95, lastAccessedAt: 900 },
    ]);

    const memories = await retrievePromptMemory(repo, {
      userMessage: "嗯",
      maxEntries: 3,
    });

    assert.deepEqual(memories.map((entry) => entry.key), ["名字", "城市"]);
  });

  it("returns empty when no core facts and no episode store", async () => {
    const repo = await seedRepo([
      {
        key: "当前行为",
        value: "咨询 Codex SDK 接入相关问题",
        importance: 1,
        createdAt: Date.now() - 1000 * 60 * 60 * 24 * 3,
        lastAccessedAt: Date.now() - 1000 * 60 * 60 * 24 * 3,
      },
      {
        key: "当前诉求",
        value: "确认 Codex 开发执行稿的存放位置",
        importance: 1,
        createdAt: Date.now() - 1000 * 60 * 60 * 24 * 2,
        lastAccessedAt: Date.now() - 1000 * 60 * 60 * 24 * 2,
      },
    ]);

    const memories = await retrievePromptMemory(repo, {
      userMessage: "我刚起床，今天先不弄项目。",
      maxEntries: 3,
    });

    assert.deepEqual(memories, []);
  });

  it("never returns reserved relationship state keys", async () => {
    const restoreEnv = applyEnv({ MAX_PROMPT_MEMORY_ENTRIES: "6" });
    const repo = await seedRepo([
      { key: "名字", value: "阿宁", importance: 0.9, lastAccessedAt: 100 },
      {
        key: "__rem_relationship_state_v1",
        value: '{"version":"v1"}',
        importance: 1,
        lastAccessedAt: 999,
      },
    ]);

    try {
      const memories = await retrievePromptMemory(repo, {
        userMessage: "我们继续聊",
      });
      assert.deepEqual(memories, [{ key: "名字", value: "阿宁" }]);
    } finally {
      restoreEnv();
    }
  });

  it("emits diagnostics with episode recall source", async () => {
    const repo = await seedRepo([
      { key: "名字", value: "小满", importance: 0.9 },
    ]);

    let captured = null;
    await retrievePromptMemory(repo, {
      userMessage: "最近怎么样",
      maxEntries: 3,
      diagnostics: (meta) => { captured = meta; },
    });

    assert.ok(captured, "diagnostics callback should be called");
    assert.equal(captured.episodeRecallSource, "none");
    assert.deepEqual(captured.episodeRecallIds, []);
  });

  it("respects maxEntries limit", async () => {
    const repo = await seedRepo([
      { key: "名字", value: "小满", importance: 0.9 },
      { key: "城市", value: "杭州", importance: 0.7 },
      { key: "工作", value: "设计师", importance: 0.4 },
      { key: "学校", value: "浙大", importance: 0.5 },
      { key: "宠物", value: "猫", importance: 0.3 },
    ]);

    const memories = await retrievePromptMemory(repo, {
      userMessage: "今天天气不错",
      maxEntries: 2,
    });

    assert.equal(memories.length, 2);
  });

  it("returns empty for maxEntries=0", async () => {
    const repo = await seedRepo([
      { key: "名字", value: "小满", importance: 0.9 },
    ]);

    const memories = await retrievePromptMemory(repo, {
      userMessage: "你好",
      maxEntries: 0,
    });

    assert.deepEqual(memories, []);
  });
});
