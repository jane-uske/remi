import type {} from "mocha";

const assert = require("node:assert/strict");
const {
  buildRemiViewportContent,
  buildSafariFocusZoomPatchScript,
  defaultRemiViewportContent,
  safariFocusViewportContent,
  shouldApplySafariFocusZoomPatch,
} = require("../src/lib/mobile/safariFocusZoom");

describe("safari focus zoom patch", () => {
  it("targets iPhone Safari but excludes iOS Chrome", () => {
    assert.equal(
      shouldApplySafariFocusZoomPatch({
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1",
      }),
      true,
    );
    assert.equal(
      shouldApplySafariFocusZoomPatch({
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/135.0.0.0 Mobile/15E148 Safari/604.1",
      }),
      false,
    );
  });

  it("builds deterministic viewport content for default and patched states", () => {
    assert.equal(defaultRemiViewportContent, buildRemiViewportContent(5));
    assert.equal(safariFocusViewportContent, buildRemiViewportContent(1));
    assert.match(safariFocusViewportContent, /maximum-scale=1/);
    assert.match(defaultRemiViewportContent, /maximum-scale=5/);
    assert.match(defaultRemiViewportContent, /viewport-fit=cover/);
  });

  it("ships an inline patch script that rewrites the viewport meta on iPhone Safari", () => {
    const script = buildSafariFocusZoomPatchScript();
    assert.match(script, /navigator\.userAgent/);
    assert.match(script, /meta\[name="viewport"\]/);
    assert.match(script, /maximum-scale=1/);
    assert.match(script, /dataset\.iosSafari/);
    assert.match(script, /CriOS/);
  });
});
