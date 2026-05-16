/** 情绪标签（每条连接有独立的 EmotionRuntime 实例） */
export type Emotion = "neutral" | "happy" | "curious" | "shy" | "sad" | "concerned" | "playful" | "thoughtful";

export const VALID_EMOTIONS: readonly Emotion[] = [
  "neutral", "happy", "curious", "shy", "sad", "concerned", "playful", "thoughtful",
] as const;

export function isValidEmotion(s: string): s is Emotion {
  return (VALID_EMOTIONS as readonly string[]).includes(s);
}
