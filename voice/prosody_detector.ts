export interface ProsodySample {
  at: number;
  rms: number;
  voiced: boolean;
  pitchHz: number | null;
  pitchConfidence: number;
}

export interface ProsodySummary {
  reliable: boolean;
  voicedRatio: number;
  voicedTailFrames: number;
  pitchFrames: number;
  pitchConfidence: number;
  pitchSlopeHz: number | null;
  tailEnergyDrop: number | null;
  risingTail: boolean;
  fallingTail: boolean;
  sustainedVoicedTail: boolean;
}

type PitchResult = {
  voiced: boolean;
  pitchHz: number | null;
  confidence: number;
};

const MIN_PITCH_DETECT_SAMPLES = 96;
const MIN_PITCH_DETECT_SAMPLE_RATE = 4_000;
const MIN_VOICED_RMS = 0.015;
const MIN_PITCH_HZ = 80;
const MAX_PITCH_HZ = 420;
const MIN_PITCH_CONFIDENCE = 0.58;
const MIN_LAG_SAMPLES = 12;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function pcmToFloat32(pcm: Buffer): Float32Array {
  const samples = Math.floor(pcm.length / 2);
  const float32 = new Float32Array(samples);
  for (let i = 0; i < samples; i += 1) {
    float32[i] = pcm.readInt16LE(i * 2) / 32768;
  }
  return float32;
}

function computeRms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i];
    sum += sample * sample;
  }
  return Math.sqrt(sum / samples.length);
}

function centerSignal(samples: Float32Array): { centered: Float32Array; energy: number } {
  if (samples.length === 0) {
    return { centered: samples, energy: 0 };
  }

  let mean = 0;
  for (let i = 0; i < samples.length; i += 1) {
    mean += samples[i];
  }
  mean /= samples.length;

  const centered = new Float32Array(samples.length);
  let energy = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const value = samples[i] - mean;
    centered[i] = value;
    energy += value * value;
  }

  return { centered, energy };
}

function estimatePitch(float32: Float32Array, sampleRate: number, rms: number): PitchResult {
  if (
    float32.length < MIN_PITCH_DETECT_SAMPLES ||
    sampleRate < MIN_PITCH_DETECT_SAMPLE_RATE ||
    rms < MIN_VOICED_RMS
  ) {
    return { voiced: false, pitchHz: null, confidence: 0 };
  }

  const { centered, energy } = centerSignal(float32);
  if (energy <= 1e-6) {
    return { voiced: false, pitchHz: null, confidence: 0 };
  }

  const minLag = Math.max(MIN_LAG_SAMPLES, Math.floor(sampleRate / MAX_PITCH_HZ));
  const maxLag = Math.min(Math.floor(sampleRate / MIN_PITCH_HZ), Math.floor(centered.length / 2));
  if (maxLag <= minLag) {
    return { voiced: false, pitchHz: null, confidence: 0 };
  }

  let bestLag = 0;
  let bestCorrelation = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let correlation = 0;
    let leftEnergy = 0;
    let rightEnergy = 0;
    for (let i = 0; i + lag < centered.length; i += 1) {
      const left = centered[i];
      const right = centered[i + lag];
      correlation += left * right;
      leftEnergy += left * left;
      rightEnergy += right * right;
    }

    if (leftEnergy <= 1e-6 || rightEnergy <= 1e-6) {
      continue;
    }

    const normalizedCorrelation = correlation / Math.sqrt(leftEnergy * rightEnergy);
    if (normalizedCorrelation > bestCorrelation) {
      bestCorrelation = normalizedCorrelation;
      bestLag = lag;
    }
  }

  const confidence = clamp01(bestCorrelation);
  const pitchHz =
    bestLag > 0 && confidence >= MIN_PITCH_CONFIDENCE ? sampleRate / bestLag : null;

  if (pitchHz === null || !Number.isFinite(pitchHz)) {
    return {
      voiced: false,
      pitchHz: null,
      confidence,
    };
  }

  if (pitchHz < MIN_PITCH_HZ || pitchHz > MAX_PITCH_HZ) {
    return {
      voiced: false,
      pitchHz: null,
      confidence,
    };
  }

  return {
    voiced: true,
    pitchHz,
    confidence,
  };
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function appendProsodySample(
  samples: ProsodySample[],
  pcm: Buffer,
  sampleRate: number,
  maxSamples: number,
  at: number = Date.now(),
): ProsodySample[] {
  const float32 = pcmToFloat32(pcm);
  const rms = computeRms(float32);
  const estimated = estimatePitch(float32, sampleRate, rms);
  const next = [
    ...samples,
    {
      at,
      rms,
      voiced: estimated.voiced,
      pitchHz: estimated.pitchHz,
      pitchConfidence: estimated.confidence,
    },
  ];
  if (next.length > maxSamples) {
    next.splice(0, next.length - maxSamples);
  }
  return next;
}

export function summarizeProsody(samples: ProsodySample[]): ProsodySummary | null {
  if (samples.length < 3) return null;

  const voiced = samples.filter((sample) => sample.voiced);
  const pitched = voiced.filter((sample) => typeof sample.pitchHz === "number");
  const tail = samples.slice(-4);
  const tailVoiced = tail.filter((sample) => sample.voiced);
  const tailPitched = tailVoiced.filter((sample) => typeof sample.pitchHz === "number");
  const pitchedTailValues = tailPitched.map((sample) => sample.pitchHz as number);
  const prevPitchedValues = pitched
    .slice(Math.max(0, pitched.length - 4), Math.max(0, pitched.length - 2))
    .map((sample) => sample.pitchHz as number);
  const tailPitchMean = average(pitchedTailValues.slice(-2));
  const prevPitchMean = average(prevPitchedValues);
  const pitchSlopeHz =
    tailPitchMean !== null && prevPitchMean !== null ? tailPitchMean - prevPitchMean : null;

  const tailRmsMean = average(tail.map((sample) => sample.rms));
  const prevRmsMean = average(
    samples
      .slice(Math.max(0, samples.length - 6), Math.max(0, samples.length - 2))
      .map((sample) => sample.rms),
  );
  const tailEnergyDrop =
    tailRmsMean !== null && prevRmsMean !== null ? prevRmsMean - tailRmsMean : null;

  const voicedRatio = voiced.length / samples.length;
  const voicedTailFrames = tailVoiced.length;
  const pitchConfidence = average(pitched.map((sample) => sample.pitchConfidence)) ?? 0;
  const sustainedVoicedTail =
    tail.length >= 3 &&
    voicedTailFrames >= 3 &&
    tailPitched.length >= 2 &&
    tailVoiced.every((sample) => sample.rms >= 0.02);
  const reliable = pitched.length >= 3 && voicedRatio >= 0.45 && pitchConfidence >= 0.6;
  const risingTail = reliable && pitchSlopeHz !== null && pitchSlopeHz >= 18;
  const fallingTail = reliable && pitchSlopeHz !== null && pitchSlopeHz <= -10;

  return {
    reliable,
    voicedRatio,
    voicedTailFrames,
    pitchFrames: pitched.length,
    pitchConfidence,
    pitchSlopeHz,
    tailEnergyDrop,
    risingTail,
    fallingTail,
    sustainedVoicedTail,
  };
}
