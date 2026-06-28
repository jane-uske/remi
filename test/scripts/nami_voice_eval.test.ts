const assert = require("assert").strict;
const { resetConfig } = require("../../server/config");
const { clearActivePersonaPack } = require("../../brains/persona_pack_mode");
const { clearPersonaPackCache } = require("../../persona/pack/loader");

describe("nami voice eval script", () => {
  const ORIG = process.env.REMI_PERSONA_PACK_ENABLED;

  afterEach(() => {
    if (ORIG === undefined) delete process.env.REMI_PERSONA_PACK_ENABLED;
    else process.env.REMI_PERSONA_PACK_ENABLED = ORIG;
    clearActivePersonaPack("test-nami-voice-eval");
    clearPersonaPackCache();
    resetConfig();
  });

  it("exposes fixed Nami lines and pack voice metadata without calling TTS", () => {
    process.env.REMI_PERSONA_PACK_ENABLED = "1";
    resetConfig();
    clearPersonaPackCache();

    const {
      NAMI_VOICE_EVAL_OUTPUT_DIR,
      buildNamiVoiceEvalCases,
      resolveNamiVoiceEvalMetadata,
    } = require("../../scripts/nami_voice_eval.ts");

    const cases = buildNamiVoiceEvalCases();
    assert.equal(cases.length, 3);
    assert.deepEqual(
      cases.map((c) => c.id),
      ["weather-read", "money-spark", "soft-guard"],
    );
    assert.ok(cases.every((c) => c.text.includes("娜美") === false));

    const metadata = resolveNamiVoiceEvalMetadata("test-nami-voice-eval");
    assert.equal(metadata.packId, "nami");
    assert.equal(metadata.speaker, "serena");
    assert.match(metadata.instruct, /原创/);
    assert.match(metadata.instruct, /清亮/);
    assert.match(metadata.instruct, /利落/);
    assert.match(metadata.instruct, /不甜腻/);
    assert.ok(NAMI_VOICE_EVAL_OUTPUT_DIR.endsWith("artifacts/nami_voice_eval"));
  });

  it("prepares CLI runtime by loading the local env file", () => {
    delete process.env.REMI_PERSONA_PACK_ENABLED;
    resetConfig();

    const { prepareNamiVoiceEvalRuntime } = require("../../scripts/nami_voice_eval.ts");
    prepareNamiVoiceEvalRuntime();

    assert.equal(process.env.REMI_PERSONA_PACK_ENABLED, "1");
  });
});
