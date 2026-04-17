export interface NormalizedPcmResult {
  pcm: Buffer;
  ingressSampleRate: number;
  normalizedSampleRate: number;
  resampled: boolean;
}

export function normalizeDuplexPcm16Mono(
  pcm: Buffer,
  ingressSampleRate: number,
  targetSampleRate = 16_000,
): NormalizedPcmResult {
  const safeIngressRate =
    Number.isFinite(ingressSampleRate) && ingressSampleRate > 0
      ? Math.floor(ingressSampleRate)
      : targetSampleRate;

  if (safeIngressRate === targetSampleRate || pcm.length === 0) {
    return {
      pcm,
      ingressSampleRate: safeIngressRate,
      normalizedSampleRate: targetSampleRate,
      resampled: false,
    };
  }

  return {
    pcm: resamplePcm16MonoLinear(pcm, safeIngressRate, targetSampleRate),
    ingressSampleRate: safeIngressRate,
    normalizedSampleRate: targetSampleRate,
    resampled: true,
  };
}

export function resamplePcm16MonoLinear(
  pcm: Buffer,
  fromSampleRate: number,
  toSampleRate: number,
): Buffer {
  if (pcm.length === 0 || fromSampleRate === toSampleRate) {
    return Buffer.from(pcm);
  }

  const inputSamples = Math.floor(pcm.length / 2);
  if (inputSamples <= 1) {
    return Buffer.from(pcm);
  }

  const outputSamples = Math.max(
    1,
    Math.round((inputSamples * toSampleRate) / fromSampleRate),
  );
  const out = Buffer.alloc(outputSamples * 2);

  for (let index = 0; index < outputSamples; index += 1) {
    const sourcePosition = (index * fromSampleRate) / toSampleRate;
    const leftIndex = Math.min(inputSamples - 1, Math.floor(sourcePosition));
    const rightIndex = Math.min(inputSamples - 1, leftIndex + 1);
    const mix = Math.max(0, Math.min(1, sourcePosition - leftIndex));
    const left = pcm.readInt16LE(leftIndex * 2);
    const right = pcm.readInt16LE(rightIndex * 2);
    const interpolated = Math.round(left + (right - left) * mix);
    const clamped = Math.max(-32768, Math.min(32767, interpolated));
    out.writeInt16LE(clamped, index * 2);
  }

  return out;
}
