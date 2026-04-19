import type { AvatarFrameState, LipSignal } from "@/types/avatar";
import type { ConversationPerformanceModel } from "@/lib/presence/conversationPerformanceModel";
import type { Live2DModelProfile } from "./live2dModelProfile";

export type Live2DLipCalibrationState = {
  mouthOpen: number;
  mouthForm: number;
  lastUpdatedAtMs: number;
};

export type SampleLive2DLipCalibrationInput = {
  nowMs: number;
  previous?: Live2DLipCalibrationState | null;
  profile: Live2DModelProfile;
  baseMouthOpen: number;
  baseMouthForm: number;
  frameLipSync?: AvatarFrameState["lipSync"] | null;
  frameLipAtMs?: number;
  envelope: number;
  voiceActive: boolean;
  viseme?: LipSignal["viseme"] | null;
  performanceModel?: ConversationPerformanceModel | null;
};

export type Live2DLipCalibrationOutput = {
  mouthOpen: number;
  mouthForm: number;
  state: Live2DLipCalibrationState;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function smoothValue(
  current: number,
  target: number,
  dtMs: number,
  attackMs: number,
  releaseMs: number,
): number {
  const duration = target >= current ? attackMs : releaseMs;
  const alpha = clamp(dtMs / Math.max(duration, 1), 0, 1);
  return current + (target - current) * alpha;
}

function resolveOpenAttackMs(
  performanceModel: ConversationPerformanceModel | null | undefined,
  profile: Live2DModelProfile,
): number {
  if (performanceModel?.phase === "speaking_prepare") {
    return Math.max(18, profile.lip.attackMs * 0.5);
  }

  return profile.lip.attackMs;
}

function resolvePhaseFloor(
  performanceModel: ConversationPerformanceModel | null | undefined,
  profile: Live2DModelProfile,
): { floor: number; maxOpen: number } {
  if (!performanceModel) {
    return { floor: 0, maxOpen: profile.lip.maxOpen };
  }

  switch (performanceModel.phase) {
    case "speaking_prepare":
      return {
        floor: performanceModel.avatarSync.mouthFloor * profile.lip.prepareFloorScale,
        maxOpen: profile.lip.prepareMaxOpen,
      };
    case "speaking_tail":
      return {
        floor: performanceModel.avatarSync.mouthFloor * profile.lip.tailFloorScale,
        maxOpen: profile.lip.maxOpen,
      };
    case "yield":
      return {
        floor: 0,
        maxOpen: profile.lip.yieldMaxOpen,
      };
    default:
      return {
        floor: performanceModel.avatarSync.mouthFloor,
        maxOpen: profile.lip.maxOpen,
      };
  }
}

export function sampleLive2DLipCalibration(
  input: SampleLive2DLipCalibrationInput,
): Live2DLipCalibrationOutput {
  const {
    nowMs,
    previous,
    profile,
    baseMouthOpen,
    baseMouthForm,
    frameLipSync,
    frameLipAtMs = frameLipSync?.time ?? 0,
    envelope,
    voiceActive,
    viseme,
    performanceModel,
  } = input;

  const prevState: Live2DLipCalibrationState = previous ?? {
    mouthOpen: 0,
    mouthForm: 0,
    lastUpdatedAtMs: nowMs - 16,
  };
  const dtMs = clamp(nowMs - prevState.lastUpdatedAtMs, 8, 120);
  const phasePolicy = resolvePhaseFloor(performanceModel, profile);

  const freshFrame =
    frameLipSync && nowMs - frameLipAtMs <= profile.lip.frameFreshMs
      ? frameLipSync
      : null;
  const activeViseme = freshFrame?.viseme ?? viseme?.name ?? null;
  const visemeWeight = freshFrame
    ? clamp(freshFrame.weight * profile.lip.frameGain, 0, 1)
    : clamp((viseme?.weight ?? 0) * profile.lip.visemeGain, 0, 1);

  const frameTarget = freshFrame
    ? clamp(freshFrame.weight * profile.lip.frameGain, 0, profile.lip.maxOpen)
    : 0;
  const envelopeTarget = clamp(
    envelope * profile.lip.envelopeGain,
    0,
    profile.lip.maxOpen,
  );
  const voiceFloorTarget = voiceActive ? profile.lip.voiceFloor : 0;
  const visemeBoost =
    activeViseme != null
      ? (profile.lip.visemeOpenBoost[activeViseme] ?? 0) * visemeWeight
      : 0;

  let targetOpen = Math.max(
    baseMouthOpen,
    phasePolicy.floor,
    frameTarget,
    envelopeTarget,
    voiceFloorTarget,
    visemeWeight + visemeBoost,
  );
  targetOpen = clamp(targetOpen, profile.lip.minOpen, phasePolicy.maxOpen);

  if (performanceModel?.phase === "yield") {
    targetOpen = Math.min(targetOpen, profile.lip.yieldMaxOpen);
  }

  const visemeForm =
    activeViseme != null ? profile.lip.visemeForm[activeViseme] ?? 0 : 0;
  const targetForm = clamp(
    baseMouthForm + visemeForm * visemeWeight * profile.lip.formBlend,
    -1,
    1,
  );

  const mouthOpen = round2(
    clamp(
      smoothValue(
        prevState.mouthOpen,
        targetOpen,
        dtMs,
        resolveOpenAttackMs(performanceModel, profile),
        profile.lip.releaseMs,
      ),
      0,
      1,
    ),
  );
  const mouthForm = round2(
    clamp(
      smoothValue(
        prevState.mouthForm,
        targetForm,
        dtMs,
        profile.lip.formAttackMs,
        profile.lip.formReleaseMs,
      ),
      -1,
      1,
    ),
  );

  return {
    mouthOpen,
    mouthForm,
    state: {
      mouthOpen,
      mouthForm,
      lastUpdatedAtMs: nowMs,
    },
  };
}
