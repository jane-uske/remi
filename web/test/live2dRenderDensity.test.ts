import type {} from "mocha";

const assert = require("node:assert/strict");
const {
  resolveLive2DRendererResolution,
} = require("../src/lib/rem3d/live2dRenderDensity");

describe("resolveLive2DRendererResolution", () => {
  it("uses 1x as the safe floor when DPR is missing or invalid", () => {
    assert.equal(resolveLive2DRendererResolution(undefined), 1);
    assert.equal(resolveLive2DRendererResolution(0), 1);
    assert.equal(resolveLive2DRendererResolution(Number.NaN), 1);
  });

  it("keeps ordinary retina displays sharp without running uncapped", () => {
    assert.equal(resolveLive2DRendererResolution(1), 1);
    assert.equal(resolveLive2DRendererResolution(1.5), 1.5);
    assert.equal(resolveLive2DRendererResolution(2), 2);
    assert.equal(resolveLive2DRendererResolution(3), 2);
  });
});
