import type {} from "mocha";

const assert = require("node:assert/strict");
const ReactLib = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { MessageBubble } = require("../src/components/MessageBubble");

describe("MessageBubble", () => {
  it("renders a visible speaker label for assistant messages", () => {
    const markup = renderToStaticMarkup(
      ReactLib.createElement(MessageBubble, {
        role: "rem",
        children: "我会一直在这里。",
      }),
    );

    assert.ok(markup.includes(">Remi<"));
    assert.ok(markup.includes("我会一直在这里。"));
  });

  it("renders a visible speaker label for user messages", () => {
    const markup = renderToStaticMarkup(
      ReactLib.createElement(MessageBubble, {
        role: "user",
        children: "今天很难受。",
      }),
    );

    assert.ok(markup.includes(">你<"));
    assert.ok(markup.includes("今天很难受。"));
  });
});
