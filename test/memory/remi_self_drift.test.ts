const assert = require("assert").strict;

const {
  driftRemiSelf,
  normalizeCurrentFocus,
  NEUTRAL_MOOD,
  MAX_CURRENT_FOCUS_CHARS,
} = require("../../memory/remi_self");

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

function baseRecord(overrides = {}) {
  const seen = new Date("2026-06-24T12:00:00Z");
  return {
    mood: "开心",
    energy: "low",
    currentFocus: "你周末说要去爬山，后来去成了吗",
    topicPull: "周末爬山",
    lastSeenAt: seen,
    lastSavedAt: seen,
    ...overrides,
  };
}

// DL-P1b: 离线漂移纯函数（零 LLM、确定性）。四档对应
// docs/design/DIGITAL_LIFE_NORTH_STAR.md §1 离线漂移表（按本期落地差异降维）。
describe("driftRemiSelf — offline 漂移四档", () => {
  it("<30min：原样保持（mood/energy/topicPull/currentFocus 都不变）", () => {
    const saved = baseRecord();
    const now = new Date(saved.lastSeenAt.getTime() + 10 * MIN);
    const out = driftRemiSelf(saved, now);
    assert.equal(out.mood, "开心");
    assert.equal(out.energy, "low");
    assert.equal(out.topicPull, "周末爬山");
    assert.equal(out.currentFocus, saved.currentFocus);
  });

  it("30min–4h：energy 向上回一档（low→medium），其余保留", () => {
    const saved = baseRecord();
    const now = new Date(saved.lastSeenAt.getTime() + 2 * HOUR);
    const out = driftRemiSelf(saved, now);
    assert.equal(out.energy, "medium");
    assert.equal(out.mood, "开心"); // mood 保留
    assert.equal(out.topicPull, "周末爬山"); // topicPull 保留
    assert.equal(out.currentFocus, saved.currentFocus); // currentFocus 保留
  });

  it("30min–4h：energy=medium 时回一档到 high", () => {
    const saved = baseRecord({ energy: "medium" });
    const now = new Date(saved.lastSeenAt.getTime() + 2 * HOUR);
    assert.equal(driftRemiSelf(saved, now).energy, "high");
  });

  it("4–24h：mood 收敛到中性『平静』，energy 回一档，topicPull/currentFocus 保留", () => {
    const saved = baseRecord();
    const now = new Date(saved.lastSeenAt.getTime() + 8 * HOUR);
    const out = driftRemiSelf(saved, now);
    assert.equal(out.mood, NEUTRAL_MOOD);
    assert.equal(out.mood, "平静");
    assert.equal(out.energy, "medium"); // low → medium
    assert.equal(out.topicPull, "周末爬山"); // 保留
    assert.equal(out.currentFocus, saved.currentFocus); // 保留
  });

  it(">24h：mood『平静』，energy→high，topicPull 清空，currentFocus 刻意保留", () => {
    const saved = baseRecord();
    const now = new Date(saved.lastSeenAt.getTime() + 30 * HOUR);
    const out = driftRemiSelf(saved, now);
    assert.equal(out.mood, "平静");
    assert.equal(out.energy, "high");
    assert.equal(out.topicPull, ""); // volatile — 清空
    assert.equal(out.currentFocus, saved.currentFocus); // 卖点：还记着上次
  });

  it("边界：恰好 30min 进入第二档（energy 回升）", () => {
    const saved = baseRecord();
    const now = new Date(saved.lastSeenAt.getTime() + 30 * MIN);
    assert.equal(driftRemiSelf(saved, now).energy, "medium");
  });

  it("边界：恰好 24h 进入第四档（topicPull 清空）", () => {
    const saved = baseRecord();
    const now = new Date(saved.lastSeenAt.getTime() + 24 * HOUR);
    assert.equal(driftRemiSelf(saved, now).topicPull, "");
  });

  it("时钟回拨 / 未来 lastSeenAt → 当作刚刚，原样保持", () => {
    const saved = baseRecord();
    const now = new Date(saved.lastSeenAt.getTime() - 5 * MIN);
    const out = driftRemiSelf(saved, now);
    assert.equal(out.mood, "开心");
    assert.equal(out.energy, "low");
  });

  it("不原地修改入参（返回新对象）", () => {
    const saved = baseRecord();
    const now = new Date(saved.lastSeenAt.getTime() + 30 * HOUR);
    driftRemiSelf(saved, now);
    assert.equal(saved.energy, "low", "入参 energy 未被改");
    assert.equal(saved.topicPull, "周末爬山", "入参 topicPull 未被改");
  });
});

describe("normalizeCurrentFocus", () => {
  it("trim + 非空返回原文", () => {
    assert.equal(normalizeCurrentFocus("  在惦记爬山  "), "在惦记爬山");
  });
  it("空 / 空白 / 非字符串 → null", () => {
    assert.equal(normalizeCurrentFocus(""), null);
    assert.equal(normalizeCurrentFocus("   "), null);
    assert.equal(normalizeCurrentFocus(null), null);
    assert.equal(normalizeCurrentFocus(undefined), null);
  });
  it("超长文本截断到封顶", () => {
    const long = "字".repeat(200);
    const out = normalizeCurrentFocus(long);
    assert.equal(out.length, MAX_CURRENT_FOCUS_CHARS);
  });
});
