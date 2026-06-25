import type {} from "mocha";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

describe("Safari near-fullscreen css", () => {
  it("drops the old 100lvh near-fullscreen workaround in favor of true document scroll", () => {
    const cssPath = path.resolve(__dirname, "..", "src", "app", "globals.css");
    const source = fs.readFileSync(cssPath, "utf8");

    // The chat now scrolls at the document level; the height-locking hack must be gone.
    assert.doesNotMatch(source, /100lvh/);
    assert.doesNotMatch(source, /height:\s*auto\s*!important/);
    // iOS still gets momentum scroll + no rubber-band chaining on the body.
    assert.match(
      source,
      /html\[data-ios-safari="true"\] body \{[^}]*overscroll-behavior-y:\s*none/,
    );
  });

  it("fixes the mobile composer to the visual viewport above the keyboard", () => {
    const cssPath = path.resolve(__dirname, "..", "src", "app", "globals.css");
    const source = fs.readFileSync(cssPath, "utf8");

    assert.match(
      source,
      /@media \(max-width: 767px\) \{[\s\S]*\.remi-mobile-composer \{[\s\S]*position: fixed/,
    );
    assert.match(
      source,
      /translateY\(calc\(-1 \* var\(--remi-vv-bottom-offset, 0px\)\)\)/,
    );
  });

  it("keeps the root html background aligned with the remi stage so exposed Safari chrome does not fall back to pure black", () => {
    const cssPath = path.resolve(__dirname, "..", "src", "app", "globals.css");
    const source = fs.readFileSync(cssPath, "utf8");

    assert.match(source, /html\s*\{[\s\S]*background-color:\s*var\(--remi-body-bg\)/);
    assert.match(
      source,
      /html\s*\{[\s\S]*background-image:\s*var\(--remi-page-overlay\),\s*var\(--remi-page-bg-image\)/,
    );
  });

  it("fades the chat scroller at the vertical edges instead of hard-clipping messages", () => {
    const cssPath = path.resolve(__dirname, "..", "src", "app", "globals.css");
    const source = fs.readFileSync(cssPath, "utf8");

    assert.match(source, /\.remi-chat-scroll-fade\s*\{/);
    assert.match(source, /-webkit-mask-image:\s*linear-gradient\(/);
    assert.match(source, /mask-image:\s*linear-gradient\(/);
    assert.match(source, /--remi-chat-fade-top:/);
    assert.match(source, /--remi-chat-fade-bottom:/);
  });

  it("does not add a shell skin pseudo layer behind the chat container", () => {
    const cssPath = path.resolve(__dirname, "..", "src", "app", "globals.css");
    const source = fs.readFileSync(cssPath, "utf8");

    assert.doesNotMatch(source, /\.remi-chat-shell::before/);
    assert.doesNotMatch(source, /\.remi-chat-shell::after/);
  });
});
