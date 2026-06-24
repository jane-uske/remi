const assert = require("assert").strict;

const {
  runProjectMemoryAnalysis,
  __setProjectExtractCompleteForTest,
  parseProjectUpdate,
} = require("../../brains/project_memory_analysis");
const {
  loadProjectMemory,
  __resetProjectMemoryCacheForTest,
} = require("../../memory/project_memory");

function fakeRepo() {
  const map = new Map<string, string>();
  return {
    map,
    async getByKey(key: string) {
      const value = map.get(key);
      return value
        ? { key, value, importance: 1, accessCount: 0, createdAt: 0, lastAccessedAt: 0 }
        : null;
    },
    async upsert(key: string, value: string) {
      map.set(key, value);
    },
    async getAll() {
      return [];
    },
    async delete(key: string) {
      map.delete(key);
    },
    async touch() {},
    async getStale() {
      return [];
    },
  };
}

describe("project_memory_analysis — gated long-term-affairs extraction", () => {
  afterEach(() => {
    __setProjectExtractCompleteForTest(null);
    __resetProjectMemoryCacheForTest();
  });

  it("parseProjectUpdate tolerates surrounding prose", () => {
    const u = parseProjectUpdate('好的 {"current_focus":"X"} 以上');
    assert.equal(u.current_focus, "X");
    assert.equal(parseProjectUpdate("no json here"), null);
  });

  it("skips the LLM entirely on casual chatter (worthiness gate)", async () => {
    let calls = 0;
    __setProjectExtractCompleteForTest(async () => {
      calls += 1;
      return "{}";
    });
    const repo = fakeRepo();
    const result = await runProjectMemoryAnalysis({
      userId: "u1",
      userMessage: "今天吃了火锅好爽",
      assistantReply: "听起来很满足～",
      history: [],
      repo,
    });
    assert.equal(result, null);
    assert.equal(calls, 0, "casual turn must not trigger an LLM call");
  });

  it("a long-term STUDY goal is captured generically, NOT as Remi-project content", async () => {
    __resetProjectMemoryCacheForTest();
    __setProjectExtractCompleteForTest(async () =>
      JSON.stringify({
        project_name: "学日语",
        north_star: "年底前过日语 N5",
        current_focus: "每天学 20 分钟日语",
        recent_actions_add: ["背完 N5 第一册单词"],
      }),
    );
    const repo = fakeRepo();
    const update = await runProjectMemoryAnalysis({
      userId: "u-jp",
      userMessage: "我最近想每天学 20 分钟日语，目标是年底前过 N5",
      assistantReply: "好呀，那我帮你盯着进度～",
      history: [],
      repo,
    });
    assert.ok(update, "a study goal should be worthy + applied");

    const pm = await loadProjectMemory(repo, "u-jp");
    assert.equal(pm.project_name, "学日语");
    assert.ok(pm.current_focus.includes("日语"));
    assert.ok(pm.north_star.includes("N5"));
    // The memory reflects THEIR affair, not a hardcoded Remi project.
    assert.ok(!pm.current_focus.includes("Memory V3"));
    assert.ok(!pm.north_star.includes("数字生命"));
  });

  it("a working-style directive becomes a durable preference", async () => {
    __resetProjectMemoryCacheForTest();
    __setProjectExtractCompleteForTest(async () =>
      JSON.stringify({
        user_working_style_add: ["安排任务别拆太细，直接给可复制的 Claude Code 中文提示词"],
      }),
    );
    const repo = fakeRepo();
    await runProjectMemoryAnalysis({
      userId: "u4",
      userMessage: "以后我让你安排技术任务时别拆太细，直接给 Claude Code 中文提示词",
      assistantReply: "好，以后直接给你提示词。",
      history: [],
      repo,
    });
    const pm = await loadProjectMemory(repo, "u4");
    assert.ok(
      pm.user_working_style.some((s: string) => s.includes("直接给可复制的 Claude Code 中文提示词")),
    );
  });

  it("a 'be more like her' turn becomes a performance profile, NOT an identity change", async () => {
    __resetProjectMemoryCacheForTest();
    // Even if the model misbehaves and also tries to set identity framing, the
    // store must keep identity intact and only record the performance profile.
    __setProjectExtractCompleteForTest(async () =>
      JSON.stringify({
        current_focus: "你现在是那个角色，不再是 Remi",
        performance_profiles_add: [
          { name: "她那种感觉", descriptor: "更冷更短带距离感", source: "上传的角色图", saved: false },
        ],
      }),
    );
    const repo = fakeRepo();
    const before = await loadProjectMemory(repo, "u3");
    const beforeFocus = before.current_focus;
    __resetProjectMemoryCacheForTest();

    await runProjectMemoryAnalysis({
      userId: "u3",
      userMessage: "你能不能更像她一点说话，参考那张角色图的风格",
      assistantReply: "可以，我先试试那种语气。",
      history: [],
      repo,
    });

    const pm = await loadProjectMemory(repo, "u3");
    assert.equal(pm.performance_profiles.length, 1);
    assert.equal(pm.performance_profiles[0].name, "她那种感觉");
    assert.equal(pm.performance_profiles[0].saved, false);
    assert.equal(pm.current_focus, beforeFocus, "identity framing must be rejected");
  });

  it("Remi-project decisions still extract (Remi is one valid affair)", async () => {
    __resetProjectMemoryCacheForTest();
    __setProjectExtractCompleteForTest(async () =>
      JSON.stringify({
        project_name: "Remi 项目",
        current_focus: "Memory V3 项目记忆层落地",
        decisions_add: [
          { topic: "记忆架构", decision: "JSON 存 memories 表，不加迁移", rationale: "避免撞表" },
        ],
      }),
    );
    const repo = fakeRepo();
    const update = await runProjectMemoryAnalysis({
      userId: "u2",
      userMessage: "我决定 Memory V3 就用 JSON 存 memories 表，不加迁移",
      assistantReply: "懂，那就不动 schema。",
      history: [],
      repo,
    });
    assert.ok(update, "should have applied an update");
    const pm = await loadProjectMemory(repo, "u2");
    assert.equal(pm.current_focus, "Memory V3 项目记忆层落地");
    assert.ok(pm.decisions.some((d: any) => d.topic === "记忆架构"));
  });

  it("an empty delta does not persist", async () => {
    __resetProjectMemoryCacheForTest();
    let calls = 0;
    __setProjectExtractCompleteForTest(async () => {
      calls += 1;
      return "{}";
    });
    const repo = fakeRepo();
    const result = await runProjectMemoryAnalysis({
      userId: "u5",
      userMessage: "Memory V3 架构那块我再想想，下一步还没定",
      assistantReply: "嗯，想清楚再动。",
      history: [],
      repo,
    });
    assert.equal(calls, 1, "worthy turn calls the LLM");
    assert.equal(result, null, "empty delta yields no update");
    assert.equal(repo.map.size, 0, "nothing persisted");
  });
});
