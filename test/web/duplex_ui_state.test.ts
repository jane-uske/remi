const assert = require("assert").strict;
const { resolveDuplexInputPlaceholder } = require("../../web/src/lib/duplex_ui_state");

describe("duplex ui state", () => {
  it("shows listening while the user is actively speaking", () => {
    assert.equal(
      resolveDuplexInputPlaceholder({
        recording: true,
        userSpeaking: true,
        awaitingSpeechCommit: false,
      }),
      "正在听…",
    );
  });

  it("shows processing while duplex is waiting for speech commit", () => {
    assert.equal(
      resolveDuplexInputPlaceholder({
        recording: true,
        userSpeaking: false,
        awaitingSpeechCommit: true,
      }),
      "识别中…",
    );
  });

  it("falls back to duplex idle placeholder when no speech is pending", () => {
    assert.equal(
      resolveDuplexInputPlaceholder({
        recording: true,
        userSpeaking: false,
        awaitingSpeechCommit: false,
      }),
      "全双工语音 — 随时说话…",
    );
  });
});
