import type {} from "mocha";

const assert = require("node:assert/strict");
const {
  buildCharacterFallbackChain,
  getDefaultCharacterSpec,
} = require("../src/lib/avatar/characterRegistry");

describe("characterRegistry", () => {
  it("prefers a Live2D default character with VRM fallback", () => {
    const spec = getDefaultCharacterSpec();

    assert.equal(spec.id, "remi-default");
    assert.equal(spec.engine, "live2d");
    assert.equal(spec.modelId, "hiyori-pro");
    assert.equal(spec.modelSource, "public_asset");
    assert.equal(spec.fallbackEngine, "vrm");
    assert.equal(spec.supportsVoiceMotion, true);
    assert.equal(spec.supportsLookAt, true);
    assert.match(spec.modelUrl, /\.model3\.json(\?|$)/);
    assert.match(spec.modelUrl, /\/live2d\/hiyori-pro\//);
    assert.match(spec.fallbackModelUrl, /\.vrm(\?|$)/);
  });

  it("builds a deterministic fallback chain from character spec", () => {
    const spec = getDefaultCharacterSpec();
    const chain = buildCharacterFallbackChain(spec);

    assert.deepEqual(
      chain.map((entry: { engine: string }) => entry.engine),
      ["live2d", "vrm"],
    );
    assert.equal(chain[0].modelUrl, spec.modelUrl);
    assert.equal(chain[0].modelId, spec.modelId);
    assert.equal(chain[1].modelUrl, spec.fallbackModelUrl);
  });
});
