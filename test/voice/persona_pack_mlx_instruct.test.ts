const assert = require("assert").strict;
const { resolvePackMlxInstruct } = require("../../voice/tts_mlx");
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

  it("nami pack → 利落音色 instruct（娜美语气配娜美声音）", () => {
    process.env.REMI_PERSONA_PACK_ENABLED = "1";
    resetConfig();
    clearPersonaPackCache();
    setActivePersonaPack("conn-mlx", "nami");
    const instruct = resolvePackMlxInstruct("conn-mlx");
    assert.ok(instruct && instruct.includes("利落"), "nami 应是利落音色");
  });
});
