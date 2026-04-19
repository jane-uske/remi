import type { AvatarFrameState, LipSignal } from "@/types/avatar";

type VisemeName = NonNullable<LipSignal["viseme"]>["name"];

export type Live2DModelParameterIds = {
  mouthOpen: string[];
  mouthForm: string[];
  angleX: string[];
  angleY: string[];
  bodyAngleX: string[];
  eyeBallX: string[];
  eyeBallY: string[];
  eyeLOpen: string[];
  eyeROpen: string[];
};

export type Live2DLipProfile = {
  frameFreshMs: number;
  frameGain: number;
  envelopeGain: number;
  visemeGain: number;
  voiceFloor: number;
  attackMs: number;
  releaseMs: number;
  formAttackMs: number;
  formReleaseMs: number;
  minOpen: number;
  maxOpen: number;
  prepareFloorScale: number;
  prepareMaxOpen: number;
  tailFloorScale: number;
  yieldMaxOpen: number;
  formBlend: number;
  visemeForm: Partial<Record<VisemeName, number>>;
  visemeOpenBoost: Partial<Record<VisemeName, number>>;
};

export type Live2DModelProfile = {
  id: string;
  label: string;
  parameterIds: Live2DModelParameterIds;
  lip: Live2DLipProfile;
};

const DEFAULT_PARAMETER_IDS: Live2DModelParameterIds = {
  mouthOpen: ["ParamMouthOpenY", "ParamMouthOpen"],
  mouthForm: ["ParamMouthForm"],
  angleX: ["ParamAngleX"],
  angleY: ["ParamAngleY"],
  bodyAngleX: ["ParamBodyAngleX"],
  eyeBallX: ["ParamEyeBallX"],
  eyeBallY: ["ParamEyeBallY"],
  eyeLOpen: ["ParamEyeLOpen"],
  eyeROpen: ["ParamEyeROpen"],
};

const DEFAULT_VISEME_FORM: Partial<Record<VisemeName, number>> = {
  sil: 0,
  aa: 0.08,
  ee: 0.58,
  ih: 0.3,
  oh: -0.36,
  oo: -0.62,
  ss: 0.22,
  sh: 0.14,
  ff: 0.06,
  th: 0.04,
  nn: 0.1,
  rr: -0.06,
  dd: 0.06,
  kk: -0.02,
  pp: 0.02,
  ch: 0.12,
};

const DEFAULT_VISEME_OPEN_BOOST: Partial<Record<VisemeName, number>> = {
  aa: 0.18,
  oh: 0.12,
  oo: 0.08,
  ee: 0.06,
  ih: 0.05,
};

const DEFAULT_STANDARD_PROFILE: Live2DModelProfile = {
  id: "default-standard",
  label: "Default Standard",
  parameterIds: DEFAULT_PARAMETER_IDS,
  lip: {
    frameFreshMs: 220,
    frameGain: 1,
    envelopeGain: 1,
    visemeGain: 1,
    voiceFloor: 0.08,
    attackMs: 54,
    releaseMs: 132,
    formAttackMs: 48,
    formReleaseMs: 120,
    minOpen: 0,
    maxOpen: 0.92,
    prepareFloorScale: 0.72,
    prepareMaxOpen: 0.24,
    tailFloorScale: 0.7,
    yieldMaxOpen: 0.04,
    formBlend: 0.62,
    visemeForm: DEFAULT_VISEME_FORM,
    visemeOpenBoost: DEFAULT_VISEME_OPEN_BOOST,
  },
};

const LIVE2D_MODEL_PROFILES: Record<string, Live2DModelProfile> = {
  "hiyori-pro": {
    id: "hiyori-pro",
    label: "Hiyori Momose (Pro)",
    parameterIds: {
      mouthOpen: ["ParamMouthOpenY"],
      mouthForm: ["ParamMouthForm"],
      angleX: ["ParamAngleX"],
      angleY: ["ParamAngleY"],
      bodyAngleX: ["ParamBodyAngleX"],
      eyeBallX: ["ParamEyeBallX"],
      eyeBallY: ["ParamEyeBallY"],
      eyeLOpen: ["ParamEyeLOpen"],
      eyeROpen: ["ParamEyeROpen"],
    },
    lip: {
      frameFreshMs: 220,
      frameGain: 1.08,
      envelopeGain: 1.14,
      visemeGain: 1.05,
      voiceFloor: 0.1,
      attackMs: 44,
      releaseMs: 126,
      formAttackMs: 40,
      formReleaseMs: 108,
      minOpen: 0,
      maxOpen: 0.86,
      prepareFloorScale: 0.78,
      prepareMaxOpen: 0.22,
      tailFloorScale: 0.68,
      yieldMaxOpen: 0.035,
      formBlend: 0.72,
      visemeForm: {
        ...DEFAULT_VISEME_FORM,
        ee: 0.64,
        ih: 0.34,
        oh: -0.42,
        oo: -0.68,
      },
      visemeOpenBoost: {
        ...DEFAULT_VISEME_OPEN_BOOST,
        aa: 0.2,
        oh: 0.14,
        oo: 0.1,
      },
    },
  },
  haru: {
    id: "haru",
    label: "Haru Sample",
    parameterIds: DEFAULT_PARAMETER_IDS,
    lip: {
      ...DEFAULT_STANDARD_PROFILE.lip,
      voiceFloor: 0.07,
      attackMs: 52,
      releaseMs: 138,
      formBlend: 0.56,
    },
  },
};

export type Live2DLipFrame = AvatarFrameState["lipSync"];

export function getLive2DModelProfile(modelId: string): Live2DModelProfile | null {
  return LIVE2D_MODEL_PROFILES[modelId] ?? null;
}

export function resolveLive2DModelProfile(
  modelId?: string | null,
): Live2DModelProfile {
  if (typeof modelId === "string" && modelId.trim() !== "") {
    const resolved = getLive2DModelProfile(modelId.trim());
    if (resolved) return resolved;
  }

  return DEFAULT_STANDARD_PROFILE;
}
