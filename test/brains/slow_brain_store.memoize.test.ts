const assert = require("assert").strict;

const { SlowBrainStore } = require("../../brains/background_analysis_store");

describe("slow brain store memoize cache", () => {
  it("invalidates derived snapshot cache after shared-moment mutation", () => {
    const store = new SlowBrainStore();
    store.recordTurn();
    store.recordTurn();
    store.recordSharedMoment({
      summary: "上次你提到最近总是睡不好。",
      topic: "睡眠",
      mood: "疲惫/烦躁",
      hook: "昨晚睡得怎么样",
      kind: "support",
      salience: 0.8,
      unresolved: true,
      createdAt: 100,
    });

    const first = store.getSnapshot();
    const firstCount = first.episodes?.length ?? 0;

    store.recordTurn();
    store.recordSharedMoment({
      summary: "后来你又说工作压力还在影响睡眠。",
      topic: "工作",
      mood: "焦虑",
      hook: "那阵压力后来有缓一点吗？",
      kind: "stress",
      salience: 0.9,
      unresolved: true,
      createdAt: 200,
    });

    const second = store.getSnapshot();
    const secondCount = second.episodes?.length ?? 0;
    assert.equal(secondCount >= firstCount, true);
    assert.equal(
      (second.episodes ?? []).some((entry) =>
        entry.originMomentSummaries.includes("后来你又说工作压力还在影响睡眠。"),
      ),
      true,
    );
  });
});
