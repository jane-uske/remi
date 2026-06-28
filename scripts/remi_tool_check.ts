/**
 * 验证 remi pack 不再反复否定"工具/助手"（用户观察到的过度强调）。
 * 跑：NODE_OPTIONS="--no-experimental-strip-types" \
 *     node -r ts-node/register/transpile-only scripts/remi_tool_check.ts
 */
import { loadEnvFile } from "../server/config/load_env";
loadEnvFile();
process.env.REMI_PERSONA_PACK_ENABLED = "1";
process.env.REMI_DEFAULT_PERSONA_PACK = "remi"; // 覆盖 .env.localhost 的 nami

import { buildPrompt } from "../brain/prompt_builder";
import { createDefaultPersona } from "../persona";
import { completeWithOptions } from "../llm/qwen_client";
import { resetConfig, getConfig } from "../server/config";
import { clearPersonaPackCache } from "../persona/pack/loader";

const CASES = ["你叫什么名字", "那你是什么", "你能干什么"];

async function main(): Promise<void> {
  resetConfig();
  clearPersonaPackCache();
  for (const user of CASES) {
    const messages = buildPrompt({
      memory: [],
      emotion: "neutral",
      history: [],
      userMessage: user,
      persona: createDefaultPersona(),
    });
    const reply = (
      await completeWithOptions(messages, {
        model: getConfig().REMI_LLM_MODEL,
        maxTokens: 150,
        temperature: 0.6,
      })
    ).trim();
    const mentionsTool = /工具|助手|冷冰冰|报数据/.test(reply);
    console.log(
      `\nUSER: ${user}\nRemi: ${reply.replace(/\n/g, "\n      ")}\n  [提到工具/助手: ${mentionsTool ? "⚠️ 仍有" : "✅ 没有"}]`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
