#!/usr/bin/env node
/**
 * List LM Studio models and suggest REMI_LLM_MODEL for HauhauCS uncensored stack.
 * Usage: node scripts/pick_lmstudio_model.mjs
 */
import process from "node:process";

const baseUrl = (process.env.REMI_LLM_BASE_URL || "http://127.0.0.1:1234/v1").replace(
  /\/$/,
  "",
);
const apiKey = process.env.REMI_LLM_API_KEY || "lm-studio";

const prefs = [
  /qwen3\.6-35b-a3b-uncensored-hauhaucs/i,
  /qwen3\.5-35b-a3b-uncensored-hauhaucs/i,
  /qwen3\.5-9b-uncensored-hauhaucs/i,
  /qwen2\.5-7b-instruct-uncensored/i,
  /uncensored|hauhaucs|abliterated/i,
];

async function main() {
  const res = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    console.error(`[pick_lmstudio_model] LM Studio unreachable: ${res.status}`);
    process.exit(1);
  }
  const data = await res.json();
  const ids = (data.data ?? []).map((m) => m.id).filter(Boolean);
  console.log("[pick_lmstudio_model] loaded models:");
  for (const id of ids) console.log(`  - ${id}`);

  let pick = null;
  for (const re of prefs) {
    pick = ids.find((id) => re.test(id));
    if (pick) break;
  }

  if (!pick) {
    console.error("[pick_lmstudio_model] no preferred chat model found");
    process.exit(2);
  }

  console.log(`\n[pick_lmstudio_model] suggested REMI_LLM_MODEL=${pick}`);
}

main().catch((err) => {
  console.error("[pick_lmstudio_model]", err);
  process.exit(1);
});