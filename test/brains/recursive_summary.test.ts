const assert = require("assert").strict;
const { buildAnalysisMessages } = require("../../brains/background_analysis");
const {
  clipSummary,
  MAX_SUMMARY_CHARS,
} = require("../../brains/background_analysis_store");

// M3-P0 §14.2：摘要累积不丢旧信息。
// 验证 llmAnalysis 的消息构造"喂回上一版摘要 + 增量更新"，而不是只镜像最近窗口。
describe("slow brain recursive summary accumulation", () => {
  const base = {
    userMessage: "今天终于把花呗还清了",
    assistantReply: "太好了，压了你这么久的事终于了结。",
    history: [
      { role: "user", content: "最近一直在还债，压力好大" },
      { role: "assistant", content: "嗯，欠款的事确实磨人。" },
    ],
    observationDate: "2026-06-22",
  };

  it("feeds the prior summary back so it accumulates (not a window mirror)", () => {
    const prior = "用户三周前点点闯祸赔了一笔，一直在还债、压力很大。";
    const messages = buildAnalysisMessages({ ...base, priorSummary: prior });
    const userContent = messages.find((m) => m.role === "user").content;
    assert.ok(userContent.includes("【已有摘要】"));
    // 旧摘要原文必须被喂回，模型才能在它基础上累积，而不是只看最近两轮。
    assert.ok(userContent.includes(prior));
    // 窗口外的旧信息线索（点点闯祸）随旧摘要保留，证明不丢。
    assert.ok(userContent.includes("点点闯祸"));
  });

  it("instructs incremental update that preserves still-relevant old info", () => {
    const messages = buildAnalysisMessages({ ...base, priorSummary: "" });
    const system = messages.find((m) => m.role === "system").content;
    assert.ok(system.includes("增量更新"));
    assert.ok(system.includes("保留仍然重要的旧信息"));
    assert.ok(system.includes("累积覆盖整段关系"));
    assert.ok(system.includes("不是只概括最近几轮"));
  });

  it("marks first-time generation when there is no prior summary", () => {
    const messages = buildAnalysisMessages({ ...base, priorSummary: "" });
    const userContent = messages.find((m) => m.role === "user").content;
    assert.ok(userContent.includes("暂无") || userContent.includes("首次生成"));
  });

  it("still includes the latest turn as the new delta", () => {
    const messages = buildAnalysisMessages({ ...base, priorSummary: "旧摘要内容" });
    const userContent = messages.find((m) => m.role === "user").content;
    assert.ok(userContent.includes("最新一轮"));
    assert.ok(userContent.includes("今天终于把花呗还清了"));
  });
});

// M3-P0 §14：摘要封顶 — 防无限增量累积撑爆 prompt。
describe("conversation summary capping (clipSummary)", () => {
  it("returns short summaries unchanged", () => {
    const s = "用户喜欢猫，最近在还债。";
    assert.equal(clipSummary(s), s);
  });

  it("clips at sentence boundary when over limit", () => {
    // 构造一段刚好超限的摘要：用短句拼到超过 MAX_SUMMARY_CHARS
    const sentence = "这是一段测试用的摘要句子，用来验证截断逻辑是否正确。";
    const repeated = Array(Math.ceil(MAX_SUMMARY_CHARS / sentence.length) + 2)
      .fill(sentence)
      .join("");
    assert.ok(repeated.length > MAX_SUMMARY_CHARS, "precondition: input is over limit");
    const clipped = clipSummary(repeated);
    assert.ok(clipped.length <= MAX_SUMMARY_CHARS, "should be within limit");
    // 应该在句号处截断
    assert.ok(clipped.endsWith("。") || clipped.endsWith("."), "should end at sentence boundary");
  });

  it("preserves key info from early in the summary", () => {
    // 关键信息在开头，长尾是填充——截断后关键信息仍在
    const keyInfo = "点点闯祸赔了一笔。";
    const filler = "后来又发生了一些事情，用户心情有所好转。".repeat(30);
    const long = keyInfo + filler;
    assert.ok(long.length > MAX_SUMMARY_CHARS);
    const clipped = clipSummary(long);
    assert.ok(clipped.includes("点点闯祸"), "key info from early part should survive");
  });

  it("never exceeds MAX_SUMMARY_CHARS even with no sentence boundary", () => {
    // 全是连续字符无标点
    const noPunctuation = "啊".repeat(MAX_SUMMARY_CHARS + 200);
    const clipped = clipSummary(noPunctuation);
    assert.ok(clipped.length <= MAX_SUMMARY_CHARS);
  });

  it("MAX_SUMMARY_CHARS is a reasonable bound", () => {
    assert.ok(MAX_SUMMARY_CHARS >= 300, "too small would lose info");
    assert.ok(MAX_SUMMARY_CHARS <= 1000, "too large defeats the purpose");
  });
});
