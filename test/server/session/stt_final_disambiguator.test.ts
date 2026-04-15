const assert = require("assert").strict;
const path = require("path");

const modulePath = path.resolve(__dirname, "../../../voice/stt_final_disambiguator.ts");

function loadModule() {
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

describe("stt final disambiguator", () => {
  const previousEnv = {
    REMI_STT_FINAL_DISAMBIG_ENABLED: process.env.REMI_STT_FINAL_DISAMBIG_ENABLED,
    REMI_STT_FINAL_DISAMBIG_DICT_PATH: process.env.REMI_STT_FINAL_DISAMBIG_DICT_PATH,
    REMI_STT_FINAL_DISAMBIG_LOG_DIFF: process.env.REMI_STT_FINAL_DISAMBIG_LOG_DIFF,
  };

  afterEach(() => {
    process.env.REMI_STT_FINAL_DISAMBIG_ENABLED = previousEnv.REMI_STT_FINAL_DISAMBIG_ENABLED;
    process.env.REMI_STT_FINAL_DISAMBIG_DICT_PATH = previousEnv.REMI_STT_FINAL_DISAMBIG_DICT_PATH;
    process.env.REMI_STT_FINAL_DISAMBIG_LOG_DIFF = previousEnv.REMI_STT_FINAL_DISAMBIG_LOG_DIFF;
    if (process.env.REMI_STT_FINAL_DISAMBIG_ENABLED === undefined) {
      delete process.env.REMI_STT_FINAL_DISAMBIG_ENABLED;
    }
    if (process.env.REMI_STT_FINAL_DISAMBIG_DICT_PATH === undefined) {
      delete process.env.REMI_STT_FINAL_DISAMBIG_DICT_PATH;
    }
    if (process.env.REMI_STT_FINAL_DISAMBIG_LOG_DIFF === undefined) {
      delete process.env.REMI_STT_FINAL_DISAMBIG_LOG_DIFF;
    }
    loadModule().__resetSttFinalDisambiguatorForTests();
  });

  it("passes through unchanged when disabled", () => {
    process.env.REMI_STT_FINAL_DISAMBIG_ENABLED = "0";
    delete process.env.REMI_STT_FINAL_DISAMBIG_DICT_PATH;
    const { disambiguateSttFinal } = loadModule();

    const result = disambiguateSttFinal("雷米你好");

    assert.deepEqual(result, {
      text: "雷米你好",
      changed: false,
      matchedRuleIds: [],
    });
  });

  it("prefers the longest alias match", () => {
    process.env.REMI_STT_FINAL_DISAMBIG_ENABLED = "1";
    process.env.REMI_STT_FINAL_DISAMBIG_DICT_PATH = path.resolve(
      __dirname,
      "../../fixtures/stt_final_disamb_valid.json",
    );
    const { disambiguateSttFinal } = loadModule();

    const result = disambiguateSttFinal("我在做雷米爱项目");

    assert.equal(result.text, "我在做Remi AI项目");
    assert.equal(result.changed, true);
    assert.deepEqual(result.matchedRuleIds, ["remi_project"]);
  });

  it("rejects dictionaries containing single-char aliases", () => {
    process.env.REMI_STT_FINAL_DISAMBIG_ENABLED = "1";
    process.env.REMI_STT_FINAL_DISAMBIG_DICT_PATH = path.resolve(
      __dirname,
      "../../fixtures/stt_final_disamb_single_char_alias.json",
    );
    const { disambiguateSttFinal } = loadModule();

    const result = disambiguateSttFinal("雷你好");

    assert.deepEqual(result, {
      text: "雷你好",
      changed: false,
      matchedRuleIds: [],
    });
  });

  it("does not replace aliases when canonical already exists", () => {
    process.env.REMI_STT_FINAL_DISAMBIG_ENABLED = "1";
    process.env.REMI_STT_FINAL_DISAMBIG_DICT_PATH = path.resolve(
      __dirname,
      "../../fixtures/stt_final_disamb_valid.json",
    );
    const { disambiguateSttFinal } = loadModule();

    const result = disambiguateSttFinal("我在找Remi，不是雷米");

    assert.deepEqual(result, {
      text: "我在找Remi，不是雷米",
      changed: false,
      matchedRuleIds: [],
    });
  });

  it("falls back safely when the dictionary file is missing", () => {
    process.env.REMI_STT_FINAL_DISAMBIG_ENABLED = "1";
    process.env.REMI_STT_FINAL_DISAMBIG_DICT_PATH = path.resolve(
      __dirname,
      "../../fixtures/does_not_exist.json",
    );
    const { disambiguateSttFinal } = loadModule();

    const result = disambiguateSttFinal("雷米你好");

    assert.deepEqual(result, {
      text: "雷米你好",
      changed: false,
      matchedRuleIds: [],
    });
  });

  it("falls back safely when the dictionary JSON is invalid", () => {
    process.env.REMI_STT_FINAL_DISAMBIG_ENABLED = "1";
    process.env.REMI_STT_FINAL_DISAMBIG_DICT_PATH = path.resolve(
      __dirname,
      "../../fixtures/stt_final_disamb_invalid.json",
    );
    const { disambiguateSttFinal } = loadModule();

    const result = disambiguateSttFinal("雷米你好");

    assert.deepEqual(result, {
      text: "雷米你好",
      changed: false,
      matchedRuleIds: [],
    });
  });
});
