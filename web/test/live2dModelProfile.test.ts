import type {} from "mocha";

const assert = require("node:assert/strict");
const {
  getLive2DModelProfile,
  resolveLive2DModelProfile,
} = require("../src/lib/rem3d/live2dModelProfile");

describe("live2dModelProfile", () => {
  it("resolves the Hiyori profile with explicit mouth and eye parameters", () => {
    const profile = getLive2DModelProfile("hiyori-pro");

    assert.ok(profile);
    assert.equal(profile.id, "hiyori-pro");
    assert.deepEqual(profile.parameterIds.mouthOpen, ["ParamMouthOpenY"]);
    assert.deepEqual(profile.parameterIds.mouthForm, ["ParamMouthForm"]);
    assert.deepEqual(profile.parameterIds.eyeBallX, ["ParamEyeBallX"]);
    assert.equal(profile.lip.envelopeGain > 1, true);
    assert.equal(profile.lip.attackMs < profile.lip.releaseMs, true);
  });

  it("falls back to the standard profile for unknown model ids", () => {
    const profile = resolveLive2DModelProfile("unknown-model");

    assert.equal(profile.id, "default-standard");
    assert.deepEqual(profile.parameterIds.mouthOpen, [
      "ParamMouthOpenY",
      "ParamMouthOpen",
    ]);
  });
});
