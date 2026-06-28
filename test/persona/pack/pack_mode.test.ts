const assert = require("assert").strict;
const {
  getActivePersonaPackId,
  setActivePersonaPack,
  clearActivePersonaPack,
} = require("../../../brains/persona_pack_mode");
const { listPersonaPacks } = require("../../../persona/pack/loader");

describe("persona pack mode (per-connection switch)", () => {
  it("defaults to remi when no pack is selected", () => {
    assert.equal(getActivePersonaPackId("conn-none"), "remi");
    assert.equal(getActivePersonaPackId(), "remi");
    assert.equal(getActivePersonaPackId(null), "remi");
  });

  it("switches to an existing pack, then clears back to default", () => {
    assert.equal(setActivePersonaPack("conn-1", "remi"), true);
    assert.equal(getActivePersonaPackId("conn-1"), "remi");
    clearActivePersonaPack("conn-1");
    assert.equal(getActivePersonaPackId("conn-1"), "remi");
  });

  it("rejects switching to a non-existent pack and keeps the default", () => {
    assert.equal(setActivePersonaPack("conn-2", "ghost-pack-xyz"), false);
    assert.equal(getActivePersonaPackId("conn-2"), "remi");
  });
});

describe("listPersonaPacks", () => {
  it("discovers the default remi pack on disk", () => {
    const packs = listPersonaPacks();
    const remi = packs.find((p) => p.id === "remi");
    assert.ok(remi, "remi pack should be discovered");
    assert.equal(remi.name, "Remi");
    assert.equal(remi.displayName, "Remi");
  });
});
