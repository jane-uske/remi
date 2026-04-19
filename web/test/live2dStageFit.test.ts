import type {} from "mocha";

const assert = require("node:assert/strict");
const {
  computeLive2DStageFit,
} = require("../src/lib/rem3d/live2dStageFit");

describe("computeLive2DStageFit", () => {
  it("scales narrow portrait stages more aggressively so the avatar does not collapse visually", () => {
    const fit = computeLive2DStageFit({
      containerWidth: 560,
      containerHeight: 1500,
      boundsWidth: 680,
      boundsHeight: 1180,
    });

    assert.ok(fit.scale > 1.2);
    assert.equal(fit.x, 280);
    assert.ok(fit.y > 1500);
  });

  it("keeps wide stages restrained instead of overfilling the viewport", () => {
    const fit = computeLive2DStageFit({
      containerWidth: 1280,
      containerHeight: 980,
      boundsWidth: 680,
      boundsHeight: 1180,
    });

    assert.ok(fit.scale < 1.1);
    assert.equal(fit.x, 640);
    assert.equal(fit.y, 960.4);
  });
});
