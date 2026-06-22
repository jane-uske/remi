const assert = require("assert").strict;

const {
  buildCharacterRulesPrompt,
} = require("../../brain/character_rules");

describe("character_rules", () => {
  it("returns base character rules with positive behavior framing", () => {
    const prompt = buildCharacterRulesPrompt();
    assert.ok(prompt.includes("接话贴着对方原话的弯度走"));
    assert.ok(prompt.includes("第一句不要以语气词+感叹号开头"));
    assert.ok(prompt.includes("这一轮回复最多一个问句"));
  });
});
