import type {} from "mocha";

const assert = require("node:assert/strict");
const {
  remiChatLayoutClasses,
} = require("../src/components/remiChatLayout");

describe("remiChatLayoutClasses", () => {
  it("keeps the header transparent instead of using an opaque hero bar", () => {
    assert.match(remiChatLayoutClasses.headerShell, /\bbg-transparent\b/);
    assert.match(remiChatLayoutClasses.headerShell, /\babsolute\b/);
    assert.match(remiChatLayoutClasses.headerShell, /\binset-x-0\b/);
    assert.match(remiChatLayoutClasses.headerShell, /\btop-0\b/);
    assert.match(remiChatLayoutClasses.headerShell, /calc\(env\(safe-area-inset-top\)\+1\.25rem\)/);
    assert.match(remiChatLayoutClasses.headerShell, /safe-area-inset-top/);
    assert.doesNotMatch(remiChatLayoutClasses.headerShell, /bg-\[#0a6078\]/);
  });

  it("uses a full-screen shell without page-level vertical scrolling", () => {
    assert.match(remiChatLayoutClasses.appShell, /\bh-dvh\b/);
    assert.match(remiChatLayoutClasses.appShell, /\boverflow-hidden\b/);
    assert.match(remiChatLayoutClasses.mainShell, /\bflex-1\b/);
    assert.match(remiChatLayoutClasses.mainShell, /\bmin-h-0\b/);
    assert.match(remiChatLayoutClasses.mainShell, /\boverflow-hidden\b/);
  });

  it("uses a stage-first shell instead of restoring a desktop split-pane layout", () => {
    assert.doesNotMatch(remiChatLayoutClasses.mainShell, /(?:^|\s)flex-row(?:\s|$)/);
    assert.doesNotMatch(remiChatLayoutClasses.mainShell, /\bmd:flex-row\b/);
    assert.match(remiChatLayoutClasses.stageShell, /\bflex-1\b/);
    assert.match(remiChatLayoutClasses.stageShell, /justify-center/);
    assert.match(remiChatLayoutClasses.chatAside, /\babsolute\b/);
    assert.match(remiChatLayoutClasses.chatAside, /\binset-x-0\b/);
    assert.match(remiChatLayoutClasses.chatAside, /\bbottom-0\b/);
    assert.match(remiChatLayoutClasses.chatAside, /\bmd:right-6\b/);
    assert.match(remiChatLayoutClasses.chatAside, /\bmd:left-auto\b/);
    assert.match(remiChatLayoutClasses.chatAside, /md:w-\[min\(26rem,32vw\)\]/);
  });

  it("keeps the chat card transparent while still bounding the desktop overlay height", () => {
    assert.match(remiChatLayoutClasses.chatCard, /\boverflow-hidden\b/);
    assert.match(remiChatLayoutClasses.chatCard, /\bbg-transparent\b/);
    assert.match(remiChatLayoutClasses.chatCard, /\bborder-transparent\b/);
    assert.match(remiChatLayoutClasses.chatCard, /\bshadow-none\b/);
    assert.match(remiChatLayoutClasses.chatCard, /md:max-h-\[56svh\]/);
    assert.doesNotMatch(remiChatLayoutClasses.chatCard, /\boverflow-visible\b/);
    assert.doesNotMatch(remiChatLayoutClasses.chatCard, /\bmd:h-full\b/);
    assert.doesNotMatch(remiChatLayoutClasses.chatCard, /\bmd:border\b/);
    assert.doesNotMatch(remiChatLayoutClasses.chatCard, /\bmd:bg-/);
    assert.doesNotMatch(remiChatLayoutClasses.chatCard, /\bmd:shadow-/);
    assert.doesNotMatch(remiChatLayoutClasses.chatCard, /\bmd:backdrop-blur-/);
  });

  it("docks the composer without sticky overlap so the last message stays readable", () => {
    assert.match(remiChatLayoutClasses.chatComposerDock, /\bshrink-0\b/);
    assert.match(remiChatLayoutClasses.chatComposerDock, /\bbg-transparent\b/);
    assert.match(remiChatLayoutClasses.chatComposerDock, /\bborder-transparent\b/);
    assert.match(remiChatLayoutClasses.chatComposerDock, /\bmd:px-3\b/);
    assert.doesNotMatch(remiChatLayoutClasses.chatComposerDock, /\bsticky\b/);
    assert.doesNotMatch(remiChatLayoutClasses.chatComposerDock, /\bbottom-0\b/);
    assert.doesNotMatch(remiChatLayoutClasses.chatComposerDock, /\bmd:border-t\b/);
    assert.doesNotMatch(remiChatLayoutClasses.chatComposerDock, /\bmd:bg-/);
    assert.doesNotMatch(remiChatLayoutClasses.chatComposerDock, /\bmd:backdrop-blur-/);
  });

  it("uses shrinkable chat wrappers so the scroller and composer cannot collapse into each other", () => {
    assert.match(remiChatLayoutClasses.chatWindowFrame, /\bflex\b/);
    assert.match(remiChatLayoutClasses.chatWindowFrame, /\bmin-h-0\b/);
    assert.match(remiChatLayoutClasses.chatWindowFrame, /\bflex-col\b/);
    assert.match(remiChatLayoutClasses.chatWindowFrame, /\bmd:flex-1\b/);
    assert.match(remiChatLayoutClasses.chatComposerFrame, /\bshrink-0\b/);
    assert.match(remiChatLayoutClasses.chatComposerFrame, /\bw-full\b/);
    assert.match(remiChatLayoutClasses.chatComposerFrame, /\bmd:max-w-none\b/);
  });
});
