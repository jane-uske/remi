import { composeScenePromptWithLlm } from "../../agents/image_prompt_agent";
import { getFastBrainModel } from "../../brains/fast_brain_model";
import { createLogger } from "../../infra/logger";
import { hasLlmConfig } from "../../llm/qwen_client";
import { getConfig } from "../../server/config";
import type { ImageIntent } from "./image_intent";

const logger = createLogger("image_prompt");

const PASTED_PROMPT_RE =
  /(?:用(?:这个|此)?提示词生图|按(?:这个|此)?提示词生图)[:：,，、\s]+([\s\S]+)/u;

export interface EnrichImageIntentInput {
  intent: ImageIntent;
  userMessage: string;
  recentHistory?: Array<{ role: string; content: string }>;
  lastImage?: { subject: string; prompt: string; characterStyle?: string };
  connId: string;
  signal?: AbortSignal;
}

function promptLlmEnabled(): boolean {
  const cfg = getConfig();
  if (!cfg.REMI_IMAGE_PROMPT_LLM_ENABLED) return false;
  return hasLlmConfig(getFastBrainModel());
}

function extractPastedPrompt(userMessage: string): string | null {
  const match = PASTED_PROMPT_RE.exec(userMessage.trim());
  if (!match) return null;
  const pasted = match[1]?.trim();
  return pasted || null;
}

/**
 * Step 1.5 — dedicated Qwen scene-prompt writing.
 * Intent agent only classifies; this step authors the ComfyUI scene text.
 */
export async function enrichImageIntentWithScenePrompt(
  input: EnrichImageIntentInput,
): Promise<ImageIntent> {
  const { intent } = input;
  if (
    intent.kind !== "generate" &&
    intent.kind !== "refine" &&
    intent.kind !== "restyle"
  ) {
    return intent;
  }

  if (intent.kind === "refine" && !input.lastImage) {
    return { kind: "generate", subject: intent.delta };
  }

  const pasted = extractPastedPrompt(input.userMessage);
  if (pasted) {
    return { ...intent, comfyPrompt: pasted };
  }

  if (!promptLlmEnabled()) {
    return intent;
  }

  try {
    const scene = await composeScenePromptWithLlm({
      userMessage: input.userMessage,
      intent,
      recentHistory: input.recentHistory,
      lastImage: input.lastImage,
      connId: input.connId,
      signal: input.signal,
    });
    if (!scene) return intent;
    return { ...intent, comfyPrompt: scene };
  } catch (err) {
    logger.warn("image prompt LLM failed, using intent fallback", {
      connId: input.connId,
      action: intent.kind,
      error: err instanceof Error ? err.message : String(err),
    });
    return intent;
  }
}