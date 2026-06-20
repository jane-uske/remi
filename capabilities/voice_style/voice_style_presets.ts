import { getMlxInstruct, type Emotion } from "../../voice/tts_emotion";

export interface VoiceStylePreset {
  id: string;
  /** Display label used in the confirmation reply. */
  label: string;
  /** Qwen3-TTS CustomVoice base instruct string. */
  instruct: string;
}

export const VOICE_STYLE_PRESETS: Record<string, VoiceStylePreset> = {
  yujie: {
    id: "yujie",
    label: "御姐音",
    instruct: "成熟冷傲，嗓音低沉性感，气场强势，语速适中",
  },
  luoli: {
    id: "luoli",
    label: "萝莉音",
    instruct: "稚嫩可爱，语调偏高，语速较快，带一点撒娇感",
  },
  wenrou: {
    id: "wenrou",
    label: "温柔音",
    instruct: "温柔细腻，语速偏慢，声线柔和，如春风细雨",
  },
  yuanqi: {
    id: "yuanqi",
    label: "元气音",
    instruct: "活泼开朗，充满元气，语调明快，带一点跳跃感",
  },
  lengku: {
    id: "lengku",
    label: "冷酷音",
    instruct: "冷静克制，语调平稳，语速适中，不带多余情绪",
  },
  wumei: {
    id: "wumei",
    label: "妩媚音",
    instruct: "妩媚撩人，语调婉转，尾音略带勾人气息",
  },
};

/**
 * Short emotion modifiers appended after the base style instruct.
 * neutral / undefined → no suffix (base instruct only).
 */
const EMOTION_MODIFIER: Partial<Record<Emotion, string>> = {
  happy: "，带一点笑意",
  curious: "，语调略带期待",
  shy: "，语速稍慢，略显犹豫",
  sad: "，语速缓慢，语气低沉",
  concerned: "，语气稳重，轻声安抚",
  playful: "，俏皮活泼",
  thoughtful: "，停顿自然，沉稳",
};

/**
 * Build the full instruct for a preset + optional emotion.
 * Unknown preset id → fallback to default per-emotion instruct.
 */
export function buildVoiceStyleInstruct(
  presetId: string,
  emotion?: Emotion,
): string {
  const preset = VOICE_STYLE_PRESETS[presetId];
  if (!preset) return getMlxInstruct(emotion ?? "neutral");

  const suffix = emotion ? (EMOTION_MODIFIER[emotion] ?? "") : "";
  return preset.instruct + suffix;
}

// ---------------------------------------------------------------------------
// Regex matching — kept tight to avoid false positives on casual mentions.
// ---------------------------------------------------------------------------

/** All preset style keywords joined for regex alternation. */
const STYLE_NAMES = Object.values(VOICE_STYLE_PRESETS)
  .map((p) => p.label.replace(/音$/, ""))
  .join("|");

/** Action verb + style name + optional "音/音色/声音/嗓音" suffix. */
const VOICE_STYLE_RE = new RegExp(
  `(?:^|\\s)(用|换成|切换?到?|来个?|换个?|来点?)\\s*(${STYLE_NAMES})(音|音色|声音|嗓音)?(?:\\s|$|[～~。！!？?，,])`,
  "u",
);

/** Reset phrasing — "恢复原来的声音" etc. */
const VOICE_RESET_RE =
  /(恢复|还原|回到|换回).*(原来|默认|正常|之前).*(声音|音色|嗓音|语音)?/u;

/** Label → preset id reverse lookup. */
const LABEL_TO_ID: Record<string, string> = {};
for (const p of Object.values(VOICE_STYLE_PRESETS)) {
  LABEL_TO_ID[p.label.replace(/音$/, "")] = p.id;
}

/**
 * Returns the matching preset if the message is a voice style switch command,
 * or null if unrecognised / casual mention.
 */
export function matchVoiceStyleCommand(
  message: string,
): VoiceStylePreset | null {
  const trimmed = message.trim();
  if (!trimmed) return null;
  const m = VOICE_STYLE_RE.exec(trimmed);
  if (!m) return null;

  const styleName = m[2]; // e.g. "御姐"
  const id = LABEL_TO_ID[styleName];
  return id ? VOICE_STYLE_PRESETS[id] : null;
}

/** True when the message asks to reset the voice to default. */
export function isVoiceStyleResetCommand(message: string): boolean {
  return VOICE_RESET_RE.test(message.trim());
}

/** All presets as a flat array (for future settings UI). */
export function getVoiceStylePresets(): VoiceStylePreset[] {
  return Object.values(VOICE_STYLE_PRESETS);
}

// ---------------------------------------------------------------------------
// Speed / pitch tuning — natural language commands like "说慢点" / "调子高点".
// ---------------------------------------------------------------------------

export type VoiceTuneKind = "speed" | "pitch";
export type VoiceTuneDirection = "up" | "down" | "reset";

export interface VoiceTuneResult {
  kind: VoiceTuneKind;
  direction: VoiceTuneDirection;
  /** The instruct snippet to append, e.g. "，语速偏慢". null for reset. */
  modifier: string | null;
  /** Confirmation text for Remi's reply. */
  reply: string;
}

// Speed — "说慢点", "快一些", "你说的太快了", "语速慢一点"
const SPEED_SLOW_RE =
  /(说|讲|语速|速度).*(慢|缓)|(太快了|好快|说得.*快|讲得.*快|快.*了吧)/u;
const SPEED_FAST_RE =
  /(说|讲|语速|速度).*(快|急)|(太慢了|好慢|说得.*慢|讲得.*慢|慢.*了吧)/u;
const SPEED_RESET_RE =
  /(语速|速度).*(正常|默认|恢复|适中)/u;

// Pitch — "调子高点", "声音低一点", "音调太高了"
// Direct requests: "(声音|调子) + direction keyword + 一点/一些/点"
// Complaints: "太高了" = wants lower; "太低了" = wants higher (inverted)
const PITCH_UP_DIRECT_RE =
  /(调子?|音调|声音|嗓音).*(高|尖|亮)\s*(一?[点些]|一下)/u;
const PITCH_UP_COMPLAINT_RE =
  /(太低了|好低|太沉了|太闷了)/u;
const PITCH_DOWN_DIRECT_RE =
  /(调子?|音调|声音|嗓音).*(低|沉|厚)\s*(一?[点些]|一下)/u;
const PITCH_DOWN_COMPLAINT_RE =
  /(太高了|好高|太尖了|太亮了|太细了)/u;
const PITCH_RESET_RE =
  /(调子?|音调).*(正常|默认|恢复|适中)/u;

const SPEED_MODIFIERS: Record<VoiceTuneDirection, string | null> = {
  down: "，语速偏慢",
  up: "，语速偏快",
  reset: null,
};
const PITCH_MODIFIERS: Record<VoiceTuneDirection, string | null> = {
  down: "，语调偏低沉",
  up: "，语调偏高",
  reset: null,
};

const TUNE_REPLIES: Record<VoiceTuneKind, Record<VoiceTuneDirection, string>> = {
  speed: {
    down: "好的，我说慢一点～",
    up: "好的，我说快一点～",
    reset: "好的，恢复正常语速了～",
  },
  pitch: {
    down: "好的，声音低一点～",
    up: "好的，声音高一点～",
    reset: "好的，恢复正常音调了～",
  },
};

/**
 * Detect speed/pitch tuning commands in user message.
 * Returns null if unrecognised.
 */
export function matchVoiceTuneCommand(message: string): VoiceTuneResult | null {
  const t = message.trim();
  if (!t) return null;

  // Speed
  if (SPEED_RESET_RE.test(t)) {
    return { kind: "speed", direction: "reset", modifier: null, reply: TUNE_REPLIES.speed.reset };
  }
  if (SPEED_SLOW_RE.test(t)) {
    return { kind: "speed", direction: "down", modifier: SPEED_MODIFIERS.down!, reply: TUNE_REPLIES.speed.down };
  }
  if (SPEED_FAST_RE.test(t)) {
    return { kind: "speed", direction: "up", modifier: SPEED_MODIFIERS.up!, reply: TUNE_REPLIES.speed.up };
  }

  // Pitch
  if (PITCH_RESET_RE.test(t)) {
    return { kind: "pitch", direction: "reset", modifier: null, reply: TUNE_REPLIES.pitch.reset };
  }
  if (PITCH_UP_DIRECT_RE.test(t) || PITCH_UP_COMPLAINT_RE.test(t)) {
    return { kind: "pitch", direction: "up", modifier: PITCH_MODIFIERS.up!, reply: TUNE_REPLIES.pitch.up };
  }
  if (PITCH_DOWN_DIRECT_RE.test(t) || PITCH_DOWN_COMPLAINT_RE.test(t)) {
    return { kind: "pitch", direction: "down", modifier: PITCH_MODIFIERS.down!, reply: TUNE_REPLIES.pitch.down };
  }

  return null;
}
