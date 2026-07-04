/**
 * Some chat backends emit inline emotion markup (e.g. `<emotion>happy</emotion>`)
 * inside the assistant's text so the avatar can react. That markup is metadata,
 * not content, and must never reach the chat bubble. This strips it for display
 * while leaving the raw stream buffer untouched for any logic that needs it.
 */

// Complete tags: <emotion>...</emotion>, <emotion/>, <emotion type="x">, </emotion>
const COMPLETE_EMOTION_TAG = /<\/?emotion\b[^>]*>/gi;
// A tag that is still being streamed and hasn't closed yet, e.g. "<emoti" / "<emotion ha".
const TRAILING_PARTIAL_TAG = /<\/?emotion\b[^>]*$/i;
// A lone trailing "<" that may be the very start of an upcoming tag mid-stream.
const TRAILING_ANGLE = /<$/;

export function stripEmotionTags(text: string): string {
  return text
    .replace(COMPLETE_EMOTION_TAG, "")
    .replace(TRAILING_PARTIAL_TAG, "")
    .replace(TRAILING_ANGLE, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Some backends also append the emotion as a bare trailing word (e.g. the reply
 * ends with "…concerned"). We can strip it precisely — only when it exactly
 * matches the emotion the server declared for this turn — so legitimate English
 * words at the end of a message are never removed.
 */
export function stripTrailingEmotionWord(
  text: string,
  emotion: string | null | undefined,
): string {
  const word = String(emotion ?? "").trim();
  if (!word) return text;
  return text
    .replace(new RegExp(`\\s*${escapeRegExp(word)}\\s*$`, "i"), "")
    .trimEnd();
}

/**
 * chat_end 定稿文本决策（回复出口时间守卫收口，2026-07-04）。
 *
 * 服务端在守卫 drop 过违规句时，会在 chat_end 上携带剔除后的终稿
 * `finalContent`（见 avatar/types.ts）。坏句在 chat_chunk 流式期间已经
 * 闪现在屏幕上，这里让定稿消息用终稿覆盖流式累积文本，把它收走；
 * 不带 finalContent 时走原路（流式累积 buffer），行为与从前逐字节一致。
 *
 * finalContent 是服务端持久化用的同一份文本（emotion 标签已在服务端剥过），
 * 但仍过一遍与累积路径相同的 strip 兜底，两条路径出口格式保持一致。
 */
export function resolveChatEndText(
  streamingBuf: string,
  finalContent: unknown,
  emotion: string | null | undefined,
): string {
  const guardFinal =
    typeof finalContent === "string" && finalContent.trim()
      ? finalContent
      : null;
  return stripTrailingEmotionWord(
    stripEmotionTags(guardFinal ?? streamingBuf).trimEnd(),
    emotion,
  );
}
