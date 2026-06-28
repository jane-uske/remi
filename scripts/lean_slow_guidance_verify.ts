/**
 * REMI_LEAN_SLOW_GUIDANCE 验证：把慢脑从「指令生成器」瘦身为「事实提供者」。
 *
 * 两段：
 *  A. system-prompt 静态对比（硬断言，失败 exit 1，无需 LLM / 网络）——
 *     同一份慢脑 priorityContext，pack-on 下对比 lean-off vs lean-on：
 *       · lean-on 不含「怎么回复」指令块（语气合同 / 本轮回复合同 / 响应策略 /
 *         主动提起 / 共同经历提醒 / 关系表达风格）
 *       · lean-on 仍含【事实】（关系阶段 / 未完主线 topicPull / 对话摘要 / 记忆）
 *       · lean-on 的 systemChars 严格更小
 *  B. 真实 LLM 抽查（best-effort，连不上就跳过，不影响 A 的 gate）——
 *     拿 docs/evals/BAD_CASES.md 的 BC-002/BC-003 复现 turn，在 pack+lean 下跑
 *     LM Studio :1234，打印回复供人工确认「减 guidance 后质量不降」。
 *
 * 跑：NODE_OPTIONS="--no-experimental-strip-types" \
 *     node -r ts-node/register/transpile-only scripts/lean_slow_guidance_verify.ts
 */
import { loadEnvFile } from "../server/config/load_env";
loadEnvFile();

import { buildPrompt } from "../brain/prompt_builder";
import { createDefaultPersona } from "../persona";
import { completeWithOptions } from "../llm/qwen_client";
import { resetConfig, getConfig } from "../server/config";
import { clearPersonaPackCache } from "../persona/pack/loader";

// 一份「典型慢脑产物」：既含【事实】块，也含全套「怎么回复」指令块。
// 标题与 context_orchestrator / background_analysis_store 实际注入对齐。
const PRIORITY_CONTEXT = [
  "【关系阶段】熟悉期：已经聊了 23 轮，彼此比较放松", //          事实 → 保留
  "【语气合同】先稳稳共情，别急着追问或给建议；语气放软。", //    toneContract → 削
  "【本轮回复合同】先给一句明确判断，再补一句依据，最后才允许轻问。", // responseShape → 削
  "【响应策略】用户在问你的判断：第一句先表态，不要用「你是不是」开头。", // responsePolicy → 削
  "【当前未完主线】搬家：还在纠结要不要签城西那套公寓。", //       topicPull 事实 → 保留
  "【对话摘要】最近一直在聊换工作和搬家的双重压力。", //          事实 → 保留
  "【主动提起候选】仅当本轮相关或明显冷场时才轻接：上次你提过想养只布偶猫。", // proactive → 削
  "【共同经历提醒】若用户提到相关线索可自然承接：你们一起淋过的那场暴雨。", // proactive → 削
  "【关系表达风格】可以更口语、更短，少客套，多接情绪。", //       style 指令 → 削
].join("\n");

const MEMORY = [{ key: "用户的猫", value: "团子（橘猫，三岁，爱拆家）" }];

function systemPrompt(leanOn: boolean): string {
  process.env.REMI_PERSONA_PACK_ENABLED = "1"; // lean 设计上与 pack 配套
  process.env.REMI_DEFAULT_PERSONA_PACK = "remi"; // 固定 pack，与用户 .env 无关
  process.env.REMI_LEAN_SLOW_GUIDANCE = leanOn ? "1" : "0";
  resetConfig();
  clearPersonaPackCache();
  const messages = buildPrompt({
    memory: MEMORY,
    emotion: "neutral",
    history: [],
    userMessage: "你觉得我该签那套公寓吗",
    priorityContext: PRIORITY_CONTEXT,
    persona: createDefaultPersona(),
  });
  return messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n");
}

const INSTRUCTION_MARKERS = [
  "【语气合同】",
  "【本轮回复合同】",
  "【响应策略】",
  "【主动提起候选】",
  "【共同经历提醒】",
  "【关系表达风格】",
];

// 事实：标题可能被 compose 改写（如归到【优先参考】），用内容指纹更稳。
const FACT_MARKERS = [
  ["关系阶段", "熟悉期"],
  ["未完主线 topicPull", "城西那套公寓"],
  ["对话摘要", "换工作和搬家"],
  ["记忆背景", "团子"],
];

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`  ✗ FAIL: ${msg}`);
    process.exitCode = 1;
    throw new Error(msg);
  }
  console.log(`  ✓ ${msg}`);
}

function staticAssertions(): void {
  console.log(`\n${"=".repeat(64)}\nA. system-prompt 静态对比（pack-on）`);
  const off = systemPrompt(false);
  const on = systemPrompt(true);
  console.log(`  systemChars: lean-off=${off.length}  lean-on=${on.length}`);

  console.log(`\n  [sanity] lean-off 应含全部指令块（确认对比有意义）`);
  for (const marker of INSTRUCTION_MARKERS) {
    assert(off.includes(marker), `lean-off 含 ${marker}`);
  }

  console.log(`\n  [核心] lean-on 砍掉「怎么回复」指令块`);
  for (const marker of INSTRUCTION_MARKERS) {
    assert(!on.includes(marker), `lean-on 不含 ${marker}`);
  }

  console.log(`\n  [核心] lean-on 仍保留【事实】`);
  for (const [label, fingerprint] of FACT_MARKERS) {
    assert(on.includes(fingerprint), `lean-on 仍含${label}（"${fingerprint}"）`);
  }

  console.log(`\n  [体量] lean-on 严格更短`);
  assert(on.length < off.length, `systemChars ${on.length} < ${off.length}`);

  console.log(`\n  [人格] 两侧都仍由 pack 提供身份（减 guidance 不动人格）`);
  assert(off.includes("我叫 Remi") && on.includes("我叫 Remi"), "IDENTITY.md 在 lean 两侧都注入");
}

// ── B. 真实 LLM 抽查（best-effort）─────────────────────────────────────────
type Case = { label: string; history: { role: "user" | "assistant"; content: string }[]; user: string };
const LLM_CASES: Case[] = [
  { label: "BC-003 被问能干什么（期望：不报菜单）", history: [], user: "你叫什么，你能干什么" },
  { label: "BC-003 让你找话题（期望：真起一个话题，不踢回）", history: [], user: "你找个话题" },
  {
    label: "BC-002 裁员焦虑（期望：稳稳承接，不玩笑/不躺平/不岔题）",
    history: [],
    user: "我在杭州上班，感觉今年要裁员了，现在就业情况不好",
  },
];

async function llmSpotCheck(): Promise<void> {
  console.log(`\n${"=".repeat(64)}\nB. 真实 LLM 抽查（pack+lean，best-effort）`);
  process.env.REMI_PERSONA_PACK_ENABLED = "1";
  process.env.REMI_DEFAULT_PERSONA_PACK = "remi";
  process.env.REMI_LEAN_SLOW_GUIDANCE = "1";
  resetConfig();
  clearPersonaPackCache();
  const model = getConfig().REMI_LLM_MODEL;
  for (const c of LLM_CASES) {
    const messages = buildPrompt({
      memory: [],
      emotion: "neutral",
      history: c.history,
      userMessage: c.user,
      // 真实链路这里会有慢脑 priorityContext；抽查关注「减 guidance 后人格仍稳」，
      // 故走最薄注入（无 guidance），等价于 lean 的最强减法。
      persona: createDefaultPersona(),
    });
    try {
      const reply = await completeWithOptions(messages, { model, maxTokens: 200, temperature: 0.5 });
      console.log(`\n  [${c.label}]\n  USER: ${c.user}\n  REMI: ${reply.trim().replace(/\n/g, "\n        ")}`);
    } catch (err) {
      console.log(`\n  [跳过 LLM 抽查] 连不上 LLM（${(err as Error).message}）——A 段断言已是硬 gate。`);
      return;
    }
  }
}

async function main(): Promise<void> {
  staticAssertions();
  await llmSpotCheck();
  if (process.exitCode === 1) {
    console.error(`\n${"=".repeat(64)}\n✗ 验证失败`);
  } else {
    console.log(`\n${"=".repeat(64)}\n✓ A 段断言全过（lean 只削指令、保留事实、人格不变）`);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
