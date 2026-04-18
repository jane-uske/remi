import type {} from "mocha";

const assert = require("node:assert/strict");
const ReactLib = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { VoiceIndicator } = require("../src/components/VoiceIndicator");

describe("VoiceIndicator", () => {
  it("renders the supplied selector model instead of inferring from a raw boolean", () => {
    const markup = renderToStaticMarkup(
      ReactLib.createElement(VoiceIndicator, {
        model: {
          active: true,
          label: "speaking",
        },
      }),
    );

    assert.ok(markup.includes('data-active="true"'));
    assert.ok(markup.includes("speaking"));
  });
});
