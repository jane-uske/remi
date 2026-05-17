import { getConfig } from "../../server/config";
import { endsWithSentencePunctuation } from "./turn_taking";

const SEMANTIC_END_RE = /(吗|呢|吧|了|啦|呀|啊|嘛|么|对吧|是吧|行吗|好吗|可以吗|是不是)\s*[。！？.!?]*$/u;

/** Ring buffer duration (ms) kept before speech_start — inject into STT so minSpeech ramp-up does not clip sentence beginnings. */
export function preRollMaxBytes(sampleRate: number): number {
  const dur = getConfig().VAD_PRE_ROLL_MS;
  return Math.floor((sampleRate * 2 * dur) / 1000);
}

/**
 * After speech_end, wait this long before running STT. If speech_start fires again
 * (user continued after a short pause), the same PCM buffer is extended — one sentence
 * is not split into multiple stt_final messages. Set to 0 to disable (immediate STT).
 */
export function utteranceGapMs(): number {
  return getConfig().VAD_UTTERANCE_GAP_MS;
}

export function devPresetCommandsEnabled(): boolean {
  return getConfig().REMI_DEV_PRESETS_ENABLED;
}

export function proactivePlannerMainPathEnabled(): boolean {
  return getConfig().REMI_PROACTIVE_PLANNER_MAIN_PATH_ENABLED;
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
  const cfg = getConfig();
  const localLlmEnabled = cfg.REMI_LOCAL_LLM_ENABLED;
  const enabled = localLlmEnabled && cfg.STT_PARTIAL_PREDICTION_ENABLED;
  const pushRequested = cfg.STT_PREDICTION_PUSH_ENABLED;
  return {
    enabled,
    pushEnabled: enabled && pushRequested,
    debounceMs: cfg.STT_PREDICTION_DEBOUNCE_MS,
  };
}

export function sttPreviewIntervalMs(): number {
  return getConfig().STT_PREVIEW_INTERVAL_MS;
}

export function sttPreviewDebounceMs(): number {
  return getConfig().STT_PREVIEW_DEBOUNCE_MS;
}

export function sttPreviewMinSpeechMs(): number {
  return getConfig().STT_PREVIEW_MIN_SPEECH_MS;
}

export function sttPreviewWindowMs(): number {
  return getConfig().STT_PREVIEW_WINDOW_MS;
}

export function sttPreviewSettleMs(): number {
  return getConfig().STT_PREVIEW_SETTLE_MS;
}

/** Minimum utterance duration to run STT after VAD speech_end. */
export function minSpeechMs(): number {
  return getConfig().VAD_MIN_UTTERANCE_MS;
}

/**
 * After speech_end, delay before STT. Longer spoken segments get a longer merge window
 * (mid-sentence pause); short phrases use a shorter delay (snappier end).
 * Set VAD_UTTERANCE_GAP_ADAPTIVE=0 for a fixed VAD_UTTERANCE_GAP_MS (legacy behavior).
 */
export function effectiveUtteranceGapMs(speechDurationMs: number): number {
  const cfg = getConfig();
  const base = cfg.VAD_UTTERANCE_GAP_MS;
  if (base <= 0) return 0;

  if (!cfg.VAD_UTTERANCE_GAP_ADAPTIVE) {
    return base;
  }

  const minG = cfg.VAD_UTTERANCE_GAP_MIN_MS;
  const maxG = cfg.VAD_UTTERANCE_GAP_MAX_MS;
  const lo = cfg.VAD_UTTERANCE_GAP_ADAPTIVE_LO_MS;
  const hi = cfg.VAD_UTTERANCE_GAP_ADAPTIVE_HI_MS;
  if (maxG <= minG) return base;

  const t = Math.min(1, Math.max(0, (speechDurationMs - lo) / Math.max(1, hi - lo)));
  return Math.round(minG + t * (maxG - minG));
}

/** 用户多久没发消息后触发 Remi 主动搭话（ms）；未设置或 0 表示关闭 */
export function silenceNudgeMs(): number {
  return getConfig().REMI_SILENCE_NUDGE_MS;
}

export function hesitationHoldMs(): number {
  return getConfig().VAD_UTTERANCE_GAP_HESITATION_MS;
}

export function turnTakingEnabled(): boolean {
  return getConfig().TURN_TAKING_STAGE2_ENABLED;
}

export function turnTakingGrowthHoldMs(): number {
  return getConfig().TURN_TAKING_GROWTH_HOLD_MS;
}

export function turnTakingLikelyStableMs(): number {
  return getConfig().TURN_TAKING_LIKELY_STABLE_MS;
}

export function turnTakingConfirmedStableMs(): number {
  return getConfig().TURN_TAKING_CONFIRMED_STABLE_MS;
}

export function turnProsodyEnabled(): boolean {
  return getConfig().TURN_PROSODY_ENABLED;
}

export function voiceBackchannelEnabled(): boolean {
  return getConfig().VOICE_BACKCHANNEL_ENABLED;
}

export function voiceBackchannelCooldownMs(): number {
  return getConfig().VOICE_BACKCHANNEL_COOLDOWN_MS;
}

export function voiceBackchannelStableMs(): number {
  return getConfig().VOICE_BACKCHANNEL_STABLE_MS;
}

export function duplexInterruptMinSpeechMs(): number {
  return getConfig().DUPLEX_INTERRUPT_MIN_SPEECH_MS;
}

export function duplexFallbackInterruptMinSpeechMs(): number {
  return getConfig().DUPLEX_FALLBACK_INTERRUPT_MIN_SPEECH_MS;
}

export function duplexFallbackInterruptMinRms(): number {
  return getConfig().DUPLEX_FALLBACK_INTERRUPT_MIN_RMS;
}

export function duplexFallbackInterruptMinStrongRatio(): number {
  return getConfig().DUPLEX_FALLBACK_INTERRUPT_MIN_STRONG_RATIO;
}

export function duplexFallbackInterruptMinPreviewChars(): number {
  return Math.max(1, Math.floor(getConfig().DUPLEX_FALLBACK_INTERRUPT_MIN_PREVIEW_CHARS));
}

export function duplexAssistantNoPreviewInterruptMinSpeechMs(): number {
  return getConfig().DUPLEX_ASSISTANT_NO_PREVIEW_INTERRUPT_MIN_SPEECH_MS;
}

export function duplexIdleGuardAfterMs(): number {
  return getConfig().DUPLEX_IDLE_GUARD_AFTER_MS;
}

export function duplexIdleGuardMeaningfulPreviewChars(): number {
  return Math.max(1, Math.floor(getConfig().DUPLEX_IDLE_GUARD_MEANINGFUL_PREVIEW_CHARS));
}

export function duplexIdleGuardMinSpeechMs(): number {
  return getConfig().DUPLEX_IDLE_GUARD_MIN_SPEECH_MS;
}

export function duplexIdleGuardMinRms(): number {
  return getConfig().DUPLEX_IDLE_GUARD_MIN_RMS;
}

export function duplexIdleGuardMinStrongRatio(): number {
  return getConfig().DUPLEX_IDLE_GUARD_MIN_STRONG_RATIO;
}

export function duplexIdleGuardNoPreviewMinSpeechMs(): number {
  return getConfig().DUPLEX_IDLE_GUARD_NO_PREVIEW_MIN_SPEECH_MS;
}

export function duplexIdleGuardNoPreviewMinRms(): number {
  return getConfig().DUPLEX_IDLE_GUARD_NO_PREVIEW_MIN_RMS;
}

export function duplexIdleGuardNoPreviewMinStrongRatio(): number {
  return getConfig().DUPLEX_IDLE_GUARD_NO_PREVIEW_MIN_STRONG_RATIO;
}

export function fallbackNoiseSuppressMaxMs(): number {
  return getConfig().VAD_FALLBACK_NO_PREVIEW_SUPPRESS_MS;
}

export function fallbackNoiseSuppressMinRms(): number {
  return getConfig().VAD_FALLBACK_NO_PREVIEW_MIN_RMS;
}

export function fallbackNoiseTinyTextMaxChars(): number {
  return Math.max(1, Math.floor(getConfig().VAD_FALLBACK_NO_PREVIEW_TINY_TEXT_MAX_CHARS));
}

export function fallbackNoiseShortTextMaxChars(): number {
  return Math.max(1, Math.floor(getConfig().VAD_FALLBACK_NO_PREVIEW_SHORT_TEXT_MAX_CHARS));
}

export function fallbackStrongFrameRms(): number {
  return getConfig().VAD_FALLBACK_STRONG_FRAME_RMS / 1000;
}

export function fallbackStrongFramePeak(): number {
  return getConfig().VAD_FALLBACK_STRONG_FRAME_PEAK / 1000;
}

export function fallbackMinStrongFrames(): number {
  return Math.max(1, Math.floor(getConfig().VAD_FALLBACK_MIN_STRONG_FRAMES));
}

export function fallbackMinStrongRatio(): number {
  return getConfig().VAD_FALLBACK_MIN_STRONG_RATIO;
}

export function fallbackWeakSpeechSuppressMaxMs(): number {
  return getConfig().VAD_FALLBACK_WEAK_SPEECH_SUPPRESS_MS;
}

export function strictCandidateMinSpeechMs(): number {
  return getConfig().VAD_STRICT_CANDIDATE_MIN_SPEECH_MS;
}

export function strictCandidateMinStrongFrames(): number {
  return Math.max(1, Math.floor(getConfig().VAD_STRICT_CANDIDATE_MIN_STRONG_FRAMES));
}

export function strictCandidateMinStrongRatio(): number {
  return getConfig().VAD_STRICT_CANDIDATE_MIN_STRONG_RATIO;
}

export function suppressedNoiseCooldownMs(): number {
  return getConfig().VAD_SUPPRESSED_NOISE_COOLDOWN_MS;
}

export function suppressedNoiseBypassRms(): number {
  return getConfig().VAD_SUPPRESSED_NOISE_BYPASS_RMS / 1000;
}

export function suppressedNoiseBypassPeak(): number {
  return getConfig().VAD_SUPPRESSED_NOISE_BYPASS_PEAK / 1000;
}

export function iosDuplexInputGain(): number {
  return getConfig().REMI_IOS_DUPLEX_INPUT_GAIN;
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
