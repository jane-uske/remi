import type {} from "mocha";

const assert = require("node:assert/strict");
const { isNearBottom } = require("../src/lib/scroll/scrollTarget");

describe("scrollTarget.isNearBottom", () => {
  it("is true exactly at the bottom", () => {
    assert.equal(isNearBottom(1000, 600, 400), true); // distance 0
  });

  it("uses a 72px default stick threshold", () => {
    assert.equal(isNearBottom(1000, 529, 400), true); // distance 71 < 72
    assert.equal(isNearBottom(1000, 528, 400), false); // distance 72 not < 72
    assert.equal(isNearBottom(1000, 540, 400), true); // distance 60 -> near
  });

  it("honors a custom threshold (e.g. 48px load-more zone)", () => {
    assert.equal(isNearBottom(1000, 553, 400, 48), true); // distance 47 < 48
    assert.equal(isNearBottom(1000, 552, 400, 48), false); // distance 48 not < 48
  });

  it("is false when far from the bottom", () => {
    assert.equal(isNearBottom(5000, 0, 800), false);
  });
});
