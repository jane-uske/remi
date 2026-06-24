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

describe("global document-scroll baseline", () => {
  const css = readSource("src", "app", "globals.css");

  it("drives html/body background from the route-bg token with a theme fallback", () => {
    const matches = css.match(
      /background-color:\s*var\(--remi-route-bg,\s*var\(--remi-body-bg\)\)/g,
    );
    // both html and body
    assert.ok(matches && matches.length >= 2, "expected html + body to use --remi-route-bg fallback");
  });

  it("keeps body as the main scroller (overflow-y auto, momentum scroll)", () => {
    // [^}]* stays inside the body rule so the assertion can't drift into
    // another block.
    assert.match(css, /body\s*\{[^}]*overflow-y:\s*auto/);
    assert.match(css, /body\s*\{[^}]*-webkit-overflow-scrolling:\s*touch/);
  });

  it("never locks html/body to a fixed-height non-scrolling shell", () => {
    // Isolate the top-level html{} and body{} rules (no nested braces inside),
    // then assert neither locks scrolling.
    const htmlBlock = css.match(/\nhtml\s*\{[^}]*\}/)?.[0] ?? "";
    const bodyBlock = css.match(/\nbody\s*\{[^}]*\}/)?.[0] ?? "";
    assert.ok(htmlBlock && bodyBlock, "expected top-level html{} and body{} rules");
    assert.doesNotMatch(htmlBlock, /overflow:\s*hidden/);
    assert.doesNotMatch(htmlBlock, /height:\s*100vh/);
    assert.doesNotMatch(bodyBlock, /overflow:\s*hidden/);
    assert.doesNotMatch(bodyBlock, /height:\s*100vh/);
  });
});
