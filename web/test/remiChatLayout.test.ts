import type {} from "mocha";

const assert = require("node:assert/strict");
const {
  remiChatLayoutClasses,
  remiChatLayoutForNsfw,
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

  it("scrolls the document on mobile but locks a full-screen shell on desktop", () => {
    assert.match(remiChatLayoutClasses.appShell, /\bmin-h-dvh\b/);
    assert.match(remiChatLayoutClasses.appShell, /\boverflow-visible\b/);
    assert.match(remiChatLayoutClasses.appShell, /\bmd:h-dvh\b/);
    assert.match(remiChatLayoutClasses.appShell, /\bmd:overflow-hidden\b/);
    // mainShell flows on mobile (so messages grow the document), becomes the
    // flex stage container only on desktop.
    assert.match(remiChatLayoutClasses.mainShell, /\boverflow-visible\b/);
    assert.match(remiChatLayoutClasses.mainShell, /\bmd:flex-1\b/);
    assert.match(remiChatLayoutClasses.mainShell, /\bmd:overflow-hidden\b/);
  });

  it("keeps a mobile control rail and immersive chat fade for stage-first mobile layout", () => {
    assert.match(remiChatLayoutClasses.mobileControlRail, /\bmd:hidden\b/);
    assert.match(remiChatLayoutClasses.mobileControlRail, /\babsolute\b/);
    assert.match(remiChatLayoutClasses.mobileControlRail, /\bright-2\b/);
    assert.match(remiChatLayoutClasses.chatAside, /\bremi-chat-mobile-immersive\b/);
    assert.match(remiChatLayoutClasses.chatAside, /pt-\[max\(38svh,/);
  });

  it("makes the avatar a fixed mobile backdrop and flows chat in the document, with a desktop side panel", () => {
    assert.doesNotMatch(remiChatLayoutClasses.mainShell, /(?:^|\s)flex-row(?:\s|$)/);
    assert.doesNotMatch(remiChatLayoutClasses.mainShell, /\bmd:flex-row\b/);
    // avatar stage: fixed full-bleed on mobile, relative flex stage on desktop
    assert.match(remiChatLayoutClasses.stageShell, /\bfixed\b/);
    assert.match(remiChatLayoutClasses.stageShell, /\binset-0\b/);
    assert.match(remiChatLayoutClasses.stageShell, /\bmd:relative\b/);
    assert.match(remiChatLayoutClasses.stageShell, /justify-center/);
    // chat aside flows on mobile (document scroll), docks as a right panel on desktop
    assert.match(remiChatLayoutClasses.chatAside, /\brelative\b/);
    assert.match(remiChatLayoutClasses.chatAside, /\bmd:absolute\b/);
    assert.match(remiChatLayoutClasses.chatAside, /\bmd:bottom-0\b/);
    assert.match(remiChatLayoutClasses.chatAside, /\bmd:right-6\b/);
    assert.match(remiChatLayoutClasses.chatAside, /\bmd:left-auto\b/);
    assert.match(remiChatLayoutClasses.chatAside, /md:w-\[min\(26rem,32vw\)\]/);
  });

  it("keeps the chat card transparent, flowing on mobile but bounding the desktop overlay height", () => {
    // mobile: no inner clip (messages flow into the document); desktop: bounded + clipped
    assert.match(remiChatLayoutClasses.chatCard, /\boverflow-visible\b/);
    assert.match(remiChatLayoutClasses.chatCard, /\bmax-h-none\b/);
    assert.match(remiChatLayoutClasses.chatCard, /\bmd:overflow-hidden\b/);
    assert.match(remiChatLayoutClasses.chatCard, /\bbg-transparent\b/);
    assert.match(remiChatLayoutClasses.chatCard, /\bborder-transparent\b/);
    assert.match(remiChatLayoutClasses.chatCard, /\bshadow-none\b/);
    assert.match(remiChatLayoutClasses.chatCard, /md:max-h-\[56svh\]/);
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

describe("remiChatLayoutForNsfw", () => {
  it("hides the stage and expands chat to full height in adult mode", () => {
    const layout = remiChatLayoutForNsfw(true);

    assert.match(layout.stageShell, /\bhidden\b/);
    assert.match(layout.mainShell, /\bflex-col\b/);
    assert.doesNotMatch(layout.chatAside, /\bbottom-0\b/);
    assert.match(layout.chatAside, /\bflex-1\b/);
    assert.match(layout.chatCard, /\bmax-h-none\b/);
    assert.doesNotMatch(layout.chatCard, /md:max-h-\[56svh\]/);
    assert.match(layout.chatWindowFrame, /max-w-\[min\(100%,42rem\)\]/);
  });

  it("returns the default layout when adult mode is off", () => {
    const layout = remiChatLayoutForNsfw(false);
    assert.equal(layout, remiChatLayoutClasses);
  });
});
