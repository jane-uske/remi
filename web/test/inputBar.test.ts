import type {} from "mocha";

const assert = require("node:assert/strict");
const ReactLib = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { InputBar } = require("../src/components/InputBar");

describe("InputBar", () => {
  it("renders a single-row composer shell instead of stacking the textarea above a second control row", () => {
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
    assert.ok(markup.includes("aria-label=\"消息输入\""));
    assert.ok(markup.includes("data-input-layout=\"single-row\""));
    assert.ok(markup.includes("items-center"));
    assert.ok(markup.includes("h-10"));
    assert.ok(markup.includes("min-w-[4.5rem]"));
    assert.ok(markup.includes("leading-10"));
    assert.ok(markup.includes("text-[16px]"));
    assert.ok(markup.includes("md:text-[15px]"));
    assert.ok(!markup.includes('rows="3"'));
    assert.ok(!markup.includes("Shift + Enter 换行"));
  });
});
