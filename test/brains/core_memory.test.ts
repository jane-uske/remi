const assert = require("assert").strict;
const {
  CoreMemoryStore,
  SECTION_LIMITS,
} = require("../../brains/core_memory");

// M3-P1 §14：Core Memory 差分编辑块。
describe("CoreMemoryStore", () => {
  // ── fromSlowBrainSnapshot ──

  describe("fromSlowBrainSnapshot", () => {
    it("maps facts to aboutYou slots", () => {
      const snap = makeSnap({ facts: new Map([["名字", "小王"], ["城市", "上海"]]) });
      const store = CoreMemoryStore.fromSlowBrainSnapshot(snap);
      const block = store.snapshot();
      assert.ok(block.aboutYou.some((s) => s.key === "名字" && s.value === "小王"));
      assert.ok(block.aboutYou.some((s) => s.key === "城市" && s.value === "上海"));
    });

    it("maps interests with prefix", () => {
      const snap = makeSnap({ interests: ["画画", "猫"] });
      const store = CoreMemoryStore.fromSlowBrainSnapshot(snap);
      const block = store.snapshot();
      assert.ok(block.aboutYou.some((s) => s.key === "兴趣:画画"));
      assert.ok(block.aboutYou.some((s) => s.key === "兴趣:猫"));
    });

    it("maps conversationSummary to aboutUs", () => {
      const snap = makeSnap({ conversationSummary: "聊了很多关于工作的事" });
      const store = CoreMemoryStore.fromSlowBrainSnapshot(snap);
      const block = store.snapshot();
      assert.ok(block.aboutUs.some((s) => s.key === "对话摘要" && s.value.includes("工作")));
    });

    it("maps workingMemory to rightNow", () => {
      const snap = makeSnap({
        workingMemory: {
          activeThread: "面试准备",
          currentNeed: "鼓励",
          openLoop: "明天面试",
          currentConstraints: [],
          doNotTouch: [],
          sceneState: "none",
          lastUpdatedTurn: 5,
        },
      });
      const store = CoreMemoryStore.fromSlowBrainSnapshot(snap);
      const block = store.snapshot();
      assert.ok(block.rightNow.some((s) => s.key === "活跃线程" && s.value === "面试准备"));
      assert.ok(block.rightNow.some((s) => s.key === "当前需求" && s.value === "鼓励"));
    });
  });

  // ── apply ──

  describe("apply (add / update / remove)", () => {
    it("adds a new slot", () => {
      const store = CoreMemoryStore.empty();
      const applied = store.apply([
        { op: "add", section: "aboutYou", key: "宠物", value: "一只猫叫点点" },
      ]);
      assert.equal(applied.length, 1);
      assert.ok(store.findSlot("aboutYou", "宠物"));
      assert.equal(store.findSlot("aboutYou", "宠物").value, "一只猫叫点点");
    });

    it("add on existing key upgrades to update", () => {
      const store = CoreMemoryStore.empty();
      store.apply([{ op: "add", section: "aboutYou", key: "工作", value: "在还债" }]);
      store.apply([{ op: "add", section: "aboutYou", key: "工作", value: "已还清" }]);
      assert.equal(store.findSlot("aboutYou", "工作").value, "已还清");
      assert.equal(store.snapshot().aboutYou.filter((s) => s.key === "工作").length, 1);
    });

    it("updates an existing slot", () => {
      const store = CoreMemoryStore.empty();
      store.apply([{ op: "add", section: "aboutYou", key: "城市", value: "上海" }]);
      const applied = store.apply([{ op: "update", section: "aboutYou", key: "城市", value: "北京" }]);
      assert.equal(applied.length, 1);
      assert.equal(store.findSlot("aboutYou", "城市").value, "北京");
    });

    it("update on non-existing key is a no-op", () => {
      const store = CoreMemoryStore.empty();
      const applied = store.apply([{ op: "update", section: "aboutYou", key: "不存在", value: "x" }]);
      assert.equal(applied.length, 0);
    });

    it("removes a slot", () => {
      const store = CoreMemoryStore.empty();
      store.apply([{ op: "add", section: "aboutYou", key: "临时", value: "val" }]);
      const applied = store.apply([{ op: "remove", section: "aboutYou", key: "临时" }]);
      assert.equal(applied.length, 1);
      assert.equal(store.findSlot("aboutYou", "临时"), undefined);
    });

    it("remove on non-existing key is a no-op", () => {
      const store = CoreMemoryStore.empty();
      const applied = store.apply([{ op: "remove", section: "aboutYou", key: "不存在" }]);
      assert.equal(applied.length, 0);
    });
  });

  // ── 淘汰 ──

  describe("eviction on capacity overflow", () => {
    it("evicts lowest salience slots when over limit", () => {
      const store = CoreMemoryStore.empty();
      const limit = SECTION_LIMITS.rightNow; // 6
      const evicted = [];
      store.onEvict = (slot, section) => evicted.push({ slot, section });

      // 添加 limit + 2 个 slot，其中 2 个 salience 最低
      for (let i = 0; i < limit + 2; i++) {
        store.apply([{
          op: "add",
          section: "rightNow",
          key: `slot-${i}`,
          value: `val-${i}`,
          salience: i < 2 ? 0.1 : 0.9,
        }]);
      }
      assert.equal(store.getSection("rightNow").length, limit);
      assert.equal(evicted.length, 2);
      assert.ok(evicted.every((e) => e.slot.salience === 0.1));
    });
  });

  // ── render 稳定排序 ──

  describe("render stability", () => {
    it("same data in different insertion order produces same output", () => {
      const store1 = CoreMemoryStore.empty();
      store1.apply([
        { op: "add", section: "aboutYou", key: "名字", value: "小王" },
        { op: "add", section: "aboutYou", key: "城市", value: "上海" },
      ]);

      const store2 = CoreMemoryStore.empty();
      store2.apply([
        { op: "add", section: "aboutYou", key: "城市", value: "上海" },
        { op: "add", section: "aboutYou", key: "名字", value: "小王" },
      ]);

      assert.equal(store1.render(), store2.render());
    });

    it("render includes section headings", () => {
      const store = CoreMemoryStore.empty();
      store.apply([
        { op: "add", section: "aboutYou", key: "名字", value: "小王" },
        { op: "add", section: "aboutUs", key: "关系", value: "刚认识" },
      ]);
      const output = store.render();
      assert.ok(output.includes("【关于你】"));
      assert.ok(output.includes("【关于我们】"));
    });

    it("empty sections are omitted", () => {
      const store = CoreMemoryStore.empty();
      store.apply([{ op: "add", section: "aboutYou", key: "名字", value: "x" }]);
      const output = store.render();
      assert.ok(output.includes("【关于你】"));
      assert.ok(!output.includes("【关于我们】"));
      assert.ok(!output.includes("【此刻】"));
    });
  });

  // ── export helpers ──

  describe("export helpers", () => {
    it("exportFacts excludes interest/personality prefixed slots", () => {
      const store = CoreMemoryStore.empty();
      store.apply([
        { op: "add", section: "aboutYou", key: "名字", value: "小王" },
        { op: "add", section: "aboutYou", key: "兴趣:画画", value: "画画" },
        { op: "add", section: "aboutYou", key: "性格:内向", value: "偏内向" },
      ]);
      const facts = store.exportFacts();
      assert.equal(facts.size, 1);
      assert.equal(facts.get("名字"), "小王");
    });

    it("exportInterests returns interest values", () => {
      const store = CoreMemoryStore.empty();
      store.apply([
        { op: "add", section: "aboutYou", key: "兴趣:猫", value: "猫" },
        { op: "add", section: "aboutYou", key: "兴趣:画", value: "画" },
      ]);
      assert.deepEqual(store.exportInterests().sort(), ["猫", "画"].sort());
    });
  });
});

// ── helper ──

function makeSnap(overrides) {
  return {
    userProfile: {
      facts: overrides.facts ?? new Map(),
      interests: overrides.interests ?? [],
      personalityNotes: overrides.personalityNotes ?? [],
      responseStyleNotes: overrides.responseStyleNotes ?? [],
    },
    relationship: {
      familiarity: overrides.familiarity ?? 0,
      emotionalBond: overrides.emotionalBond ?? 0,
      turnCount: overrides.turnCount ?? 0,
      preferredTopics: [],
    },
    topicHistory: [],
    moodTrajectory: overrides.moodTrajectory ?? [],
    conversationSummary: overrides.conversationSummary ?? "",
    proactiveTopics: [],
    sharedMoments: overrides.sharedMoments ?? [],
    workingMemory: overrides.workingMemory ?? undefined,
    repairState: overrides.repairState ?? undefined,
    continuityCueState: { lastProactiveHook: "", lastProactiveTurn: -100, lastSharedMomentSummary: "", lastSharedMomentTurn: -100 },
  };
}
