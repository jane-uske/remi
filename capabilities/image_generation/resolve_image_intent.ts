import { inferImageIntentFromMessage } from "../../agents/image_intent_agent";
import { getFastBrainModel } from "../../brains/fast_brain_model";
import { createLogger } from "../../infra/logger";
import { hasLlmConfig } from "../../llm/qwen_client";
import { getConfig } from "../../server/config";
import {
  classifyImageIntentRegex,
  mightBeImageFollowUp,
  type ImageIntent,
} from "./image_intent";

const logger = createLogger("image_intent");

export interface ResolveImageIntentInput {
  userMessage: string;
  recentHistory?: Array<{ role: string; content: string }>;
  hasPreviousImage: boolean;
  lastImage?: { subject: string; prompt: string; characterStyle?: string };
  signal?: AbortSignal;
}

function llmImageIntentEnabled(): boolean {
  const cfg = getConfig();
  if (!cfg.REMI_IMAGE_INTENT_LLM_ENABLED) return false;
  return hasLlmConfig(getFastBrainModel());
}

/**
 * Step 1 — intent recognition.
 * Hybrid gate: regex prefilter → fast-brain JSON confirm → regex fallback.
 * Returns { kind: "none" } immediately when the message is not a candidate.
 * Prompt assembly (step 2) is assembleImagePrompt(); ComfyUI call is step 3.
 */
export async function resolveImageIntent(
  input: ResolveImageIntentInput,
): Promise<ImageIntent> {
  if (!mightBeImageFollowUp(input.userMessage, input.hasPreviousImage)) {
    return { kind: "none" };
  }

  if (llmImageIntentEnabled()) {
    try {
      const llmIntent = await inferImageIntentFromMessage({
        userMessage: input.userMessage,
        recentHistory: input.recentHistory,
        hasPreviousImage: input.hasPreviousImage,
        lastImage: input.lastImage,
        signal: input.signal,
      });
      // Trust the LLM's judgment — it understands negation, questions, and
      // meta-discussion that the regex classifier cannot distinguish.
      // Regex fallback only runs when the LLM call *throws* (network / timeout).
      return llmIntent;
    } catch (err) {
      logger.warn("image intent LLM failed, falling back to regex", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return classifyImageIntentRegex(input.userMessage);
}