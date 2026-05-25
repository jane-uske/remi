import type { AvatarFrame, Emotion, FaceParams } from "./types";

// ---------------------------------------------------------------------------
// LLM output parser: inline [emotion] tags + (thought) routing
// (Open-LLM-VTuber pattern)
// ---------------------------------------------------------------------------

export interface ParsedLLMChunk {
  speech: string;
  emotions: Emotion[];
  thoughts: string[];
}

const EMOTION_TAG_RE = /\[(\w+)\]/g;
const THOUGHT_RE = /\(([^)]+)\)/g;

const VALID_EMOTIONS = new Set<string>([
  "neutral", "happy", "curious", "shy", "sad", "concerned", "playful", "thoughtful",
]);

export function parseLLMEmotionTags(chunk: string): ParsedLLMChunk {
  const emotions: Emotion[] = [];
  const thoughts: string[] = [];

  for (const m of chunk.matchAll(EMOTION_TAG_RE)) {
    if (VALID_EMOTIONS.has(m[1])) emotions.push(m[1] as Emotion);
  }
  for (const m of chunk.matchAll(THOUGHT_RE)) {
    thoughts.push(m[1]);
  }

  const speech = chunk
    .replace(EMOTION_TAG_RE, "")
    .replace(THOUGHT_RE, "")
    .trim();

  return { speech, emotions, thoughts };
}

const FACE_KEYS: (keyof FaceParams)[] = [
  "eyeOpenL",
  "eyeOpenR",
  "eyeSquintL",
  "eyeSquintR",
  "browUpL",
  "browUpR",
  "browDownL",
  "browDownR",
  "mouthSmile",
  "mouthFrown",
  "mouthOpen",
  "mouthPucker",
  "cheekPuff",
];

export const DEFAULT_FACE: FaceParams = {
  eyeOpenL: 1,
  eyeOpenR: 1,
  eyeSquintL: 0,
  eyeSquintR: 0,
  browUpL: 0,
  browUpR: 0,
  browDownL: 0,
  browDownR: 0,
  mouthSmile: 0,
  mouthFrown: 0,
  mouthOpen: 0,
  mouthPucker: 0,
  cheekPuff: 0,
};

export const EMOTION_FACE_MAP: Record<Emotion, Partial<FaceParams>> = {
  neutral: {
    mouthSmile: 0.1,
  },
  happy: {
    mouthSmile: 0.9,
    eyeSquintL: 0.65,
    eyeSquintR: 0.65,
    browUpL: 0.45,
    browUpR: 0.45,
  },
  curious: {
    eyeOpenL: 1,
    eyeOpenR: 1,
    browUpL: 0.55,
    browUpR: 0.55,
    mouthOpen: 0.18,
  },
  shy: {
    eyeOpenL: 0.42,
    eyeOpenR: 0.42,
    mouthFrown: 0.22,
    cheekPuff: 0.45,
    mouthPucker: 0.38,
  },
  sad: {
    eyeOpenL: 0.52,
    eyeOpenR: 0.52,
    browDownL: 0.55,
    browDownR: 0.55,
    mouthFrown: 0.62,
  },
  concerned: {
    eyeOpenL: 0.7,
    eyeOpenR: 0.7,
    browDownL: 0.35,
    browDownR: 0.35,
    mouthFrown: 0.2,
  },
  playful: {
    mouthSmile: 0.7,
    eyeSquintL: 0.4,
    eyeSquintR: 0.4,
    browUpL: 0.3,
    browUpR: 0.3,
  },
  thoughtful: {
    eyeOpenL: 0.6,
    eyeOpenR: 0.6,
    browUpL: 0.25,
    browDownR: 0.2,
    mouthPucker: 0.15,
  },
};

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export function getEmotionFace(emotion: Emotion): FaceParams {
  const base: FaceParams = { ...DEFAULT_FACE };
  const override = EMOTION_FACE_MAP[emotion];
  for (const key of FACE_KEYS) {
    const v = override[key];
    if (v !== undefined) {
      base[key] = clamp01(v);
    }
  }
  return base;
}

export function interpolateFace(from: FaceParams, to: FaceParams, t: number): FaceParams {
  const tt = clamp01(t);
  const out = { ...from };
  for (const key of FACE_KEYS) {
    out[key] = clamp01(from[key] + (to[key] - from[key]) * tt);
  }
  return out;
}

const DEFAULT_TRANSITION_FPS = 30;

export function createTransition(
  from: Emotion,
  to: Emotion,
  durationMs: number,
  fps: number = DEFAULT_TRANSITION_FPS
): AvatarFrame[] {
  const fromFace = getEmotionFace(from);
  const toFace = getEmotionFace(to);
  const frameCount = Math.max(1, Math.round((durationMs * fps) / 1000));
  const frames: AvatarFrame[] = [];

  for (let i = 0; i < frameCount; i++) {
    const t = frameCount === 1 ? 1 : i / (frameCount - 1);
    frames.push({
      emotion: to,
      face: interpolateFace(fromFace, toFace, t),
    });
  }

  return frames;
}
