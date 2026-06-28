const assert = require("assert").strict;
const {
  resolvePackMlxInstruct,
  resolvePackMlxSpeaker,
} = require("../../voice/tts_mlx");
const { resetConfig } = require("../../server/config");
const {
  setActivePersonaPack,
  clearActivePersonaPack,
} = require("../../brains/persona_pack_mode");
const { clearPersonaPackCache } = require("../../persona/pack/loader");

describe("per-pack MLX instruct — 声音随人格走（语气与声音一致）", () => {
  const ORIG = process.env.REMI_PERSONA_PACK_ENABLED;

  afterEach(() => {
    if (ORIG === undefined) delete process.env.REMI_PERSONA_PACK_ENABLED;
    else process.env.REMI_PERSONA_PACK_ENABLED = ORIG;
    resetConfig();
    clearPersonaPackCache();
    clearActivePersonaPack("conn-mlx");
  });

  it("flag off → null（回退全局 REMI_TTS_MLX_INSTRUCT）", () => {
    process.env.REMI_PERSONA_PACK_ENABLED = "0";
    resetConfig();
    assert.equal(resolvePackMlxInstruct("conn-mlx"), null);
  });

  it("remi pack → 甜美音色 instruct", () => {
    process.env.REMI_PERSONA_PACK_ENABLED = "1";
    resetConfig();
    clearPersonaPackCache();
    setActivePersonaPack("conn-mlx", "remi");
    const instruct = resolvePackMlxInstruct("conn-mlx");
    assert.ok(instruct && instruct.includes("甜美"), "remi 应是甜美音色");
  });

  it("nami pack → 原创近似的利落航海士音色 profile", () => {
    process.env.REMI_PERSONA_PACK_ENABLED = "1";
    resetConfig();
    clearPersonaPackCache();
    setActivePersonaPack("conn-mlx", "nami");
    const instruct = resolvePackMlxInstruct("conn-mlx");
    assert.ok(instruct, "nami 应提供 pack-level MLX instruct");
    assert.match(instruct, /原创/, "nami 音色应明确是原创近似，不是原配克隆");
    assert.match(instruct, /清亮/, "nami 音色应清亮");
    assert.match(instruct, /利落/, "nami 音色应利落");
    assert.match(instruct, /语速偏快/, "nami 音色应语速偏快");
    assert.match(instruct, /不甜腻/, "nami 音色不应甜腻");
    assert.doesNotMatch(instruct, /声优|原配|克隆/, "nami 音色不应声明模仿官方声音");
  });

  it("nami pack → pins the MLX speaker instead of relying on env fallback", () => {
    process.env.REMI_PERSONA_PACK_ENABLED = "1";
    resetConfig();
    clearPersonaPackCache();
    setActivePersonaPack("conn-mlx", "nami");
    assert.equal(resolvePackMlxSpeaker("conn-mlx"), "serena");
  });
});
