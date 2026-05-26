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

// Qwen3-TTS CustomVoice instruct strings
const MLX_INSTRUCT_MAP: Record<Emotion, string> = {
  neutral:    "自然平和，语速适中，像真人说话",
  happy:      "开心愉快，充满活力，带一点笑意",
  curious:    "好奇探究，语调上扬，带一点期待感",
  shy:        "轻柔克制，语速稍慢，带一点犹豫",
  sad:        "低沉悲伤，语速缓慢，语气温柔",
  concerned:  "关切担忧，语气稳重，带一点轻声安抚",
  playful:    "俏皮活泼，带一点调皮和笑意",
  thoughtful: "沉稳思考，语速偏慢，停顿自然",
};

export function getMlxInstruct(emotion: Emotion, _text?: string): string {
  return MLX_INSTRUCT_MAP[emotion] ?? MLX_INSTRUCT_MAP.neutral;
}
