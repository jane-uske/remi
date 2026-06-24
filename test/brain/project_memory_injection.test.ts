const assert = require("assert").strict;

const { buildPrompt } = require("../../brain/prompt_builder");

function systemOf(messages: Array<{ role: string; content: string }>): string {
  return messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n");
}

// Task A: ProjectMemory injects via a DEDICATED system part (projectMemoryBlock),
// NOT via strategyHints → priorityContext (which buildSystemPrompt trims to
// MAX_PRIORITY_CONTEXT_CHARS = 500). So a long block — and crucially its
// user_working_style tail — reaches the prompt in full.
describe("project memory injection — dedicated projectMemoryBlock (own budget)", () => {
  it("a long block (>500 chars) survives in full, including its working-style tail", () => {
    const filler = "· 最近在做：" + "推进了不少事情，".repeat(80); // well over 500 chars
    const tail =
      "· 用户希望你怎么帮 ta（务必照做）：安排任务别拆太细，直接给可复制的 Claude Code 中文提示词";
    const block = `【用户的长期事务·长期事务记忆】\n${filler}\n${tail}`;
    assert.ok(block.length > 500, "precondition: block exceeds the 500-char priority cap");

    const messages = buildPrompt({
      memory: [],
      emotion: "neutral",
      history: [],
      userMessage: "帮我安排下一步",
      // a small priorityContext alongside, to prove they don't compete for budget
      priorityContext: "【优先参考】先共情，再给具体建议",
      projectMemoryBlock: block,
    });

    const system = systemOf(messages);
    assert.ok(
      system.includes(tail),
      "the working-style tail must survive (NOT truncated by the 500-char priority cap)",
    );
    assert.ok(system.includes("Claude Code"), "delivery preference reaches the final prompt");
    assert.ok(system.includes("先共情"), "priorityContext is unaffected — both coexist");
  });

  it("omitted when no projectMemoryBlock is provided", () => {
    const messages = buildPrompt({
      memory: [],
      emotion: "neutral",
      history: [],
      userMessage: "嗨",
    });
    assert.ok(!systemOf(messages).includes("长期事务记忆"));
  });
});
