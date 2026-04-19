import type {} from "mocha";

const assert = require("node:assert/strict");
const {
  buildCharacterFallbackChain,
  getDefaultCharacterSpec,
} = require("../src/lib/avatar/characterRegistry");
const {
  resolveCharacterStageEntry,
} = require("../src/lib/avatar/characterStageState");

describe("resolveCharacterStageEntry", () => {
  it("starts from the Live2D primary backend", () => {
    const spec = getDefaultCharacterSpec();
    const chain = buildCharacterFallbackChain(spec);
    const resolved = resolveCharacterStageEntry(chain, []);

    assert.equal(resolved.kind, "runtime");
    assert.equal(resolved.engine, "live2d");
    assert.equal(resolved.modelUrl, spec.modelUrl);
  });

  it("falls back to VRM when the Live2D backend has failed", () => {
    const spec = getDefaultCharacterSpec();
    const chain = buildCharacterFallbackChain(spec);
    const resolved = resolveCharacterStageEntry(chain, ["live2d"]);

    assert.equal(resolved.kind, "runtime");
    assert.equal(resolved.engine, "vrm");
    assert.equal(resolved.modelUrl, spec.fallbackModelUrl);
  });

  it("uses the portrait fallback when all runtime backends have failed", () => {
    const spec = getDefaultCharacterSpec();
    const chain = buildCharacterFallbackChain(spec);
    const resolved = resolveCharacterStageEntry(chain, ["live2d", "vrm"]);

    assert.deepEqual(resolved, { kind: "portrait" });
  });
});
