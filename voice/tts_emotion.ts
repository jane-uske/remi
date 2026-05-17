import type { Emotion } from "../emotion/emotion_state";

export type { Emotion };

export interface EmotionVoiceParams {
  rate: string;
  pitch: string;
  lengthScale: number;
  noiseScale: number;
  speed: number;
}

const EMOTION_VOICE_MAP: Record<Emotion, EmotionVoiceParams> = {
  neutral: { rate: "default", pitch: "default", lengthScale: 1.0, noiseScale: 0.667, speed: 1.0 },
  happy: { rate: "+14%", pitch: "+12Hz", lengthScale: 0.88, noiseScale: 0.82, speed: 1.12 },
  curious: { rate: "+7%", pitch: "+14Hz", lengthScale: 0.94, noiseScale: 0.78, speed: 1.06 },
  shy: { rate: "-10%", pitch: "-2Hz", lengthScale: 1.12, noiseScale: 0.48, speed: 0.9 },
  sad: { rate: "-18%", pitch: "-10Hz", lengthScale: 1.24, noiseScale: 0.38, speed: 0.82 },
  concerned: { rate: "-8%", pitch: "-4Hz", lengthScale: 1.08, noiseScale: 0.52, speed: 0.92 },
  playful: { rate: "+10%", pitch: "+8Hz", lengthScale: 0.92, noiseScale: 0.75, speed: 1.08 },
  thoughtful: { rate: "-12%", pitch: "-3Hz", lengthScale: 1.14, noiseScale: 0.45, speed: 0.88 },
};

export function getEmotionVoiceParams(emotion: Emotion): EmotionVoiceParams {
  return EMOTION_VOICE_MAP[emotion];
}
