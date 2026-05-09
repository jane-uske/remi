const assert = require("assert").strict;

const {
  buildCharacterRulesPrompt,
} = require("../../brain/character_rules");

describe("character_rules", () => {
  it("returns base character rules", () => {
    const prompt = buildCharacterRulesPrompt();
    assert.ok(prompt.includes("像真人朋友，不像客服或主持"));
  });
});
