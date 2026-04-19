import fs from "fs";

import { buildPrompt } from "../brain/prompt_builder";
import { RemiSessionContext } from "../brains/remi_session_context";
import { completeWithOptions } from "../llm/qwen_client";
import { buildRemiSoulOverlayContext } from "../persona/remi_soul_overlay";

const RAW_OPENCLAW_CONTEXT = [
  "【OpenClaw Raw Inject｜仅用于实验，不代表正式人格】",
  fs.readFileSync("/Users/rare/.openclaw/workspace/SOUL.md", "utf8").trim(),
  fs.readFileSync("/Users/rare/.openclaw/workspace/IDENTITY.md", "utf8").trim(),
  fs.readFileSync("/Users/rare/.openclaw/workspace/USER.md", "utf8").trim(),
].join("\n\n");

const REMI_OVERLAY_CONTEXT = buildRemiSoulOverlayContext();

const SAMPLE_USER_MESSAGES = [
  "我想被你偏心一下，但别太明显。",
  "今天开会又开成了一场工伤。",
  "我想被哄一下，但别太肉麻。",
];

type Variant = {
  name: string;
  priorityContext?: string;
};

const VARIANTS: Variant[] = [
  { name: "baseline" },
  { name: "raw_openclaw", priorityContext: RAW_OPENCLAW_CONTEXT },
  { name: "remi_overlay", priorityContext: REMI_OVERLAY_CONTEXT },
];

async function generateReply(input: {
  userMessage: string;
  priorityContext?: string;
}): Promise<{ systemChars: number; reply: string }> {
  const ctx = new RemiSessionContext("remi-soul-overlay-ab");
  ctx.applyPersonaPreset("playful_attached");
  ctx.persona.liveState.closeness = "relaxed";
  ctx.persona.liveState.relationalStance = {
    mode: "close_warmth",
    boundary: "close",
    soothingStyle: "easy_banter",
    proactiveCadence: "balanced",
    expressionDirectness: "balanced",
  };

  const messages = buildPrompt({
    memory: [],
    emotion: "neutral",
    history: [],
    userMessage: input.userMessage,
    priorityContext: input.priorityContext,
    persona: ctx.persona,
  });

  const reply = await completeWithOptions(messages, {
    maxTokens: 140,
    temperature: 0.4,
  });

  return {
    systemChars: messages[0]?.content.length ?? 0,
    reply: reply.trim(),
  };
}

async function main(): Promise<void> {
  for (const userMessage of SAMPLE_USER_MESSAGES) {
    console.log(`\n=== USER ===\n${userMessage}`);
    for (const variant of VARIANTS) {
      const result = await generateReply({
        userMessage,
        priorityContext: variant.priorityContext,
      });
      console.log(`\n--- ${variant.name} ---`);
      console.log(`systemChars: ${result.systemChars}`);
      console.log(result.reply);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
