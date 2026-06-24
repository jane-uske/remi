import type {} from "mocha";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.resolve(__dirname, "..", ...segments), "utf8");
}

describe("useRouteChromeColor", () => {
  const hook = readSource("src", "lib", "mobile", "useRouteChromeColor.ts");

  it("drives the Safari chrome via theme-color and the --remi-body-bg sentinel token", () => {
    assert.match(hook, /export function useRouteChromeColor\(color: string\)/);
    // The fixed .remi-safari-tint-* sentinels + html background read
    // --remi-body-bg, so the hook must override it for the edges to follow.
    assert.match(hook, /setProperty\("--remi-body-bg", color\)/);
    assert.match(hook, /setProperty\("--remi-route-bg", color\)/);
    assert.match(hook, /meta\[name="theme-color"\]/);
    assert.match(hook, /removeAttribute\("media"\)/);
  });

  it("restores the previous chrome on unmount so other routes keep theme-driven chrome", () => {
    // The effect must return a cleanup that restores prior token + meta values.
    assert.match(hook, /return \(\) => \{/);
    assert.match(hook, /removeProperty\("--remi-body-bg"\)/);
    assert.match(hook, /setAttribute\("content", prev\.content\)/);
  });
});

describe("RemiLanding portal chrome", () => {
  const landing = readSource("src", "components", "RemiLanding.tsx");

  it("pins the portal Safari chrome to its dark hero color", () => {
    assert.match(landing, /import \{ useRouteChromeColor \}/);
    assert.match(landing, /useRouteChromeColor\(PORTAL_CHROME_COLOR\)/);
    assert.match(landing, /PORTAL_CHROME_COLOR = "#0a0612"/);
  });
});
