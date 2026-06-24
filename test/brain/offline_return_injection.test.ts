const assert = require("assert").strict;

const { buildPrompt } = require("../../brain/prompt_builder");
const { setNsfw } = require("../../brains/nsfw_mode");

function systemOf(messages: Array<{ role: string; content: string }>): string {
  return messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n");
}

// 离线居家人生：归来叙事「事实锚」作为独立 system part 注入 prompt（NSFW 跳过）。
// flag gating 由 orchestrator（getConfig().REMI_OFFLINE_LIFE_ENABLED ? ctx.offline
// ReturnAnchor : null）负责——flag off → 传 null → buildPrompt 不 push。这里在
// buildPrompt 层验证：传 null/undefined/空（等价 flag off）不注入；传非空注入；
// NSFW 跳过。
const ANCHOR = [
  "【离线经历·事实锚】",
  "这段你不在的时间（大约 2 个小时），是按你们小世界的确定性居家日程算出来的真实经历，不是让你发挥编造。",
  "期间你只做过这些事：「在窗边看海」、「在书架边看书」。但只能讲这些，不要添加任何不在清单里的活动。",
].join("\n");

describe("离线归来叙事事实锚注入 (buildPrompt)", () => {
  it("提供非空 offlineReturnAnchor 时，注入为独立 system part（含事实锚正文）", () => {
    const messages = buildPrompt({
      memory: [],
      emotion: "neutral",
      history: [],
      userMessage: "嗨，刚才你在干嘛",
      offlineReturnAnchor: ANCHOR,
    });
    const system = systemOf(messages);
    assert.ok(system.includes("【离线经历·事实锚】"), "注入了事实锚标题");
    assert.ok(system.includes("只能讲这些"), "白名单约束出现在 prompt 中");
    assert.ok(system.includes("在窗边看海"), "beat label 出现在 prompt 中");
  });

  it("flag off 等价：null / undefined / 空 → 不注入", () => {
    for (const anchor of [undefined, null, "", "   "]) {
      const messages = buildPrompt({
        memory: [],
        emotion: "neutral",
        history: [],
        userMessage: "嗨",
        offlineReturnAnchor: anchor,
      });
      assert.ok(
        !systemOf(messages).includes("离线经历·事实锚"),
        `anchor=${JSON.stringify(anchor)} 不应注入`,
      );
    }
  });

  it("NSFW 模式跳过注入", () => {
    const connId = "test-offline-return-nsfw";
    setNsfw(connId, true);
    try {
      const messages = buildPrompt({
        memory: [],
        emotion: "neutral",
        history: [],
        userMessage: "嗨",
        connId,
        offlineReturnAnchor: ANCHOR,
      });
      assert.ok(
        !systemOf(messages).includes("离线经历·事实锚"),
        "NSFW 模式应跳过事实锚注入",
      );
    } finally {
      setNsfw(connId, false);
    }
  });

  it("与 remiSelfFocus 并存：两个独立 system part 都注入", () => {
    const messages = buildPrompt({
      memory: [],
      emotion: "neutral",
      history: [],
      userMessage: "嗨",
      remiSelfFocus: "你上次说周末要去看医生",
      offlineReturnAnchor: ANCHOR,
    });
    const system = systemOf(messages);
    assert.ok(system.includes("还惦记着上次"), "remiSelfFocus 仍注入");
    assert.ok(system.includes("离线经历·事实锚"), "归来叙事锚也注入");
  });
});
