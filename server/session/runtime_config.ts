import { endsWithSentencePunctuation } from "./turn_taking";

const SEMANTIC_END_RE = /(吗|呢|吧|了|啦|呀|啊|嘛|么|对吧|是吧|行吗|好吗|可以吗|是不是)\s*[。！？.!?]*$/u;

/** Ring buffer duration (ms) kept before speech_start — inject into STT so minSpeech ramp-up does not clip sentence beginnings. */
export function preRollMaxBytes(sampleRate: number): number {
  const raw = process.env.VAD_PRE_ROLL_MS;
  const ms = raw !== undefined && raw !== "" ? Number(raw) : 480;
  const dur = Number.isFinite(ms) && ms > 0 ? ms : 480;
  return Math.floor((sampleRate * 2 * dur) / 1000);
}

/**
 * After speech_end, wait this long before running STT. If speech_start fires again
 * (user continued after a short pause), the same PCM buffer is extended — one sentence
 * is not split into multiple stt_final messages. Set to 0 to disable (immediate STT).
 */
export function utteranceGapMs(): number {
  const raw = process.env.VAD_UTTERANCE_GAP_MS;
  if (raw === undefined || raw === "") return 180;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 180;
  return n;
}

export function parseNonNegativeMs(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

export function parseBooleanFlag(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === "") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "1" || normalized === "true") return true;
  if (normalized === "0" || normalized === "false") return false;
  return fallback;
}

export function devPresetCommandsEnabled(): boolean {
  return parseBooleanFlag(process.env.REMI_DEV_PRESETS_ENABLED, process.env.NODE_ENV !== "production");
}

export function proactivePlannerMainPathEnabled(): boolean {
  return parseBooleanFlag(process.env.REMI_PROACTIVE_PLANNER_MAIN_PATH_ENABLED, true);
}

export function isSemanticallyCompletePreview(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return endsWithSentencePunctuation(trimmed) || SEMANTIC_END_RE.test(trimmed);
}

export type PredictionBudgetConfig = {
  enabled: boolean;
  pushEnabled: boolean;
  debounceMs: number;
};

export function predictionBudgetConfig(): PredictionBudgetConfig {
  const enabled = parseBooleanFlag(process.env.STT_PARTIAL_PREDICTION_ENABLED, false);
  const pushRequested = parseBooleanFlag(process.env.STT_PREDICTION_PUSH_ENABLED, false);
  return {
    enabled,
    pushEnabled: enabled && pushRequested,
    debounceMs: parseNonNegativeMs(process.env.STT_PREDICTION_DEBOUNCE_MS, 300),
  };
}

export function sttPreviewIntervalMs(): number {
  return parseNonNegativeMs(process.env.STT_PREVIEW_INTERVAL_MS, 650);
}

export function sttPreviewDebounceMs(): number {
  return parseNonNegativeMs(process.env.STT_PREVIEW_DEBOUNCE_MS, 180);
}

export function sttPreviewMinSpeechMs(): number {
  return parseNonNegativeMs(process.env.STT_PREVIEW_MIN_SPEECH_MS, 550);
}

export function sttPreviewWindowMs(): number {
  return parseNonNegativeMs(process.env.STT_PREVIEW_WINDOW_MS, 4200);
}

export function sttPreviewSettleMs(): number {
  return parseNonNegativeMs(process.env.STT_PREVIEW_SETTLE_MS, 260);
}

/** Minimum utterance duration to run STT after VAD speech_end. */
export function minSpeechMs(): number {
  return parseNonNegativeMs(process.env.VAD_MIN_UTTERANCE_MS, 220);
}

/**
 * After speech_end, delay before STT. Longer spoken segments get a longer merge window
 * (mid-sentence pause); short phrases use a shorter delay (snappier end).
 * Set VAD_UTTERANCE_GAP_ADAPTIVE=0 for a fixed VAD_UTTERANCE_GAP_MS (legacy behavior).
 */
export function effectiveUtteranceGapMs(speechDurationMs: number): number {
  const base = utteranceGapMs();
  if (base <= 0) return 0;

  if (process.env.VAD_UTTERANCE_GAP_ADAPTIVE === "0") {
    return base;
  }

  const minG = parseNonNegativeMs(process.env.VAD_UTTERANCE_GAP_MIN_MS, 120);
  const maxG = parseNonNegativeMs(process.env.VAD_UTTERANCE_GAP_MAX_MS, 320);
  const lo = parseNonNegativeMs(process.env.VAD_UTTERANCE_GAP_ADAPTIVE_LO_MS, 400);
  const hi = parseNonNegativeMs(process.env.VAD_UTTERANCE_GAP_ADAPTIVE_HI_MS, 4400);
  if (maxG <= minG) return base;

  const t = Math.min(1, Math.max(0, (speechDurationMs - lo) / Math.max(1, hi - lo)));
  return Math.round(minG + t * (maxG - minG));
}

/** 用户多久没发消息后触发 Remi 主动搭话（ms）；未设置或 0 表示关闭 */
export function silenceNudgeMs(): number {
  const raw = process.env.REMI_SILENCE_NUDGE_MS;
  if (raw === undefined || raw === "") return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

export function hesitationHoldMs(): number {
  return parseNonNegativeMs(process.env.VAD_UTTERANCE_GAP_HESITATION_MS, 980);
}

export function turnTakingEnabled(): boolean {
  const raw = (process.env.TURN_TAKING_STAGE2_ENABLED ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false";
}

export function turnTakingGrowthHoldMs(): number {
  return parseNonNegativeMs(process.env.TURN_TAKING_GROWTH_HOLD_MS, 720);
}

export function turnTakingLikelyStableMs(): number {
  return parseNonNegativeMs(process.env.TURN_TAKING_LIKELY_STABLE_MS, 680);
}

export function turnTakingConfirmedStableMs(): number {
  return parseNonNegativeMs(process.env.TURN_TAKING_CONFIRMED_STABLE_MS, 1100);
}

export function voiceBackchannelEnabled(): boolean {
  const raw = (process.env.VOICE_BACKCHANNEL_ENABLED ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false";
}

export function voiceBackchannelCooldownMs(): number {
  return parseNonNegativeMs(process.env.VOICE_BACKCHANNEL_COOLDOWN_MS, 6000);
}

export function voiceBackchannelStableMs(): number {
  return parseNonNegativeMs(process.env.VOICE_BACKCHANNEL_STABLE_MS, 1100);
}

export function duplexInterruptMinSpeechMs(): number {
  return parseNonNegativeMs(process.env.DUPLEX_INTERRUPT_MIN_SPEECH_MS, 260);
}

export function fallbackNoiseSuppressMaxMs(): number {
  return parseNonNegativeMs(process.env.VAD_FALLBACK_NO_PREVIEW_SUPPRESS_MS, 900);
}

export function fallbackNoiseSuppressMinRms(): number {
  return parseNonNegativeMs(process.env.VAD_FALLBACK_NO_PREVIEW_MIN_RMS, 0.035);
}

export function fallbackNoiseTinyTextMaxChars(): number {
  return Math.max(
    1,
    Math.floor(parseNonNegativeMs(process.env.VAD_FALLBACK_NO_PREVIEW_TINY_TEXT_MAX_CHARS, 1)),
  );
}

export function fallbackStrongFrameRms(): number {
  return parseNonNegativeMs(process.env.VAD_FALLBACK_STRONG_FRAME_RMS, 35) / 1000;
}

export function fallbackStrongFramePeak(): number {
  return parseNonNegativeMs(process.env.VAD_FALLBACK_STRONG_FRAME_PEAK, 120) / 1000;
}

export function fallbackMinStrongFrames(): number {
  return Math.max(1, Math.floor(parseNonNegativeMs(process.env.VAD_FALLBACK_MIN_STRONG_FRAMES, 2)));
}

export function fallbackMinStrongRatio(): number {
  const raw = process.env.VAD_FALLBACK_MIN_STRONG_RATIO;
  if (raw === undefined || raw === "") return 0.08;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0.08;
  return Math.max(0, Math.min(1, n));
}

export function fallbackWeakSpeechSuppressMaxMs(): number {
  return parseNonNegativeMs(process.env.VAD_FALLBACK_WEAK_SPEECH_SUPPRESS_MS, 1600);
}

export function strictCandidateMinSpeechMs(): number {
  return parseNonNegativeMs(process.env.VAD_STRICT_CANDIDATE_MIN_SPEECH_MS, 520);
}

export function strictCandidateMinStrongFrames(): number {
  return Math.max(1, Math.floor(parseNonNegativeMs(process.env.VAD_STRICT_CANDIDATE_MIN_STRONG_FRAMES, 8)));
}

export function strictCandidateMinStrongRatio(): number {
  const raw = process.env.VAD_STRICT_CANDIDATE_MIN_STRONG_RATIO;
  if (raw === undefined || raw === "") return 0.22;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0.22;
  return Math.max(0, Math.min(1, n));
}

export function suppressedNoiseCooldownMs(): number {
  return parseNonNegativeMs(process.env.VAD_SUPPRESSED_NOISE_COOLDOWN_MS, 420);
}

export function suppressedNoiseBypassRms(): number {
  return parseNonNegativeMs(process.env.VAD_SUPPRESSED_NOISE_BYPASS_RMS, 40) / 1000;
}

export function suppressedNoiseBypassPeak(): number {
  return parseNonNegativeMs(process.env.VAD_SUPPRESSED_NOISE_BYPASS_PEAK, 90) / 1000;
}

/** 随机选择打断反应音文本 */
export function randomInterruptReaction(): string {
  const reactions = ["啊？", "嗯？", "怎么啦？"];
  return reactions[Math.floor(Math.random() * reactions.length)];
}

export function pcmRms(pcm: Buffer): number {
  const samples = Math.floor(pcm.length / 2);
  if (samples <= 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const sample = pcm.readInt16LE(i * 2) / 32768;
    sum += sample * sample;
  }
  return Math.sqrt(sum / samples);
}

export function pcmPeak(pcm: Buffer): number {
  const samples = Math.floor(pcm.length / 2);
  if (samples <= 0) return 0;
  let peak = 0;
  for (let i = 0; i < samples; i++) {
    const abs = Math.abs(pcm.readInt16LE(i * 2) / 32768);
    if (abs > peak) peak = abs;
  }
  return peak;
}
