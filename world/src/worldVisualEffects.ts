export interface VisualEffectFrame {
  lampIntensity: number;
  lampGlowScale: number;
  smokeAlpha: number;
  smokeLift: number;
  smokeSway: number;
  waterAlpha: number;
  waterGlow: number;
  previewAlpha: number;
}

export function getVisualEffectFrame(seconds: number): VisualEffectFrame {
  const lampWave = wave(seconds, 1.35, 0.6);
  const smokeWave = wave(seconds, 0.42, 1.1);
  const waterWave = wave(seconds, 0.28, 0.2);
  const previewWave = wave(seconds, 1.1, 2.4);

  return {
    lampIntensity: 0.95 + lampWave * 0.13,
    lampGlowScale: 1 + lampWave * 0.08,
    smokeAlpha: 0.36 + smokeWave * 0.12,
    smokeLift: normalize(seconds * 0.18) * 0.72,
    smokeSway: smokeWave * 0.11,
    waterAlpha: 0.66 + waterWave * 0.08,
    waterGlow: 0.5 + waterWave * 0.12,
    previewAlpha: 0.48 + previewWave * 0.14,
  };
}

function wave(seconds: number, speed: number, phase: number) {
  return Math.sin(seconds * speed + phase);
}

function normalize(value: number) {
  return value - Math.floor(value);
}
