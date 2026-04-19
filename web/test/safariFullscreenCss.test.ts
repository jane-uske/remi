import type {} from "mocha";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

describe("Safari near-fullscreen css", () => {
  it("adds iPhone Safari specific near-fullscreen viewport rules", () => {
    const cssPath = path.resolve(__dirname, "..", "src", "app", "globals.css");
    const source = fs.readFileSync(cssPath, "utf8");

    assert.match(source, /\[data-ios-safari="true"\] \.remi-app-shell/);
    assert.match(source, /100lvh/);
    assert.match(source, /height:\s*auto\s*!important/);
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
