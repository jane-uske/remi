import {
  fallbackNoiseSuppressMinRms,
  fallbackStrongFramePeak,
  fallbackStrongFrameRms,
} from "./runtime_config";

const NO_VAD_FALLBACK_MAX_CREST = 6;
const NO_VAD_FALLBACK_MIN_ACTIVE_RATIO = 0.16;

export function pcmCrestFactor(pcm: Buffer): number {
  const samples = Math.floor(pcm.length / 2);
  if (samples === 0) return 1;
  let peak = 0;
  let sumSq = 0;
  for (let i = 0; i < pcm.length - 1; i += 2) {
    const sample = pcm.readInt16LE(i) / 32768;
    const abs = Math.abs(sample);
    if (abs > peak) peak = abs;
    sumSq += sample * sample;
  }
  const rms = Math.sqrt(sumSq / samples);
  if (rms < 1e-9) return 1;
  return peak / rms;
}

export function pcmActiveSampleRatio(pcm: Buffer): number {
  const samples = Math.floor(pcm.length / 2);
  if (samples === 0) return 0;
  let peak = 0;
  const values = new Int16Array(samples);
  for (let i = 0; i < samples; i++) {
    const sample = pcm.readInt16LE(i * 2) / 32768;
    values[i] = Math.round(sample * 32768);
    peak = Math.max(peak, Math.abs(sample));
  }
  const floor = Math.max(0.008, peak * 0.18);
  let active = 0;
  for (let i = 0; i < samples; i++) {
    const abs = Math.abs(values[i] / 32768);
    if (abs >= floor) active += 1;
  }
  return active / samples;
}

export function isNoVadFallbackSpeechLikeFrame(
  pcm: Buffer,
  rms: number,
  peak: number,
): boolean {
  if (rms < fallbackStrongFrameRms() && peak < fallbackStrongFramePeak()) {
    return false;
  }
  if (pcmCrestFactor(pcm) > NO_VAD_FALLBACK_MAX_CREST) return false;
  if (pcmActiveSampleRatio(pcm) < NO_VAD_FALLBACK_MIN_ACTIVE_RATIO) return false;
  return true;
}

export function appendChunkWithByteCap(
  chunks: Buffer[],
  totalBytes: number,
  chunk: Buffer,
  maxBytes: number,
): number {
  chunks.push(chunk);
  let nextBytes = totalBytes + chunk.length;
  while (nextBytes > maxBytes && chunks.length > 0) {
    const first = chunks.shift()!;
    nextBytes -= first.length;
  }
  return nextBytes;
}

interface NoVadFallbackDecisionInput {
  speechBufferLength: number;
  duplexRxFrames: number;
  duplexRxVadStarts: number;
  durationMs: number;
  rawStrongFrames: number;
  strongRatio: number;
  maxRms: number;
  minSpeechMs: number;
  minStrongFrames: number;
  minStrongRatio: number;
}

export function shouldAttemptNoVadDuplexFallback(
  input: NoVadFallbackDecisionInput,
): boolean {
  if (input.speechBufferLength > 0) return false;
  if (input.duplexRxFrames <= 0) return false;
  if (input.duplexRxVadStarts > 0) return false;
  if (input.durationMs < input.minSpeechMs) return false;
  if (input.rawStrongFrames < input.minStrongFrames) return false;
  if (input.strongRatio < input.minStrongRatio) return false;
  if (input.maxRms < fallbackNoiseSuppressMinRms()) return false;
  return true;
}
