import type { PromptMessage } from "../brain/prompt_builder";
import { getConfig } from "../server/config";

/** Rough token estimate for Chinese-heavy chat (chars → tokens). */
export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length * 1.35);
}

/**
 * Trim oldest messages first until estimated token budget is met.
 * Keeps at least the last `minTailMessages` (default 4 = 2 turns).
 */
export function trimHistoryToTokenBudget(
  history: PromptMessage[],
  maxTokens: number = getConfig().MAX_HISTORY_TOKENS,
  minTailMessages = 4,
): PromptMessage[] {
  if (history.length === 0) return history;

  const total = (msgs: PromptMessage[]) =>
    msgs.reduce((acc, m) => acc + estimateTextTokens(m.content), 0);

  let h = [...history];
  while (h.length > minTailMessages && total(h) > maxTokens) {
    h.shift();
  }

  // If still over (very long single messages), drop from front until under or only tail left
  while (h.length > minTailMessages && total(h) > maxTokens) {
    h.shift();
  }

  if (total(h) <= maxTokens) return h;

  // Last resort: keep only the most recent user+assistant pair
  if (h.length >= 2) {
    return h.slice(-2);
  }
  return h.slice(-1);
}
