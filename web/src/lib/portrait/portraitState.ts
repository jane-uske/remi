import type { Emotion } from "../../../../avatar/types";
import type {
  AvatarFrameState,
  AvatarIntent,
  RemiTurnState,
} from "@/types/avatar";
import type {
  AvatarRenderModel,
  PortraitMotionPhase,
} from "@/runtime/avatarRenderModel";
import { samplePortraitMotionFrame } from "@/lib/portrait/motionModel";

export type PortraitPresenceState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking";

export type PortraitGazeMode =
  | "soft"
  | "attentive"
  | "toward_message"
  | "lifted"
  | "downcast";

export type PortraitState = {
  emotion: Emotion;
  presenceState: PortraitPresenceState;
  mouthLevel: number;
  gazeMode: PortraitGazeMode;
  emphasis: 0 | 1 | 2 | 3;
};

export type PortraitDisplayModel = {
  emotion: Emotion;
  presenceState: PortraitPresenceState;
  motionPhase: PortraitMotionPhase;
  presenceLabel: string;
  companionLine: string;
  mouthLevel: number;
  mouthLevelFloor: number;
  gaze: { x: number; y: number };
  eyeScale: number;
  breathOffset: number;
  motion: string;
};

export type DerivePortraitStateInput = {
  renderModel?: AvatarRenderModel | null;
  emotion?: string | null;
  turnState?: RemiTurnState;
  avatarIntent?: AvatarIntent | null;
  avatarFrame?: AvatarFrameState | null;
  voiceActive?: boolean;
  busy?: boolean;
  userSpeaking?: boolean;
  recording?: boolean;
  nowMs?: number;
};

const VALID_EMOTIONS = new Set<Emotion>([
  "neutral",
  "happy",
  "curious",
  "shy",
  "sad",
]);

const FRESH_LIP_SYNC_MAX_AGE_MS = 220;

const PRESENCE_LABELS: Record<PortraitPresenceState, string> = {
  idle: "在这里",
  listening: "在听",
  thinking: "思考中",
  speaking: "说话中",
};

const GAZE = {
  soft: { x: 0, y: 0 },
  attentive: { x: 4, y: -2 },
  toward_message: { x: 6, y: 0 },
  lifted: { x: 1, y: -4 },
  downcast: { x: -1, y: 4 },
} as const;

const BREATH = {
  idle: 6,
  listening: 10,
  thinking: 4,
  speaking: 7,
} as const;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function eyeScaleFor(presenceState: PortraitPresenceState): number {
  switch (presenceState) {
    case "thinking":
      return 0.84;
    case "speaking":
      return 0.95;
    default:
      return 1;
  }
}

function bodyTransform(
  presenceState: PortraitPresenceState,
  emphasis: number,
): string {
  switch (presenceState) {
    case "listening":
      return `translate3d(10px, 2px, 0) scale(${1 + emphasis * 0.018}) rotate(-1.5deg)`;
    case "thinking":
      return "translate3d(4px, 5px, 0) scale(0.985) rotate(-1deg)";
    case "speaking":
      return `translate3d(8px, 0, 0) scale(${1 + emphasis * 0.02})`;
    default:
      return "translate3d(0, 0, 0) scale(1)";
  }
}

function stageCopy(
  presenceState: PortraitPresenceState,
  emotion: string,
): string {
  if (presenceState === "listening") return "我在听，你慢慢说。";
  if (presenceState === "thinking") return "让我想一下，我马上接上。";
  if (presenceState === "speaking") return "我在这里，不会让对话掉下去。";
  if (emotion === "happy") return "今天有什么想和我分享的？";
  if (emotion === "sad") return "不想硬撑的话，也可以先跟我说。";
  if (emotion === "curious") return "今天发生了什么新鲜事？";
  return "我会一直在这里接着聊。";
}

function normalizeEmotion(value?: string | null): Emotion | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();

  if (VALID_EMOTIONS.has(normalized as Emotion)) {
    return normalized as Emotion;
  }

  return null;
}

function resolveEmotion(input: DerivePortraitStateInput): Emotion {
  return (
    normalizeEmotion(input.avatarFrame?.emotion) ??
    normalizeEmotion(input.emotion) ??
    normalizeEmotion(input.avatarIntent?.emotion) ??
    "neutral"
  );
}

function resolveMouthLevel(input: DerivePortraitStateInput): number {
  const lipSync = input.avatarFrame?.lipSync;
  const lipSyncAtMs = input.avatarFrame?.lipSyncAtMs ?? lipSync?.time;

  if (
    lipSync &&
    lipSyncAtMs != null &&
    input.nowMs != null &&
    input.nowMs - lipSyncAtMs <= FRESH_LIP_SYNC_MAX_AGE_MS
  ) {
    return clamp01(lipSync.weight);
  }

  if (input.voiceActive) return 0.18;
  return 0;
}

function resolvePresenceState(
  input: DerivePortraitStateInput,
  mouthLevel: number,
): PortraitPresenceState {
  if (input.userSpeaking || input.recording) return "listening";

  switch (input.turnState) {
    case "listening_active":
    case "listening_hold":
      return "listening";
    case "assistant_speaking":
      return "speaking";
    case "likely_end":
    case "confirmed_end":
    case "assistant_entering":
    case "interrupted_by_user":
      return input.busy ? "thinking" : "idle";
    default:
      if (input.voiceActive || mouthLevel > 0.08) return "speaking";
      return input.busy ? "thinking" : "idle";
  }
}

function resolvePresenceStateFromRenderModel(
  renderModel: AvatarRenderModel,
): PortraitPresenceState {
  switch (renderModel.phase) {
    case "listening":
    case "reacting":
      return "listening";
    case "thinking":
      return "thinking";
    case "speaking":
      return "speaking";
    default:
      return "idle";
  }
}

function resolveGazeModeFromRenderModel(
  renderModel: AvatarRenderModel,
): PortraitGazeMode {
  if (renderModel.gazeY >= 3) return "downcast";
  if (renderModel.gazeY <= -3) return "lifted";
  if (renderModel.gazeX >= 4) return "toward_message";
  if (renderModel.phase === "listening" || renderModel.phase === "reacting") {
    return "attentive";
  }
  return "soft";
}

function resolveGazeMode(
  emotion: Emotion,
  presenceState: PortraitPresenceState,
): PortraitGazeMode {
  if (presenceState === "listening") return "attentive";
  if (presenceState === "speaking") return "toward_message";
  if (emotion === "curious") return "lifted";
  if (emotion === "sad" || emotion === "shy" || presenceState === "thinking") {
    return "downcast";
  }
  return "soft";
}

function resolveEmphasis(input: DerivePortraitStateInput): 0 | 1 | 2 | 3 {
  const emphasis = Math.max(
    input.avatarIntent?.energy ?? 0,
    input.avatarIntent?.gestureIntensity ?? 0,
  );

  if (emphasis >= 3) return 3;
  if (emphasis >= 2) return 2;
  if (emphasis >= 1) return 1;
  return 0;
}

function resolveFallbackMotionPhase(
  presenceState: PortraitPresenceState,
): PortraitMotionPhase {
  switch (presenceState) {
    case "listening":
      return "listening";
    case "thinking":
      return "thinking";
    case "speaking":
      return "speaking_active";
    default:
      return "idle";
  }
}

// TODO(phase-3): remove once all portrait callers pass runtime render input.
export function derivePortraitState(
  input: DerivePortraitStateInput,
): PortraitState {
  if (input.renderModel) {
    const emotion = normalizeEmotion(input.renderModel.emotion) ?? resolveEmotion(input);
    const presenceState = resolvePresenceStateFromRenderModel(input.renderModel);

    return {
      emotion,
      presenceState,
      mouthLevel:
        presenceState === "speaking" ? clamp01(input.renderModel.mouthOpen) : 0,
      gazeMode: resolveGazeModeFromRenderModel(input.renderModel),
      emphasis: resolveEmphasis(input),
    };
  }

  const emotion = resolveEmotion(input);
  const rawMouthLevel = resolveMouthLevel(input);
  const presenceState = resolvePresenceState(input, rawMouthLevel);
  const mouthLevel = presenceState === "speaking" ? rawMouthLevel : 0;

  return {
    emotion,
    presenceState,
    mouthLevel,
    gazeMode: resolveGazeMode(emotion, presenceState),
    emphasis: resolveEmphasis(input),
  };
}

export function buildPortraitDisplayModel(
  input: DerivePortraitStateInput,
): PortraitDisplayModel {
  if (input.renderModel) {
    const emotion =
      normalizeEmotion(input.renderModel.emotion) ?? resolveEmotion(input);
    const presenceState = resolvePresenceStateFromRenderModel(input.renderModel);
    const motionFrame = samplePortraitMotionFrame(
      input.renderModel,
      input.nowMs ?? 0,
    );

    return {
      emotion,
      presenceState,
      motionPhase: motionFrame.motionPhase,
      presenceLabel: input.renderModel.presenceLabel,
      companionLine: input.renderModel.companionLine,
      mouthLevel:
        motionFrame.motionPhase === "speaking_active"
          ? clamp01(input.renderModel.mouthOpen)
          : 0,
      mouthLevelFloor: motionFrame.mouthLevelFloor,
      gaze: motionFrame.gaze,
      eyeScale: motionFrame.eyeScale,
      breathOffset: motionFrame.breathOffset,
      motion: motionFrame.rootTransform,
    };
  }

  const portraitState = derivePortraitState(input);
  const motionPhase = resolveFallbackMotionPhase(portraitState.presenceState);

  return {
    emotion: portraitState.emotion,
    presenceState: portraitState.presenceState,
    motionPhase,
    presenceLabel: PRESENCE_LABELS[portraitState.presenceState],
    companionLine: stageCopy(
      portraitState.presenceState,
      portraitState.emotion,
    ),
    mouthLevel: portraitState.mouthLevel,
    mouthLevelFloor: 0,
    gaze: GAZE[portraitState.gazeMode],
    eyeScale: eyeScaleFor(portraitState.presenceState),
    breathOffset: BREATH[portraitState.presenceState],
    motion: bodyTransform(
      portraitState.presenceState,
      portraitState.emphasis,
    ),
  };
}
