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
  Viseme,
} from "../../../avatar/types";

export type RemiState = "idle" | "listening" | "thinking" | "speaking";
export type RemState = RemiState;

export type AvatarEngine = "vrm";

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

export type LipSignal = {
  envelope: number;
  active: boolean;
  viseme?: {
    name: Viseme;
    weight: number;
  } | null;
};
