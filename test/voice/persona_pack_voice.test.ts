const assert = require("assert").strict;
const { resolvePackVoiceOverride } = require("../../voice/tts");
const { resetConfig } = require("../../server/config");
const {
  setActivePersonaPack,
  clearActivePersonaPack,
} = require("../../brains/persona_pack_mode");
const { clearPersonaPackCache } = require("../../persona/pack/loader");

describe("per-pack TTS voice override (M3)", () => {
  const ORIG = process.env.REMI_PERSONA_PACK_ENABLED;

  afterEach(() => {
    if (ORIG === undefined) delete process.env.REMI_PERSONA_PACK_ENABLED;
    else process.env.REMI_PERSONA_PACK_ENABLED = ORIG;
    resetConfig();
    clearPersonaPackCache();
    clearActivePersonaPack("conn-voice");
  });

  it("flag off → null (TTS falls back to global REMI_TTS_VOICE)", () => {
    process.env.REMI_PERSONA_PACK_ENABLED = "0";
    resetConfig();
    assert.equal(resolvePackVoiceOverride("conn-voice"), null);
  });

  it("flag on → active pack's pinned voiceId", () => {
    process.env.REMI_PERSONA_PACK_ENABLED = "1";
    resetConfig();
    clearPersonaPackCache();
    // 默认 active pack = remi，其 persona.json 钉了 zh-CN-XiaoyiNeural
    assert.equal(
      resolvePackVoiceOverride("conn-voice"),
      "zh-CN-XiaoyiNeural",
    );
  });

  it("nami pack → distinct pinned Edge voice instead of Remi default", () => {
    process.env.REMI_PERSONA_PACK_ENABLED = "1";
    resetConfig();
    clearPersonaPackCache();
    setActivePersonaPack("conn-voice", "nami");
    assert.equal(resolvePackVoiceOverride("conn-voice"), "zh-CN-XiaoxiaoNeural");
  });

  it("no connId → null (no per-connection pack context)", () => {
    process.env.REMI_PERSONA_PACK_ENABLED = "1";
    resetConfig();
    assert.equal(resolvePackVoiceOverride(null), null);
    assert.equal(resolvePackVoiceOverride(undefined), null);
  });
});
