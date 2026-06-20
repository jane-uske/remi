import { getConfig } from "../server/config";

/**
 * Fast-brain model: real-time chat, image-intent gate, and other low-latency paths.
 * Always uses REMI_LLM_MODEL so fast/slow paths stay on the same checkpoint.
 */
export function getFastBrainModel(): string | undefined {
  const cfg = getConfig();
  return cfg.REMI_LLM_MODEL?.trim() || undefined;
}