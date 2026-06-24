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
    assert.equal(persona.profile.presetId, "remi_core");
  });

  it("exposes remi_core plus the dev-facing experimental presets", () => {
    const ids = listPersonaPresets().map((preset) => preset.id);
    assert.deepEqual(ids, [
      "remi_core",
      "witty_warm",
      "relaxed_roast",
      "playful_attached",
      "calm_healing",
    ]);
  });

  it("defines remi_core as gentle and devoted by default with serious-scene restraint", () => {
    const preset = getPersonaPreset("remi_core");
    assert.equal(preset.label, "Remi");
    assert.equal(preset.expression.humorLevel, "low");
    assert.equal(preset.expression.teasingStyle, "off");
    assert.match(preset.profile.coreIdentity, /温柔|勤恳|站他这边/);
    assert.match(preset.profile.toneGuide, /严肃|收住/);
  });

  it("guards unknown preset ids and exposes structured expression fields", () => {
    assert.equal(isPersonaPresetId("witty_warm"), true);
    assert.equal(isPersonaPresetId("remi_core"), true);
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
