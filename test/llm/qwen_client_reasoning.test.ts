const assert = require("assert").strict;
const {
  appendNoThinkDirective,
  resolveReasoningRequest,
  salvageVisibleFromReasoning,
  stripThinkBlocks,
} = require("../../llm/qwen_client");

describe("qwen_client reasoning", () => {
  it("strips think blocks but keeps visible text", () => {
    assert.equal(
      stripThinkBlocks("<think>hidden</think>好的，在呢。"),
      "好的，在呢。",
    );
  });

  it("maps none to output directive and API reasoning_effort none", () => {
    const messages = [{ role: "system", content: "你是 Remi" }];
    const resolved = resolveReasoningRequest(messages, "none");
    assert.equal(resolved.apiReasoningEffort, "none");
    assert.match(resolved.messages[0].content, /输出约束/);
    assert.doesNotMatch(resolved.messages[0].content, /\/no_think/);
  });

  it("keeps low effort without forcing no-think directive", () => {
    const messages = [{ role: "system", content: "你是 Remi" }];
    const resolved = resolveReasoningRequest(messages, "low");
    assert.equal(resolved.apiReasoningEffort, "low");
    assert.equal(resolved.messages[0].content, "你是 Remi");
  });

  it("salvages Chinese reply embedded in reasoning traces", () => {
    const reasoning = [
      "Here's a thinking process:",
      'Example: "你好！我是Remi，很高兴见到你。"',
      "Output: 你好！我是Remi，很高兴见到你。今天有什么我可以帮你的吗？",
    ].join("\n");
    assert.equal(
      salvageVisibleFromReasoning(reasoning),
      "你好！我是Remi，很高兴见到你。今天有什么我可以帮你的吗？",
    );
  });

  it("appends output directive only on system prompt", () => {
    const messages = [
      { role: "system", content: "你是 Remi" },
      { role: "user", content: "你好" },
    ];
    const resolved = appendNoThinkDirective(messages);
    assert.match(resolved[0].content, /输出约束/);
    assert.equal(resolved[1].content, "你好");
  });
});