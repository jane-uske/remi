import type {} from "mocha";

const assert = require("node:assert/strict");
const ReactLib = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { RemiChatComposer } = require("../src/components/RemiChatComposer");

describe("RemiChatComposer", () => {
  it("renders a single unified composer capsule without an external voice-style orb", () => {
    const markup = renderToStaticMarkup(
      ReactLib.createElement(RemiChatComposer, {
        onSend: () => {},
        onMicToggle: () => {},
        disabled: false,
        micDisabled: false,
        recording: false,
        placeholder: "说点什么…",
        setVoiceStyle: () => {},
        ttsEnabled: false,
        onTtsEnabledChange: () => {},
        voiceStyleOpen: false,
        onVoiceStyleToggle: () => {},
        onVoiceStyleClose: () => {},
      }),
    );

    assert.equal(
      (markup.match(/remi-input-composer/g) ?? []).length,
      1,
      "expected exactly one composer shell",
    );
    assert.ok(markup.includes("remi-composer-ground"));
    assert.ok(markup.includes('data-composer-action="voice-style"'));
    assert.ok(markup.includes("remi-input-composer--unified"));
    assert.ok(!markup.includes("remi-composer-disclaimer"));
    assert.ok(!markup.includes("remi-composer-addon"));
  });

  it("shows a muted label on the voice-style button when sound is off", () => {
    const markup = renderToStaticMarkup(
      ReactLib.createElement(RemiChatComposer, {
        onSend: () => {},
        onMicToggle: () => {},
        disabled: false,
        micDisabled: false,
        recording: false,
        placeholder: "说点什么…",
        setVoiceStyle: () => {},
        ttsEnabled: false,
        onTtsEnabledChange: () => {},
        voiceStyleOpen: false,
        onVoiceStyleToggle: () => {},
        onVoiceStyleClose: () => {},
      }),
    );

    assert.ok(markup.includes("静音"));
  });
});