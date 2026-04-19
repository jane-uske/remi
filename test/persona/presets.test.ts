const assert = require("assert").strict;
const {
  getPersonaPreset,
  listPersonaPresets,
  isPersonaPresetId,
} = require("../../persona/presets");
const {
  applyPersonaPreset,
  listPersonaPresetIds,
} = require("../../brains/dev_presets");
const { createDefaultPersona } = require("../../persona");

describe("persona preset registry", () => {
  it("initializes the default persona with a canonical preset id", () => {
    const persona = createDefaultPersona();
    assert.equal(persona.profile.presetId, "witty_warm");
  });

  it("exposes the four user-facing presets", () => {
    const ids = listPersonaPresets().map((preset) => preset.id);
    assert.deepEqual(ids, [
      "witty_warm",
      "relaxed_roast",
      "playful_attached",
      "calm_healing",
    ]);
  });

  it("guards unknown preset ids and exposes structured expression fields", () => {
    assert.equal(isPersonaPresetId("witty_warm"), true);
    assert.equal(isPersonaPresetId("nope"), false);
    assert.equal(getPersonaPreset("relaxed_roast").expression.teasingStyle, "light");
  });

  it("returns defensive copies instead of shared mutable objects", () => {
    const first = getPersonaPreset("witty_warm");
    first.profile.toneGuide = "mutated";
    first.expression.teasingStyle = "playful";

    const second = getPersonaPreset("witty_warm");
    assert.equal(second.profile.toneGuide, "先接住，再轻轻推进，幽默只点到为止。");
    assert.equal(second.expression.teasingStyle, "off");
  });

  it("keeps dev-facing helpers aligned with the registry", () => {
    assert.deepEqual(
      listPersonaPresetIds(),
      listPersonaPresets().map((preset) => preset.id),
    );

    const persona = createDefaultPersona();
    applyPersonaPreset(persona, "relaxed_roast");
    assert.equal(persona.profile.presetId, "relaxed_roast");
    assert.equal(persona.profile.label, getPersonaPreset("relaxed_roast").label);
    assert.deepEqual(
      persona.profile.expressionStyle,
      getPersonaPreset("relaxed_roast").expression,
    );
  });
});
