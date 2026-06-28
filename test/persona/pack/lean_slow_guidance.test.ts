const assert = require("assert").strict;
const { buildPrompt } = require("../../../brain/prompt_builder");
const { createDefaultPersona } = require("../../../persona");
const { resetConfig } = require("../../../server/config");
const { clearPersonaPackCache } = require("../../../persona/pack/loader");

// 一份典型慢脑产物：既含【事实】块，也含全套「怎么回复」指令块（标题与
// background_analysis_store / context_orchestrator 实际注入对齐）。
const PRIORITY_CONTEXT = [
  "【关系阶段】熟悉期：已经聊了 23 轮，彼此比较放松",
  "【语气合同】先稳稳共情，别急着追问或给建议；语气放软。",
  "【本轮回复合同】先给一句明确判断，再补一句依据，最后才允许轻问。",
  "【响应策略】用户在问你的判断：第一句先表态，不要用「你是不是」开头。",
  "【当前未完主线】搬家：还在纠结要不要签城西那套公寓。",
  "【对话摘要】最近一直在聊换工作和搬家的双重压力。",
  "【主动提起候选】仅当本轮相关或明显冷场时才轻接：上次你提过想养只布偶猫。",
  "【共同经历提醒】若用户提到相关线索可自然承接：你们一起淋过的那场暴雨。",
  "【关系表达风格】可以更口语、更短，少客套，多接情绪。",
].join("\n");

const MEMORY = [{ key: "用户的猫", value: "团子（橘猫，三岁）" }];

const INSTRUCTION_MARKERS = [
  "【语气合同】",
  "【本轮回复合同】",
  "【响应策略】",
  "【主动提起候选】",
  "【共同经历提醒】",
  "【关系表达风格】",
];

// 事实指纹（标题可能被 compose 归到【优先参考】，用内容更稳）。
const FACT_FINGERPRINTS = ["熟悉期", "城西那套公寓", "换工作和搬家", "团子"];

function systemContent(options = {}) {
  resetConfig();
  clearPersonaPackCache();
  const msgs = buildPrompt({
    memory: MEMORY,
    emotion: "neutral",
    history: [],
    userMessage: "你觉得我该签那套公寓吗",
    priorityContext: PRIORITY_CONTEXT,
    persona: createDefaultPersona(),
    ...options,
  });
  const sys = msgs.find((m) => m.role === "system");
  return sys ? sys.content : "";
}

describe("REMI_LEAN_SLOW_GUIDANCE", () => {
  const KEYS = [
    "REMI_LEAN_SLOW_GUIDANCE",
    "REMI_PERSONA_PACK_ENABLED",
    "REMI_DEFAULT_PERSONA_PACK",
  ];
  const ORIG = {};
  beforeEach(() => {
    for (const k of KEYS) ORIG[k] = process.env[k];
    // 这些断言关注 guidance 注入，与具体 pack 无关，固定 remi 保证确定性。
    process.env.REMI_PERSONA_PACK_ENABLED = "1";
    process.env.REMI_DEFAULT_PERSONA_PACK = "remi";
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (ORIG[k] === undefined) delete process.env[k];
      else process.env[k] = ORIG[k];
    }
    resetConfig();
    clearPersonaPackCache();
  });

  it("flag off（默认）：保留全部慢脑「怎么回复」指令块（零回归基线）", () => {
    process.env.REMI_LEAN_SLOW_GUIDANCE = "0";
    const sys = systemContent();
    for (const marker of INSTRUCTION_MARKERS) {
      assert.ok(sys.includes(marker), `lean-off 应保留 ${marker}`);
    }
    for (const fp of FACT_FINGERPRINTS) {
      assert.ok(sys.includes(fp), `lean-off 应含事实 "${fp}"`);
    }
  });

  it("flag off 未设置时与显式 '0' 逐字节一致（默认即关）", () => {
    delete process.env.REMI_LEAN_SLOW_GUIDANCE;
    const unset = systemContent();
    process.env.REMI_LEAN_SLOW_GUIDANCE = "0";
    const explicitOff = systemContent();
    assert.equal(unset, explicitOff, "未设置 == '0'，默认关");
  });

  it("flag on：砍掉「怎么回复」指令块（toneContract/responseShape/responsePolicy/proactive/style）", () => {
    process.env.REMI_LEAN_SLOW_GUIDANCE = "1";
    const sys = systemContent();
    for (const marker of INSTRUCTION_MARKERS) {
      assert.ok(!sys.includes(marker), `lean-on 不应含 ${marker}`);
    }
  });

  it("flag on：仍保留【事实】（关系阶段 / 未完主线 topicPull / 对话摘要 / 记忆）", () => {
    process.env.REMI_LEAN_SLOW_GUIDANCE = "1";
    const sys = systemContent();
    for (const fp of FACT_FINGERPRINTS) {
      assert.ok(sys.includes(fp), `lean-on 仍应含事实 "${fp}"`);
    }
  });

  it("flag on：人格不变——pack 身份仍注入（减 guidance 不动人格）", () => {
    process.env.REMI_LEAN_SLOW_GUIDANCE = "1";
    const on = systemContent();
    process.env.REMI_LEAN_SLOW_GUIDANCE = "0";
    const off = systemContent();
    assert.ok(on.includes("我叫 Remi"), "lean-on 仍有 IDENTITY.md");
    assert.ok(off.includes("我叫 Remi"), "lean-off 仍有 IDENTITY.md");
    assert.ok(on.length < off.length, "lean-on 体量更小（确实削了 guidance）");
  });

  it("legacy 无-pack 路径：lean 同样从【优先参考】剥掉指令块，但不删静态人格", () => {
    process.env.REMI_PERSONA_PACK_ENABLED = "0"; // 走 buildPersonaPrompt 回退
    process.env.REMI_LEAN_SLOW_GUIDANCE = "1";
    const sys = systemContent();
    // 慢脑指令块（落在【优先参考】里的）被剥掉
    assert.ok(!sys.includes("【响应策略】"), "legacy lean 也剥【响应策略】");
    assert.ok(!sys.includes("【主动提起候选】"), "legacy lean 也剥【主动提起候选】");
    // 事实仍在
    assert.ok(sys.includes("城西那套公寓"), "legacy lean 仍含 topicPull 事实");
  });
});
