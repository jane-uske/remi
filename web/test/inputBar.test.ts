import type {} from "mocha";

const assert = require("node:assert/strict");
const ReactLib = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { InputBar } = require("../src/components/InputBar");

describe("InputBar", () => {
  it("renders a single-row legacy composer shell by default", () => {
    const markup = renderToStaticMarkup(
      ReactLib.createElement(InputBar, {
        onSend: () => {},
        onMicToggle: () => {},
        disabled: false,
        micDisabled: false,
        recording: false,
        placeholder: "说点什么…",
      }),
    );

    assert.ok(markup.includes('rows="1"'));
    assert.ok(markup.includes('aria-label="消息输入"'));
    assert.ok(markup.includes('data-input-layout="single-row"'));
    assert.ok(markup.includes("items-center"));
    assert.ok(markup.includes("h-10"));
    assert.ok(markup.includes("min-w-[4.5rem]"));
    assert.ok(markup.includes("leading-10"));
    assert.ok(markup.includes("text-[16px]"));
    assert.ok(markup.includes("md:text-[15px]"));
    assert.ok(!markup.includes('rows="3"'));
    assert.ok(!markup.includes("Shift + Enter 换行"));
  });

  it("renders a unified composer with left attach and right actions", () => {
    const markup = renderToStaticMarkup(
      ReactLib.createElement(InputBar, {
        variant: "unified",
        voiceStyleControl: { open: false, onToggle: () => {}, activeLabel: "默认" },
        onSend: () => {},
        onMicToggle: () => {},
        disabled: false,
        micDisabled: false,
        recording: false,
        placeholder: "说点什么…",
      }),
    );

    assert.ok(markup.includes("remi-input-composer--unified"));
    // Two-row layout: textarea on its own row, controls on a separate row below.
    assert.ok(markup.includes("remi-composer-text-row"));
    assert.ok(markup.includes("remi-composer-action-row"));
    assert.ok(markup.includes('data-composer-action="attach"'));
    assert.ok(markup.includes('data-composer-action="voice-style"'));
    assert.ok(markup.includes("remi-composer-menu-btn"));
    assert.ok(markup.includes(">默认<"));
    assert.ok(markup.includes('aria-label="发送"'));
    assert.ok(!markup.includes("--remi-input-track-bg"));
    assert.ok(!markup.includes(">send<"));
    // textarea sits above the action row (text-first, controls below)
    assert.ok(markup.indexOf("remi-composer-text-row") < markup.indexOf("remi-composer-action-row"));
    assert.ok(markup.indexOf('aria-label="消息输入"') < markup.indexOf('data-composer-action="attach"'));
    assert.ok(markup.indexOf('data-composer-action="attach"') < markup.indexOf('data-composer-action="voice-style"'));
  });
});