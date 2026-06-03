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
