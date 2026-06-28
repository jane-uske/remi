/**
 * 快速验证：default pack = nami + flag-on 时，Remi 是否真的以娜美人格回复。
 * 跑：NODE_OPTIONS="--no-experimental-strip-types" \
 *     node -r ts-node/register/transpile-only scripts/nami_verify.ts
 */
import { loadEnvFile } from "../server/config/load_env";
loadEnvFile();
process.env.REMI_PERSONA_PACK_ENABLED = "1";
process.env.REMI_DEFAULT_PERSONA_PACK = "nami";

import { buildPrompt } from "../brain/prompt_builder";
import { createDefaultPersona } from "../persona";
import { completeWithOptions } from "../llm/qwen_client";
import { resetConfig, getConfig } from "../server/config";
import { clearPersonaPackCache } from "../persona/pack/loader";

const CASES = [
  "你好啊，你叫什么",
  "你能干什么",
  "我今天搞砸了，觉得自己好没用",
  "我捡到一笔钱，不知道怎么花",
];

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
    const reply = await completeWithOptions(messages, {
      model: getConfig().REMI_LLM_MODEL,
      maxTokens: 180,
      temperature: 0.6,
    });
    console.log(`\nUSER: ${user}\n娜美: ${reply.trim().replace(/\n/g, "\n      ")}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
