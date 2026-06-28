const assert = require("assert").strict;
const {
  loadPersonaPack,
  clearPersonaPackCache,
} = require("../../../persona/pack/loader");
const { getActivePersonaPackId } = require("../../../brains/persona_pack_mode");
const { resetConfig } = require("../../../server/config");

describe("nami pack + configurable default pack", () => {
  const ORIG = process.env.REMI_DEFAULT_PERSONA_PACK;

  afterEach(() => {
    if (ORIG === undefined) delete process.env.REMI_DEFAULT_PERSONA_PACK;
    else process.env.REMI_DEFAULT_PERSONA_PACK = ORIG;
    resetConfig();
    clearPersonaPackCache();
  });

  it("loads the nami pack from personas/nami", () => {
    const pack = loadPersonaPack("nami", { noCache: true });
    assert.ok(pack, "nami pack loads");
    assert.equal(pack.manifest.id, "nami");
    assert.equal(pack.manifest.name, "娜美");
    assert.ok(pack.identity.includes("航海士"), "IDENTITY content");
    assert.ok(pack.soul.includes("信任"), "SOUL content");
    assert.ok(
      pack.examples.includes("预算") || pack.examples.includes("报酬"),
      "EXAMPLES content",
    );
  });

  it("REMI_DEFAULT_PERSONA_PACK switches the default active pack", () => {
    process.env.REMI_DEFAULT_PERSONA_PACK = "nami";
    resetConfig();
    assert.equal(getActivePersonaPackId(), "nami");
    assert.equal(getActivePersonaPackId("conn-x"), "nami");
  });

  it("defaults to remi when REMI_DEFAULT_PERSONA_PACK unset", () => {
    delete process.env.REMI_DEFAULT_PERSONA_PACK;
    resetConfig();
    assert.equal(getActivePersonaPackId(), "remi");
  });
});
