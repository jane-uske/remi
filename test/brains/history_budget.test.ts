const assert = require("assert").strict;
const {
  trimHistoryToTokenBudget,
  estimateTextTokens,
} = require("../../brains/history_budget");

// M3-P0 §14.2：窗口按 token 预算裁剪（放大窗口的安全网，缓存未知也不超预算）。
describe("history token budget trimming", () => {
  const mk = (n) =>
    Array.from({ length: n }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: "这是一条比较长的测试消息内容用来占用若干 token #" + i,
    }));

  it("drops oldest messages and keeps the most recent when over budget", () => {
    const history = mk(20);
    const budget = 200;
    const trimmed = trimHistoryToTokenBudget(history, budget);
    assert.ok(trimmed.length < history.length, "should drop some");
    // 保留的是最近的（尾部）
    assert.equal(
      trimmed[trimmed.length - 1].content,
      history[history.length - 1].content,
    );
    // 预算被遵守（除非已压到最小尾部 4 条）
    const total = trimmed.reduce((a, m) => a + estimateTextTokens(m.content), 0);
    assert.ok(total <= budget || trimmed.length <= 4);
  });

  it("never drops below the minimum tail even with a tiny budget", () => {
    const history = mk(10);
    const trimmed = trimHistoryToTokenBudget(history, 1);
    assert.ok(trimmed.length >= 1);
    assert.equal(
      trimmed[trimmed.length - 1].content,
      history[history.length - 1].content,
    );
  });

  it("returns history unchanged when within budget", () => {
    const history = mk(2);
    const trimmed = trimHistoryToTokenBudget(history, 100000);
    assert.equal(trimmed.length, 2);
  });

  it("returns empty input unchanged", () => {
    assert.deepEqual(trimHistoryToTokenBudget([], 100), []);
  });
});
