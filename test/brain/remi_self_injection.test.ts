const assert = require("assert").strict;

const { buildPrompt } = require("../../brain/prompt_builder");
const { setNsfw } = require("../../brains/nsfw_mode");

function systemOf(messages: Array<{ role: string; content: string }>): string {
  return messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n");
}

// DL-P1b: RemiSelf 跨会话挂念（currentFocus）作为轻量、可选提示注入 prompt。
describe("RemiSelf currentFocus injection (buildPrompt)", () => {
  it("提供 remiSelfFocus 时，注入『还惦记着上次的一件事』提示", () => {
    const focus = "你上次说周末要去看医生，后来怎么样了";
    const messages = buildPrompt({
      memory: [],
      emotion: "neutral",
      history: [],
      userMessage: "嗨",
      remiSelfFocus: focus,
    });
    const system = systemOf(messages);
    assert.ok(system.includes("还惦记着上次"), "注入了挂念提示语");
    assert.ok(system.includes(focus), "焦点内容出现在 prompt 中");
    // 软提示：明确叮嘱别每轮硬提 / 机械复述
    assert.ok(system.includes("别每轮都硬提") || system.includes("别机械复述"));
  });

  it("无 remiSelfFocus（undefined/null/空）时不注入", () => {
    for (const focus of [undefined, null, "", "   "]) {
      const messages = buildPrompt({
        memory: [],
        emotion: "neutral",
        history: [],
        userMessage: "嗨",
        remiSelfFocus: focus,
      });
      assert.ok(!systemOf(messages).includes("还惦记着上次"), `focus=${JSON.stringify(focus)} 不应注入`);
    }
  });

  it("NSFW 模式跳过注入", () => {
    const connId = "test-remi-self-nsfw";
    setNsfw(connId, true);
    try {
      const messages = buildPrompt({
        memory: [],
        emotion: "neutral",
        history: [],
        userMessage: "嗨",
        connId,
        remiSelfFocus: "你上次说要换工作",
      });
      assert.ok(!systemOf(messages).includes("还惦记着上次"), "NSFW 模式应跳过挂念注入");
    } finally {
      setNsfw(connId, false);
    }
  });
});
