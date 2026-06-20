const ASSISTANT_FALLBACK_REPLIES = new Set([
  "啊…出了点问题，等我缓缓再试试…",
  "我这边的大脑连接凭据不对，暂时没法回复。把 LLM 的 key 配好后再试一次。",
  "嗯…让我想想…",
  "啊…刚刚脑子卡了一下，你再说一次好不好？",
]);

const UNCONFIGURED_BRAIN_REPLY =
  /^嗯…我听到了「[\s\S]+」，不过我现在还没连上大脑…等一下就好。$/;

export function isFallbackAssistantReply(text: string | null | undefined): boolean {
  const normalized = text?.trim();
  if (!normalized) return false;
  return (
    ASSISTANT_FALLBACK_REPLIES.has(normalized) ||
    UNCONFIGURED_BRAIN_REPLY.test(normalized)
  );
}
