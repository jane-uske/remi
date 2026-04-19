import type { AvatarIntentFacialAccent, AvatarIntentGesture } from "@/types/avatar";
import type { CanonicalAvatarState } from "./remiRuntimeAdapter";

export type PortraitMotionPhase =
  | "idle"
  | "listening"
  | "open_mic_idle"
  | "thinking"
  | "speaking_prepare"
  | "speaking_active"
  | "speaking_tail"
  | "yield";

export type AvatarRenderModel = {
  emotion: string;
  motionPhase: PortraitMotionPhase;
  phase: CanonicalAvatarState["phase"];
  phaseReason: CanonicalAvatarState["phaseReason"];
  presenceLabel: string;
  companionLine: string;
  mouthOpen: number;
  blink: number;
  smile: number;
  gazeX: number;
  gazeY: number;
  headYaw: number;
  headPitch: number;
  breath: number;
  posture: {
    translateX: number;
    translateY: number;
    scale: number;
    rotateDeg: number;
  };
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function emotionSmile(emotion: string): number {
  switch (emotion) {
    case "happy":
      return 0.44;
    case "shy":
      return 0.22;
    case "curious":
      return 0.16;
    case "sad":
      return 0.04;
    default:
      return 0.08;
  }
}

function accentSmile(accent: AvatarIntentFacialAccent | undefined): number {
  switch (accent) {
    case "soft_smile":
      return 0.18;
    case "sad_mouth":
      return -0.06;
    default:
      return 0;
  }
}

function baseGaze(
  state: CanonicalAvatarState,
): { gazeX: number; gazeY: number } {
  if (state.phase === "listening") return { gazeX: 4, gazeY: -2 };
  if (state.phase === "speaking") return { gazeX: 6, gazeY: 0 };
  if (state.phase === "thinking") return { gazeX: -1, gazeY: 4 };
  if (state.affect.emotion === "curious") return { gazeX: 1, gazeY: -4 };
  if (state.affect.emotion === "sad" || state.affect.emotion === "shy") {
    return { gazeX: -1, gazeY: 4 };
  }
  return { gazeX: 0, gazeY: 0 };
}

function gestureHeadAdjust(
  gesture: AvatarIntentGesture | undefined,
): { yaw: number; pitch: number; rotateDeg: number; translateX: number; translateY: number } {
  switch (gesture) {
    case "tilt_head":
      return { yaw: 0.22, pitch: 0.02, rotateDeg: -1.8, translateX: 6, translateY: 0 };
    case "lean_in":
      return { yaw: 0.08, pitch: -0.05, rotateDeg: -0.8, translateX: 10, translateY: -2 };
    case "shrink_in":
      return { yaw: -0.06, pitch: 0.16, rotateDeg: -1.2, translateX: -2, translateY: 6 };
    default:
      return { yaw: 0, pitch: 0, rotateDeg: 0, translateX: 0, translateY: 0 };
  }
}

function getRuntimePresenceLabel(state: CanonicalAvatarState): string {
  switch (state.phase) {
    case "listening":
      return "在听";
    case "thinking":
      return "思考中";
    case "speaking":
      return "说话中";
    case "reacting":
      return "在接话";
    default:
      return "在这里";
  }
}

function getRuntimeCompanionLine(state: CanonicalAvatarState): string {
  if (state.connection === "connecting") {
    return "我正在重新接上，不会把这段对话丢掉。";
  }
  if (state.connection === "closed") {
    return "我会尽快重新接上，不会把这段对话丢在这里。";
  }

  switch (state.phaseReason) {
    case "user_voice":
      return "我在听，你慢慢说。";
    case "user_hold":
      return "我先不抢话，等你把这句落稳。";
    case "awaiting_commit":
      return "我收到了，等最后这点声音落下来。";
    case "assistant_audio_prepare":
      return "我接上了，马上开口。";
    case "assistant_audio_active":
    case "assistant_audio_tail":
      return "我在这里，不会让对话掉下去。";
    case "assistant_text_streaming":
    case "awaiting_model":
      return "让我想一下，我马上接上。";
    case "user_interrupt":
      return "听到了，我先让给你。";
    case "open_mic_idle":
      return "我在线，等你继续。";
    default:
      break;
  }

  switch (state.affect.emotion) {
    case "happy":
      return "今天有什么想和我分享的？";
    case "sad":
      return "不想硬撑的话，也可以先跟我说。";
    case "curious":
      return "今天发生了什么新鲜事？";
    default:
      return "我会一直在这里接着聊。";
  }
}

function resolveMotionPhase(
  state: CanonicalAvatarState,
): PortraitMotionPhase {
  switch (state.phaseReason) {
    case "user_voice":
    case "user_hold":
      return "listening";
    case "open_mic_idle":
      return "open_mic_idle";
    case "awaiting_model":
    case "assistant_text_streaming":
      return "thinking";
    case "assistant_audio_prepare":
      return "speaking_prepare";
    case "assistant_audio_active":
      return "speaking_active";
    case "assistant_audio_tail":
      return "speaking_tail";
    case "user_interrupt":
      return "yield";
    default:
      break;
  }

  switch (state.phase) {
    case "listening":
      return "listening";
    case "thinking":
      return "thinking";
    case "speaking":
      return "speaking_active";
    case "reacting":
      return "yield";
    default:
      return "idle";
  }
}

export function buildAvatarRenderModel(
  state: CanonicalAvatarState,
): AvatarRenderModel {
  const gesture = state.affect.intent?.gesture;
  const energy = state.affect.intent?.energy ?? 0;
  const gestureIntensity = state.affect.intent?.gestureIntensity ?? 0;
  const accent = state.affect.intent?.facialAccent;
  const gaze = baseGaze(state);
  const gestureAdjust = gestureHeadAdjust(gesture);
  const mouthOpen = clamp01(
    Math.max(
      state.speech.mouthLevel,
      state.assistant.playbackTailActive ? 0.08 : 0,
      state.phaseReason === "assistant_audio_prepare" ? 0.05 : 0,
    ),
  );

  let blink = 0.02;
  if (state.phase === "thinking") blink = 0.16;
  if (state.phase === "speaking") blink = 0.06;

  let breath = 1;
  if (state.phase === "listening") breath = 1.12;
  if (state.phase === "thinking") breath = 0.82;
  if (state.phase === "speaking") breath = 1.04;

  let headYaw = gestureAdjust.yaw;
  let headPitch = gestureAdjust.pitch;
  const posture = {
    translateX: gestureAdjust.translateX,
    translateY: gestureAdjust.translateY,
    scale: 1,
    rotateDeg: gestureAdjust.rotateDeg,
  };

  if (state.phaseReason === "user_hold") {
    headYaw += 0.14;
    posture.rotateDeg -= 1.4;
    posture.translateX += 8;
  } else if (state.phaseReason === "open_mic_idle") {
    headYaw += 0.02;
    posture.translateY += 2;
  } else if (state.phaseReason === "assistant_audio_prepare") {
    headPitch -= 0.08;
    posture.translateY -= 1;
    posture.scale += 0.01;
  } else if (state.phaseReason === "assistant_audio_tail") {
    headYaw -= 0.04;
    posture.rotateDeg += 0.4;
  }

  if (state.phase === "listening") {
    posture.translateX += 10;
    posture.translateY += 2;
    posture.scale += energy * 0.006 + 0.01;
    posture.rotateDeg -= 1.5;
  } else if (state.phase === "thinking") {
    posture.translateX += 4;
    posture.translateY += 5;
    posture.scale = Math.max(0.96, posture.scale - 0.015);
    posture.rotateDeg -= 1;
    headPitch += 0.12;
  } else if (state.phase === "speaking") {
    posture.translateX += 8;
    posture.scale += 0.012 + energy * 0.008 + gestureIntensity * 0.004;
  }

  if (state.affect.emotion === "sad" || gesture === "shrink_in") {
    gaze.gazeY += 1;
    headPitch += 0.06;
  }

  return {
    emotion: state.affect.emotion,
    motionPhase: resolveMotionPhase(state),
    phase: state.phase,
    phaseReason: state.phaseReason,
    presenceLabel: getRuntimePresenceLabel(state),
    companionLine: getRuntimeCompanionLine(state),
    mouthOpen,
    blink,
    smile: Math.max(0, emotionSmile(state.affect.emotion) + accentSmile(accent)),
    gazeX: gaze.gazeX,
    gazeY: gaze.gazeY,
    headYaw,
    headPitch,
    breath,
    posture,
  };
}
