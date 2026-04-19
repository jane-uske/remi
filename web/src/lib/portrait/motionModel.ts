import type {
  AvatarRenderModel,
  PortraitMotionPhase,
} from "@/runtime/avatarRenderModel";

export type PortraitMotionFrame = {
  motionPhase: PortraitMotionPhase;
  gaze: { x: number; y: number };
  eyeScale: number;
  breathOffset: number;
  rootTransform: string;
  mouthLevelFloor: number;
};

type PhaseConfig = {
  gazeRangeX: number;
  gazeRangeY: number;
  gazeBiasX: number;
  gazeBiasY: number;
  blinkIntervalMs: number;
  blinkDurationMs: number;
  blinkStrength: number;
  breathBobPx: number;
  translateX: number;
  translateY: number;
  scale: number;
  rotateDeg: number;
  mouthLevelFloor: number;
};

const PHASE_CONFIG: Record<PortraitMotionPhase, PhaseConfig> = {
  idle: {
    gazeRangeX: 1.2,
    gazeRangeY: 0.8,
    gazeBiasX: 0,
    gazeBiasY: 0,
    blinkIntervalMs: 3600,
    blinkDurationMs: 210,
    blinkStrength: 0.18,
    breathBobPx: 0.9,
    translateX: 0.7,
    translateY: -0.8,
    scale: 0.004,
    rotateDeg: 0.35,
    mouthLevelFloor: 0,
  },
  listening: {
    gazeRangeX: 0.45,
    gazeRangeY: 0.35,
    gazeBiasX: 0.35,
    gazeBiasY: -0.12,
    blinkIntervalMs: 4300,
    blinkDurationMs: 170,
    blinkStrength: 0.12,
    breathBobPx: 1.15,
    translateX: 0.55,
    translateY: -0.55,
    scale: 0.003,
    rotateDeg: 0.22,
    mouthLevelFloor: 0,
  },
  open_mic_idle: {
    gazeRangeX: 0.75,
    gazeRangeY: 0.55,
    gazeBiasX: 0.15,
    gazeBiasY: 0.1,
    blinkIntervalMs: 3900,
    blinkDurationMs: 185,
    blinkStrength: 0.14,
    breathBobPx: 1.05,
    translateX: 0.35,
    translateY: -0.3,
    scale: 0.002,
    rotateDeg: 0.15,
    mouthLevelFloor: 0,
  },
  thinking: {
    gazeRangeX: 0.2,
    gazeRangeY: 0.18,
    gazeBiasX: -0.08,
    gazeBiasY: 0.45,
    blinkIntervalMs: 4700,
    blinkDurationMs: 240,
    blinkStrength: 0.24,
    breathBobPx: 0.45,
    translateX: -0.25,
    translateY: 0.55,
    scale: -0.003,
    rotateDeg: -0.18,
    mouthLevelFloor: 0,
  },
  speaking_prepare: {
    gazeRangeX: 0.28,
    gazeRangeY: 0.16,
    gazeBiasX: -0.2,
    gazeBiasY: -0.35,
    blinkIntervalMs: 3000,
    blinkDurationMs: 150,
    blinkStrength: 0.14,
    breathBobPx: 0.8,
    translateX: 0.35,
    translateY: -0.9,
    scale: 0.004,
    rotateDeg: -0.1,
    mouthLevelFloor: 0.06,
  },
  speaking_active: {
    gazeRangeX: 0.35,
    gazeRangeY: 0.2,
    gazeBiasX: 0.1,
    gazeBiasY: -0.04,
    blinkIntervalMs: 3500,
    blinkDurationMs: 175,
    blinkStrength: 0.12,
    breathBobPx: 0.7,
    translateX: 0.45,
    translateY: -0.45,
    scale: 0.003,
    rotateDeg: 0.15,
    mouthLevelFloor: 0,
  },
  speaking_tail: {
    gazeRangeX: 0.48,
    gazeRangeY: 0.24,
    gazeBiasX: -0.45,
    gazeBiasY: 0.08,
    blinkIntervalMs: 3200,
    blinkDurationMs: 190,
    blinkStrength: 0.18,
    breathBobPx: 0.55,
    translateX: -0.25,
    translateY: 0.45,
    scale: -0.002,
    rotateDeg: 0.22,
    mouthLevelFloor: 0.045,
  },
  yield: {
    gazeRangeX: 0.16,
    gazeRangeY: 0.16,
    gazeBiasX: -0.4,
    gazeBiasY: 0.85,
    blinkIntervalMs: 2600,
    blinkDurationMs: 165,
    blinkStrength: 0.22,
    breathBobPx: 0.35,
    translateX: -0.8,
    translateY: 0.85,
    scale: -0.004,
    rotateDeg: 0.42,
    mouthLevelFloor: 0,
  },
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function oscillate(nowMs: number, periodMs: number, phaseShift = 0): number {
  if (!Number.isFinite(nowMs) || !Number.isFinite(periodMs) || periodMs <= 0) {
    return 0;
  }

  return Math.sin((nowMs / periodMs) * Math.PI * 2 + phaseShift);
}

function blinkPulse(
  nowMs: number,
  intervalMs: number,
  durationMs: number,
): number {
  if (
    !Number.isFinite(nowMs) ||
    !Number.isFinite(intervalMs) ||
    !Number.isFinite(durationMs) ||
    intervalMs <= 0 ||
    durationMs <= 0
  ) {
    return 0;
  }

  const phaseMs = ((nowMs % intervalMs) + intervalMs) % intervalMs;
  if (phaseMs > durationMs) return 0;
  return Math.sin((phaseMs / durationMs) * Math.PI);
}

function toTransformString(input: {
  translateX: number;
  translateY: number;
  scale: number;
  rotateDeg: number;
}): string {
  return `translate3d(${round2(input.translateX)}px, ${round2(input.translateY)}px, 0) scale(${round2(input.scale)}) rotate(${round2(input.rotateDeg)}deg)`;
}

export function samplePortraitMotionFrame(
  renderModel: AvatarRenderModel,
  nowMs: number,
): PortraitMotionFrame {
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : 0;
  const phase = renderModel.motionPhase;
  const config = PHASE_CONFIG[phase];
  const driftFast = oscillate(safeNowMs, 2200, 0.25);
  const driftSlow = oscillate(safeNowMs, 4100, 1.05);
  const breathWave = oscillate(safeNowMs, 3300, 0.8);
  const blinkWave =
    blinkPulse(safeNowMs, config.blinkIntervalMs, config.blinkDurationMs) *
    config.blinkStrength;

  const gaze = {
    x: round2(
      renderModel.gazeX +
        config.gazeBiasX +
        driftFast * config.gazeRangeX +
        driftSlow * config.gazeRangeX * 0.45,
    ),
    y: round2(
      renderModel.gazeY +
        config.gazeBiasY +
        driftSlow * config.gazeRangeY +
        driftFast * config.gazeRangeY * 0.35,
    ),
  };

  const eyeScale = round2(Math.max(0.72, 1 - clamp01(renderModel.blink + blinkWave)));
  const breathOffset = Math.round(renderModel.breath * 8 + breathWave * config.breathBobPx);
  const rootTransform = toTransformString({
    translateX:
      renderModel.posture.translateX +
      driftSlow * config.translateX +
      breathWave * config.translateX * 0.35,
    translateY:
      renderModel.posture.translateY +
      breathWave * config.translateY +
      driftFast * config.translateY * 0.2,
    scale:
      renderModel.posture.scale +
      breathWave * config.scale +
      driftSlow * config.scale * 0.35,
    rotateDeg:
      renderModel.posture.rotateDeg +
      driftFast * config.rotateDeg +
      driftSlow * config.rotateDeg * 0.4,
  });
  const mouthLevelFloor = round2(
    Math.max(0, config.mouthLevelFloor + (phase === "speaking_prepare" ? 0.008 : 0) * Math.max(0, breathWave)),
  );

  return {
    motionPhase: phase,
    gaze,
    eyeScale,
    breathOffset,
    rootTransform,
    mouthLevelFloor,
  };
}
