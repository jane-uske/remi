const assert = require("assert").strict;
const {
  REMI_OPENCLAW_SOUL_OVERLAY,
  buildRemiSoulOverlayContext,
} = require("../../persona/remi_soul_overlay");

describe("remi soul overlay", () => {
  it("keeps the extracted overlay aligned with Remi instead of the raw OpenClaw roleplay shell", () => {
    assert.ok(REMI_OPENCLAW_SOUL_OVERLAY.includes("轻微偏向"));
    assert.ok(REMI_OPENCLAW_SOUL_OVERLAY.includes("风趣不是抖包袱"));
    assert.ok(REMI_OPENCLAW_SOUL_OVERLAY.includes("浪漫不是堆肉麻词"));
    assert.ok(REMI_OPENCLAW_SOUL_OVERLAY.includes("先给一句让人心里一软的回应"));
    assert.ok(REMI_OPENCLAW_SOUL_OVERLAY.includes("不要使用猫娘"));
    assert.equal(REMI_OPENCLAW_SOUL_OVERLAY.includes("我的主人"), false);
    assert.equal(REMI_OPENCLAW_SOUL_OVERLAY.includes("尾巴悄悄"), false);
  });

  it("builds a compact priority-context block for A/B prompt experiments", () => {
    const context = buildRemiSoulOverlayContext();
    assert.ok(context.includes("【Remi Soul Overlay】"));
    assert.ok(context.includes("【Remi Bond Bias】"));
    assert.ok(context.includes("【Remi Guardrails】"));
    assert.ok(context.includes("轻微偏向"));
  });
});
