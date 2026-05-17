import { EventEmitter } from "events";
import { getConfig } from "../server/config";

export interface VadOptions {
  /** RMS energy threshold (0–1 for 16-bit PCM). Default: ~0.06 */
  energyThreshold?: number;
  /** Consecutive silent frames before speech_end. Default: 6 (~300 ms if each client chunk ≈50 ms) */
  silenceFrames?: number;
  /**
   * While already speaking, allow a longer silence hangover before speech_end.
   * Default: 10 (~200 ms at 20 ms chunks, ~500 ms at 50 ms chunks). 可通过 VAD_SPEAKING_SILENCE_FRAMES 环境变量回退到旧值
   */
  speakingSilenceFrames?: number;
  /** Minimum speech frames before triggering speech_start. Default: 3 (~150 ms at 50 ms chunks) */
  minSpeechFrames?: number;
  /**
   * Keep speaking with a lower energy gate than onset, to avoid chopping
   * natural mid-phrase dips ("嗯……我想一下") into multiple utterances.
   */
  continueEnergyRatio?: number;
  /**
   * Max zero-crossing rate (0–1) for a frame to count as speech.
   * Keyboard clicks typically have ZCR >0.5; Chinese speech (including
   * sibilants like sh/zh/s/c) can reach ~0.45.
   * Default: 0.45
   */
  maxZcr?: number;
  /** Looser ZCR gate while already speaking. Default: 0.58 */
  continueMaxZcr?: number;
  /**
   * Max peak/RMS ratio (crest factor) for a frame to count as speech.
   * Impulsive noise (keyboard, mouse) is spike-dominated → crest often 30+.
   * Sustained speech in a frame is typically under 22.
   * Default: 22
   */
  maxCrest?: number;
  /** Looser crest gate while already speaking. Default: 30 */
  continueMaxCrest?: number;
  /**
   * Fallback energy gate for speech onset when ZCR / crest are too strict
   * for real mic conditions. Sustained voiced energy over several frames
   * can still trigger speech_start, avoiding "never recognizes speech".
   */
  fallbackEnergyThreshold?: number;
  /** Minimum consecutive fallback-energy frames before speech_start. */
  fallbackMinSpeechFrames?: number;
  /**
   * Minimum "active sample" ratio for onset.
   * Speech occupies a wider portion of the frame; impulsive keyboard clicks are sparse.
   */
  minActiveRatio?: number;
  /** Looser active-sample ratio while already speaking. */
  continueMinActiveRatio?: number;
  /** Fallback-energy mode still requires a speech-like active spread. */
  fallbackMinActiveRatio?: number;
}

/**
 * Energy + ZCR Voice Activity Detector for 16-bit LE mono PCM.
 *
 * Uses RMS energy AND zero-crossing rate to distinguish speech from
 * transient noise (keyboard clicks, mouse clicks, etc.).
 *
 * speechCount decays gradually (−1 per non-speech frame) instead of
 * hard-resetting, so occasional sibilant frames don't break the chain.
 *
 * Events:
 *   "speech_start"  — user began speaking
 *   "speech_end"    — user stopped speaking (after sustained silence)
 */
export class VadDetector extends EventEmitter {
  private threshold: number;
  private silenceLimit: number;
  private speakingSilenceLimit: number;
  private minSpeech: number;
  private continueEnergyRatio: number;
  private maxZcr: number;
  private continueMaxZcr: number;
  private maxCrest: number;
  private continueMaxCrest: number;
  private fallbackEnergyThreshold: number;
  private fallbackMinSpeech: number;
  private minActiveRatio: number;
  private continueMinActiveRatio: number;
  private fallbackMinActiveRatio: number;

  private _speaking = false;
  private speechCount = 0;
  private silentCount = 0;
  private fallbackSpeechCount = 0;

  constructor(opts: VadOptions = {}) {
    super();
    const cfg = getConfig();
    const envThreshold = cfg.VAD_THRESHOLD;
    const envMinSpeech = cfg.VAD_MIN_SPEECH_FRAMES;
    const envSilenceFrames = cfg.VAD_SILENCE_FRAMES;
    const envSpeakingSilenceFrames = cfg.VAD_SPEAKING_SILENCE_FRAMES;
    const envContinueEnergyRatio = cfg.VAD_CONTINUE_ENERGY_RATIO;
    const envMaxZcr = cfg.VAD_MAX_ZCR;
    const envContinueMaxZcr = cfg.VAD_CONTINUE_MAX_ZCR;
    const envMaxCrest = cfg.VAD_MAX_CREST;
    const envContinueMaxCrest = cfg.VAD_CONTINUE_MAX_CREST;
    const envFallbackEnergyThreshold = cfg.VAD_FALLBACK_ENERGY_THRESHOLD;
    const envFallbackMinSpeechFrames = cfg.VAD_FALLBACK_MIN_SPEECH_FRAMES;
    const envMinActiveRatio = cfg.VAD_MIN_ACTIVE_RATIO;
    const envContinueMinActiveRatio = cfg.VAD_CONTINUE_MIN_ACTIVE_RATIO;
    const envFallbackMinActiveRatio = cfg.VAD_FALLBACK_MIN_ACTIVE_RATIO;
    // Balance: too high → mic never crosses threshold (no reaction); too low
    // → false triggers. Tune with VAD_THRESHOLD / VAD_MIN_SPEECH_FRAMES.
    this.threshold = opts.energyThreshold ?? envThreshold ?? 0.04;
    this.silenceLimit = opts.silenceFrames ?? envSilenceFrames ?? 6;
    this.speakingSilenceLimit =
      opts.speakingSilenceFrames ?? envSpeakingSilenceFrames ?? Math.max(this.silenceLimit, 10);
    this.minSpeech = opts.minSpeechFrames ?? envMinSpeech ?? 3;
    this.continueEnergyRatio = opts.continueEnergyRatio ?? envContinueEnergyRatio ?? 0.55;
    this.maxZcr = opts.maxZcr ?? envMaxZcr ?? 0.62;
    this.continueMaxZcr = opts.continueMaxZcr ?? envContinueMaxZcr ?? 0.78;
    this.maxCrest = opts.maxCrest ?? envMaxCrest ?? 28;
    this.continueMaxCrest = opts.continueMaxCrest ?? envContinueMaxCrest ?? 38;
    this.fallbackEnergyThreshold =
      opts.fallbackEnergyThreshold ??
      envFallbackEnergyThreshold ??
      Math.max(0.015, this.threshold * 0.45);
    this.fallbackMinSpeech =
      opts.fallbackMinSpeechFrames ??
      envFallbackMinSpeechFrames ??
      Math.max(this.minSpeech + 1, 4);
    this.minActiveRatio = opts.minActiveRatio ?? envMinActiveRatio ?? 0.18;
    this.continueMinActiveRatio =
      opts.continueMinActiveRatio ?? envContinueMinActiveRatio ?? 0.12;
    this.fallbackMinActiveRatio =
      opts.fallbackMinActiveRatio ?? envFallbackMinActiveRatio ?? 0.16;
  }

  get speaking(): boolean {
    return this._speaking;
  }

  /**
   * Feed a 16-bit LE mono PCM chunk from the client.
   * A frame counts as "speech" only when energy exceeds the threshold,
   * zero-crossing rate is below maxZcr, and crest factor is below maxCrest
   * (keyboard/mouse clicks are impulsive → very high peak/RMS).
   */
  feed(pcm: Buffer): void {
    const energy = rms(pcm);
    const zcr = zeroCrossingRate(pcm);
    const crest = crestFactor(pcm);
    const activeRatio = activeSampleRatio(pcm);
    const isSpeechStart =
      energy > this.threshold &&
      zcr < this.maxZcr &&
      crest < this.maxCrest &&
      activeRatio >= this.minActiveRatio;
    const continueThreshold = this.threshold * this.continueEnergyRatio;
    const isSpeechContinue =
      energy > continueThreshold &&
      zcr < this.continueMaxZcr &&
      crest < this.continueMaxCrest &&
      activeRatio >= this.continueMinActiveRatio;
    const isFallbackStart =
      !this._speaking &&
      energy > this.fallbackEnergyThreshold &&
      zcr < this.continueMaxZcr &&
      crest < this.continueMaxCrest &&
      activeRatio >= this.fallbackMinActiveRatio;

    if (isSpeechStart || (this._speaking && isSpeechContinue) || isFallbackStart) {
      this.silentCount = 0;
      if (isSpeechStart || (this._speaking && isSpeechContinue)) {
        this.speechCount++;
      } else {
        this.speechCount = Math.max(0, this.speechCount - 1);
      }
      this.fallbackSpeechCount = isFallbackStart ? this.fallbackSpeechCount + 1 : 0;

      const hitStrictStart = !this._speaking && this.speechCount >= this.minSpeech;
      const hitFallbackStart = !this._speaking && this.fallbackSpeechCount >= this.fallbackMinSpeech;
      if (hitStrictStart || hitFallbackStart) {
        this._speaking = true;
        this.emit("speech_start", {
          mode: hitStrictStart ? "strict" : "fallback_energy",
          energy,
          zcr,
          crest,
          activeRatio,
        });
      }
    } else if (this._speaking) {
      this.silentCount++;
      if (this.silentCount >= this.speakingSilenceLimit) {
        this._speaking = false;
        this.speechCount = 0;
        this.silentCount = 0;
        this.fallbackSpeechCount = 0;
        this.emit("speech_end");
      }
    } else {
      // Gradual decay instead of hard reset — tolerates occasional
      // sibilant/unvoiced frames (high ZCR) during speech onset.
      this.speechCount = Math.max(0, this.speechCount - 1);
      this.fallbackSpeechCount = Math.max(0, this.fallbackSpeechCount - 1);
    }
  }

  reset(): void {
    this._speaking = false;
    this.speechCount = 0;
    this.silentCount = 0;
    this.fallbackSpeechCount = 0;
  }

  /** Update speaking silence frame threshold dynamically */
  setSpeakingSilenceFrames(frames: number): void {
    this.speakingSilenceLimit = Math.max(this.silenceLimit, frames);
  }
}

/** Root-mean-square of 16-bit LE PCM samples, normalised to 0–1. */
function rms(pcm: Buffer): number {
  const n = Math.floor(pcm.length / 2);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < pcm.length - 1; i += 2) {
    const s = pcm.readInt16LE(i) / 32768;
    sum += s * s;
  }
  return Math.sqrt(sum / n);
}

/**
 * Zero-crossing rate of 16-bit LE PCM, normalised to 0–1.
 * High values (>0.5) indicate impulsive noise; speech is typically <0.45.
 */
function zeroCrossingRate(pcm: Buffer): number {
  const n = Math.floor(pcm.length / 2);
  if (n < 2) return 0;
  let crossings = 0;
  let prev = pcm.readInt16LE(0);
  for (let i = 2; i < pcm.length - 1; i += 2) {
    const cur = pcm.readInt16LE(i);
    if ((prev >= 0 && cur < 0) || (prev < 0 && cur >= 0)) crossings++;
    prev = cur;
  }
  return crossings / (n - 1);
}

/** Peak / RMS — impulsive keyboard/mouse clicks in a mostly-quiet frame → very high. */
function crestFactor(pcm: Buffer): number {
  const n = Math.floor(pcm.length / 2);
  if (n === 0) return 1;
  let peak = 0;
  let sumSq = 0;
  for (let i = 0; i < pcm.length - 1; i += 2) {
    const s = pcm.readInt16LE(i) / 32768;
    const a = Math.abs(s);
    if (a > peak) peak = a;
    sumSq += s * s;
  }
  const rms = Math.sqrt(sumSq / n);
  if (rms < 1e-9) return 1;
  return peak / rms;
}

/**
 * Ratio of samples whose absolute amplitude is meaningfully above the noise floor.
 * Speech tends to occupy a wider spread of a frame; keyboard clicks are sparse transients.
 */
function activeSampleRatio(pcm: Buffer): number {
  const n = Math.floor(pcm.length / 2);
  if (n === 0) return 0;
  let peak = 0;
  const samples = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const s = pcm.readInt16LE(i * 2) / 32768;
    samples[i] = Math.round(s * 32768);
    const abs = Math.abs(s);
    if (abs > peak) peak = abs;
  }
  const floor = Math.max(0.008, peak * 0.18);
  let active = 0;
  for (let i = 0; i < n; i++) {
    const abs = Math.abs(samples[i] / 32768);
    if (abs >= floor) active++;
  }
  return active / n;
}
