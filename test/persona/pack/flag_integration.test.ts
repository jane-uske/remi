const assert = require("assert").strict;
const { buildPrompt } = require("../../../brain/prompt_builder");
const { createDefaultPersona } = require("../../../persona");
const { resetConfig } = require("../../../server/config");
const { clearPersonaPackCache } = require("../../../persona/pack/loader");
const { registerPlugin } = require("../../../plugin/registry");

let leanPluginRegistered = false;

function systemContent(options = {}) {
  const msgs = buildPrompt({
    memory: [],
    emotion: "neutral",
    history: [],
    userMessage: "你好",
    persona: createDefaultPersona(),
    ...options,
  });
  const sys = msgs.find((m) => m.role === "system");
  return sys ? sys.content : "";
}

function registerLeanTestPlugin() {
  if (leanPluginRegistered) return;
  registerPlugin({
    id: "test-lean-persona-pack",
    name: "test lean persona pack",
    version: "0.0.0",
    enabled: () => process.env.TEST_LEAN_PERSONA_PACK_PLUGIN === "1",
    promptInjection: {
      wantsLeanPersona: () => true,
      getPromptSections: () => ["【测试插件】lean prompt section"],
    },
  });
  leanPluginRegistered = true;
}

describe("persona pack flag integration", () => {
  const ORIG = process.env.REMI_PERSONA_PACK_ENABLED;
  const ORIG_DEFAULT_PACK = process.env.REMI_DEFAULT_PERSONA_PACK;
  const ORIG_TEST_PLUGIN = process.env.TEST_LEAN_PERSONA_PACK_PLUGIN;

  afterEach(() => {
    if (ORIG === undefined) delete process.env.REMI_PERSONA_PACK_ENABLED;
    else process.env.REMI_PERSONA_PACK_ENABLED = ORIG;
    if (ORIG_DEFAULT_PACK === undefined) delete process.env.REMI_DEFAULT_PERSONA_PACK;
    else process.env.REMI_DEFAULT_PERSONA_PACK = ORIG_DEFAULT_PACK;
    if (ORIG_TEST_PLUGIN === undefined) delete process.env.TEST_LEAN_PERSONA_PACK_PLUGIN;
    else process.env.TEST_LEAN_PERSONA_PACK_PLUGIN = ORIG_TEST_PLUGIN;
    resetConfig();
    clearPersonaPackCache();
  });

  it("flag off: keeps the legacy built-in persona path (規則引擎 in, no L0)", () => {
    process.env.REMI_PERSONA_PACK_ENABLED = "0";
    resetConfig();
    clearPersonaPackCache();
    const sys = systemContent();
    assert.ok(
      !sys.includes("平台系统约束"),
      "L0 must be absent when the flag is off (legacy path unchanged)",
    );
    // 旧路径确实经过 persona/index.ts 的 build*Guidance 规则引擎
    assert.ok(
      sys.includes("【RemiCore合同】") || sys.includes("【灵魂底色】"),
      "legacy path still runs the build*Guidance rule engine",
    );
  });

  it("flag on: composes from the remi pack (L0 + IDENTITY + few-shot)", () => {
    process.env.REMI_PERSONA_PACK_ENABLED = "1";
    resetConfig();
    clearPersonaPackCache();
    const sys = systemContent();
    assert.ok(sys.includes("平台系统约束"), "L0 system layer present");
    assert.ok(sys.includes("我叫 Remi"), "IDENTITY.md injected");
    assert.ok(sys.includes("霓虹"), "EXAMPLES.md few-shot injected");
  });

  it("flag on: 减法生效——绕过 build*Guidance 规则引擎（M5 证据）", () => {
    process.env.REMI_PERSONA_PACK_ENABLED = "1";
    resetConfig();
    clearPersonaPackCache();
    const sys = systemContent();
    // flag-on 走分层 compose，不再经过 persona/index.ts 的规则引擎标记
    assert.ok(!sys.includes("【RemiCore合同】"), "no legacy RemiCore contract");
    assert.ok(!sys.includes("【灵魂底色】"), "no legacy soul guidance");
    assert.ok(!sys.includes("【风格执行】"), "no legacy style-execution guidance");
    assert.ok(!sys.includes("【关系姿态】"), "no legacy relational-stance guidance");
  });

  it("flag on: plugin lean persona keeps the active pack identity instead of falling back to Remi", () => {
    registerLeanTestPlugin();
    process.env.REMI_PERSONA_PACK_ENABLED = "1";
    process.env.REMI_DEFAULT_PERSONA_PACK = "nami";
    process.env.TEST_LEAN_PERSONA_PACK_PLUGIN = "1";
    resetConfig();
    clearPersonaPackCache();

    const sys = systemContent({ connId: "conn-lean-nami" });

    assert.ok(sys.includes("娜美"), "active pack identity survives lean persona");
    assert.ok(sys.includes("航海士"), "active pack background survives lean persona");
    assert.ok(!sys.includes("你是 Remi，一个 20 出头的女生"), "generic Remi lean fallback absent");
    assert.ok(sys.includes("【测试插件】lean prompt section"), "plugin section still injected");
  });
});
