import type {} from "mocha";

const assert = require("node:assert/strict");
const ReactLib = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { VoiceStylePicker } = require("../src/components/VoiceStylePicker");

describe("VoiceStylePicker", () => {
  it("renders sound on/off controls in the picker panel", () => {
    const markup = renderToStaticMarkup(
      ReactLib.createElement(VoiceStylePicker, {
        open: true,
        onClose: () => {},
        setVoiceStyle: () => {},
        ttsEnabled: false,
        onTtsEnabledChange: () => {},
      }),
    );

    assert.ok(markup.includes("声音"));
    assert.ok(markup.includes("打开声音"));
    assert.ok(markup.includes("关闭声音"));
    assert.ok(markup.includes("remi-voice-style-option--active"));
  });
});