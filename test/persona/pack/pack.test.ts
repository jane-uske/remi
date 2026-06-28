const assert = require("assert").strict;
const {
  loadPersonaPack,
  clearPersonaPackCache,
} = require("../../../persona/pack/loader");
const { composePersonaPrompt } = require("../../../persona/pack/compose");
const {
  PERSONA_SYSTEM_LAYER,
  PERSONA_SYSTEM_LAYER_REINFORCE,
} = require("../../../persona/pack/system_layer");

describe("persona pack loader", () => {
  beforeEach(() => clearPersonaPackCache());

  it("loads the default remi pack from personas/remi", () => {
    const pack = loadPersonaPack("remi", { noCache: true });
    assert.ok(pack, "remi pack should load");
    assert.equal(pack.manifest.id, "remi");
    assert.equal(pack.manifest.name, "Remi");
    assert.equal(pack.manifest.memoryScope, "per_pack");
    assert.ok(
      pack.manifest.voice && pack.manifest.voice.voiceId,
      "voice voiceId present",
    );
    assert.ok(pack.identity.includes("我叫 Remi"), "IDENTITY.md content");
    assert.ok(pack.soul.includes("温柔"), "SOUL.md content");
    assert.ok(pack.examples.includes("霓虹"), "EXAMPLES.md few-shot content");
  });

  it("returns null (fallback) for a missing pack", () => {
    const pack = loadPersonaPack("does-not-exist-xyz", { noCache: true });
    assert.equal(pack, null);
  });

  it("clips each section to the budget", () => {
    const pack = loadPersonaPack("remi", {
      noCache: true,
      budget: { identity: 12, soul: 12, examples: 12 },
    });
    assert.ok(pack);
    assert.ok(pack.identity.length <= 12, "identity within budget");
    assert.ok(pack.soul.length <= 12, "soul within budget");
    assert.ok(pack.examples.length <= 12, "examples within budget");
  });
});

describe("composePersonaPrompt", () => {
  const fakePack = {
    manifest: { id: "x", name: "X", memoryScope: "per_pack" },
    identity: "IDENTITY_MARKER 身份",
    soul: "SOUL_MARKER 内核",
    examples: "EXAMPLES_MARKER 示范",
  };

  it("bookends custom persona text with the L0 system layer", () => {
    const out = composePersonaPrompt(fakePack, {});
    assert.ok(out.startsWith(PERSONA_SYSTEM_LAYER), "L0 must lead");
    assert.ok(
      out.endsWith(PERSONA_SYSTEM_LAYER_REINFORCE),
      "L0' must close",
    );
    const idIdx = out.indexOf("IDENTITY_MARKER");
    const soulIdx = out.indexOf("SOUL_MARKER");
    const exIdx = out.indexOf("EXAMPLES_MARKER");
    const l0rIdx = out.indexOf(PERSONA_SYSTEM_LAYER_REINFORCE);
    assert.ok(
      idIdx < soulIdx && soulIdx < exIdx && exIdx < l0rIdx,
      "layer order: identity < soul < examples < L0'",
    );
  });

  it("injects dynamic options between the layers, still bookended by L0", () => {
    const out = composePersonaPrompt(fakePack, {
      memoryStr: "MEM_MARKER",
      toneContract: "TONE_MARKER",
    });
    assert.ok(out.includes("MEM_MARKER"), "memory injected");
    assert.ok(out.includes("TONE_MARKER"), "tone contract injected");
    assert.ok(
      out.indexOf(PERSONA_SYSTEM_LAYER) < out.indexOf("MEM_MARKER"),
      "L0 before dynamic blocks",
    );
    assert.ok(
      out.indexOf("MEM_MARKER") < out.indexOf(PERSONA_SYSTEM_LAYER_REINFORCE),
      "dynamic blocks before L0'",
    );
  });
});
