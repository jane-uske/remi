import type {
  AvatarIntent,
  AvatarIntentFacialAccent,
  AvatarIntentGesture,
  AvatarIntentSource,
  AvatarIntentBeat,
  Emotion,
  FaceParams,
  InterruptionType,
  LipSyncFrame,
  RemiTurnState,
  RemiTurnStateReason,
  TtsLipCue,
  TtsLipSyncMode,
  TtsLipSyncSource,
  Viseme,
} from "../../../avatar/types";

export type RemiState = "idle" | "listening" | "thinking" | "speaking";
export type RemState = RemiState;

export type AvatarEngine = "live2d" | "vrm";
export type AvatarModelSource = "env" | "remote_url" | "public_asset";
export type AvatarRuntimeLoadState = "loading" | "ready" | "error";

export type AvatarCharacterSpec = {
  id: string;
  engine: AvatarEngine;
  displayName: string;
  modelId?: string;
  modelUrl: string;
  modelSource: AvatarModelSource;
  fallbackEngine: AvatarEngine;
  fallbackModelUrl: string;
  supportsVoiceMotion: boolean;
  supportsLookAt: boolean;
};

export type AvatarModelPreset = "remi" | "seed-san";

export type AvatarActionCommand = {
  action: string;
  intensity: number;
  duration: number;
};

export type AvatarFaceOverlay = Partial<FaceParams>;

export type {
  AvatarIntent,
  AvatarIntentBeat,
  AvatarIntentFacialAccent,
  AvatarIntentGesture,
  AvatarIntentSource,
  InterruptionType,
  RemiTurnState,
  RemiTurnStateReason,
};

export type AvatarFrameState = {
  emotion?: Emotion;
  face?: AvatarFaceOverlay;
  lipSync?: LipSyncFrame;
  lipSyncAtMs?: number;
};

export type TtsLipSyncPatch = {
  generationId: number;
  source: TtsLipSyncSource;
  mode: TtsLipSyncMode;
  complete: boolean;
  cues: TtsLipCue[];
};

export type LipSignal = {
  envelope: number;
  active: boolean;
  viseme?: {
    name: Viseme;
    weight: number;
  } | null;
};

export type { TtsLipCue, TtsLipSyncMode, TtsLipSyncSource, Viseme };
