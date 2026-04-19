const assert = require("assert").strict;
const { RemiSessionContext } = require("../../brains/remi_session_context");
const { buildPrompt } = require("../../brain/prompt_builder");
const {
  resolvePersonaStyleDirective,
} = require("../../persona/style_override");

describe("persona style override", () => {
  it("persists a high-confidence llm style intent across follow-up turns for a short window", () => {
    const ctx = new RemiSessionContext("style-override");

    const resolved = resolvePersonaStyleDirective({
      styleIntent: {
        humorBoost: true,
        teasingLevel: "off",
        assistantySuppression: true,
        familiarityBoost: true,
        romanceBoost: false,
        roleplayStyle: null,
        confidence: 0.86,
      },
      userMessage: "你能不能有趣点，别这么像助手，像熟一点的人一样跟我说话。",
    });
    assert.ok(resolved);
    assert.equal(resolved.kind, "set");
    ctx.persona.liveState.styleOverride = resolved.override;

    assert.ok(ctx.persona.liveState.styleOverride);
    assert.equal(ctx.persona.liveState.styleOverride.remainingTurns, 6);

    const followupSystem = buildPrompt({
      memory: [],
      emotion: "neutral",
      history: [],
      userMessage: "那你继续",
      persona: ctx.persona,
    })[0].content;

    assert.ok(followupSystem.includes("【当前风格要求】"));
    assert.ok(followupSystem.includes("像熟一点的人那样自然接话"));

    ctx.updateLiveState("neutral", "那你继续", "行，那我先别端着。");
    assert.ok(ctx.persona.liveState.styleOverride);
    assert.equal(ctx.persona.liveState.styleOverride.remainingTurns, 5);
  });

  it("falls back to explicit regex directives when llm style intent is missing", () => {
    const resolved = resolvePersonaStyleDirective({
      styleIntent: null,
      userMessage: "你毒舌一点，但别伤人，别这么像助手。",
    });

    assert.ok(resolved);
    assert.equal(resolved.kind, "set");
    assert.equal(resolved.override.teasingMode, "light");
    assert.equal(resolved.override.assistantySuppression, true);
  });

  it("lets the user clear a short-term style override explicitly", () => {
    const resolved = resolvePersonaStyleDirective({
      styleIntent: null,
      userMessage: "先恢复正常，正常跟我说就行，不用演了。",
    });

    assert.ok(resolved);
    assert.equal(resolved.kind, "clear");
  });
});
