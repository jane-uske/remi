import type { ChatMessage } from "@/types/chat";

/** Drop duplicate message ids while preserving first-seen order. */
export function dedupeChatMessagesById(messages: ChatMessage[]): ChatMessage[] {
  const seen = new Set<string>();
  const result: ChatMessage[] = [];
  for (const message of messages) {
    if (!message.id || seen.has(message.id)) continue;
    seen.add(message.id);
    result.push(message);
  }
  return result;
}

/** Merge server/local history with live session messages without duplicate React keys. */
export function mergeChatMessageLists(
  history: ChatMessage[],
  live: ChatMessage[],
): ChatMessage[] {
  const dedupedHistory = dedupeChatMessagesById(history);
  const historyIds = new Set(dedupedHistory.map((message) => message.id));
  const liveOnly = dedupeChatMessagesById(live).filter(
    (message) => !historyIds.has(message.id),
  );
  return [...dedupedHistory, ...liveOnly];
}