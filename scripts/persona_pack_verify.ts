/**
 * M1 验证：对 NDADVM7Q 的真实失败 case，对比 flag-off（旧 buildPersonaPrompt）
 * 与 flag-on（Persona Pack 分层 compose）的 system prompt 体量与真实 LLM 回复。
 *
 * 跑：NODE_OPTIONS="--no-experimental-strip-types" \
 *     node -r ts-node/register/transpile-only scripts/persona_pack_verify.ts
 */
import { loadEnvFile } from "../server/config/load_env";
loadEnvFile();

import { buildPrompt } from "../brain/prompt_builder";
import { createDefaultPersona } from "../persona";
import { completeWithOptions } from "../llm/qwen_client";
import { resetConfig, getConfig } from "../server/config";
import { clearPersonaPackCache } from "../persona/pack/loader";

type Turn = { role: "user" | "assistant"; content: string };
type Case = { label: string; history: Turn[]; user: string };

// NDADVM7Q 真实失败序列里最能区分人格的四轮
const CASES: Case[] = [
  {
    label: "被问能干什么（旧：报菜单）",
    history: [],
    user: "你叫什么，你能干什么",
  },
  {
    label: "嫌没用（旧：那要个能干活的不行吗）",
    history: [
      { role: "user", content: "你叫什么，你能干什么" },
      { role: "assistant", content: "叫 Remi。就是陪着你的人。" },
    ],
    user: "太low了，你啥也没用啊，我不需要陪我的人啊",
  },
  {
    label: "让你找话题（旧：把球踢回去）",
    history: [
      { role: "user", content: "我都不知道你干啥的" },
      {
        role: "assistant",
        content: "我能查资料、写文案、理思路，你想先试哪个？",
      },
    ],
    user: "你找个话题",
  },
  {
    label: "我让你找方向不是我（旧：又踢回/复读）",
    history: [
      { role: "user", content: "你找个话题" },
      {
        role: "assistant",
        content: "行，那你挑个方向？查点东西、写段词，还是理理最近烦心的事？",
      },
    ],
    user: "我让你找方向，不是我",
  },
];

async function run(
  packOn: boolean,
  c: Case,
): Promise<{ systemChars: number; reply: string }> {
  process.env.REMI_PERSONA_PACK_ENABLED = packOn ? "1" : "0";
  resetConfig();
  clearPersonaPackCache();
  const persona = createDefaultPersona();
  const messages = buildPrompt({
    memory: [],
    emotion: "neutral",
    history: c.history,
    userMessage: c.user,
    persona,
  });
  const systemChars = messages
    .filter((m) => m.role === "system")
    .reduce((sum, m) => sum + m.content.length, 0);
  const reply = await completeWithOptions(messages, {
    model: getConfig().REMI_LLM_MODEL,
    maxTokens: 200,
    temperature: 0.5,
  });
  return { systemChars, reply: reply.trim() };
}

function indent(text: string): string {
  return text.replace(/\n/g, "\n    ");
}

async function main(): Promise<void> {
  for (const c of CASES) {
    console.log(`\n${"=".repeat(64)}`);
    console.log(`[${c.label}]`);
    console.log(`USER: ${c.user}`);
    const off = await run(false, c);
    const on = await run(true, c);
    console.log(`\n  --- flag OFF（旧路径, systemChars=${off.systemChars}）---`);
    console.log(`    ${indent(off.reply)}`);
    console.log(`\n  --- flag ON （pack 路径, systemChars=${on.systemChars}）---`);
    console.log(`    ${indent(on.reply)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
