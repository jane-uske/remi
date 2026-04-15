import type {
  AvatarActionCommand,
  AvatarFaceOverlay,
  AvatarIntent,
  AvatarIntentFacialAccent,
  AvatarIntentGesture,
  AvatarIntentSource,
  RemiTurnState,
} from "@/types/avatar";
import { asEmotion, clampMs } from "../../../../avatar/utils";

function clampHoldMs(value: number): number {
  return clampMs(value, 700, 180, 2400);
}

function normalizeGestureIntensity(value: unknown): 0 | 1 | 2 | 3 {
  if (value === 0 || value === 1 || value === 2 || value === 3) return value;
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(3, Math.round(value))) as 0 | 1 | 2 | 3;
}

function emotionToAccent(
  emotion: AvatarIntent["emotion"],
  face?: AvatarFaceOverlay | null,
): AvatarIntentFacialAccent {
  const browDown = Math.max(face?.browDownL ?? 0, face?.browDownR ?? 0);
  const browUp = Math.max(face?.browUpL ?? 0, face?.browUpR ?? 0);
  const mouthSmile = face?.mouthSmile ?? 0;
  const mouthFrown = face?.mouthFrown ?? 0;

  if (browDown >= 0.35 || mouthFrown >= 0.45 || emotion === "sad") {
    return "brow_furrow";
  }
  if (browUp >= 0.38) {
    return "brow_raise";
  }
  if (mouthSmile >= 0.42 || emotion === "happy") {
    return "soft_smile";
  }
  if (mouthFrown >= 0.22) {
    return "sad_mouth";
  }
  return "none";
}

function mapActionToGesture(action?: AvatarActionCommand | null): AvatarIntentGesture {
  switch (action?.action) {
    case "nod":
    case "shake_head":
    case "wave":
    case "tilt_head":
    case "shrug":
      return action.action;
    case "eyebrow_raise":
      return "none";
    default:
      return "none";
  }
}

export function deriveAvatarIntent(input: {
  emotion: string;
  action?: AvatarActionCommand | null;
  face?: AvatarFaceOverlay | null;
  turnState?: RemiTurnState | null;
  source?: AvatarIntentSource;
  reason?: string;
}): AvatarIntent {
  const emotion = asEmotion(input.emotion);

  const actionGesture = mapActionToGesture(input.action);
  let gesture: AvatarIntentGesture = actionGesture;
  const turnState = input.turnState ?? null;

  if (gesture === "none") {
    if (turnState === "listening_active") {
      gesture = emotion === "sad" || emotion === "shy" ? "shrink_in" : "lean_in";
    } else if (turnState === "listening_hold") {
      gesture = emotion === "sad" ? "shrink_in" : "tilt_head";
    } else if (turnState === "likely_end" || turnState === "assistant_entering") {
      gesture = emotion === "sad" ? "shrink_in" : "lean_in";
    } else if (emotion === "happy") {
      gesture = "happy_hop";
    } else if (emotion === "sad" || emotion === "shy") {
      gesture = "shrink_in";
    } else if (emotion === "curious") {
      gesture = "lean_in";
    }
  }

  const facialAccent =
    input.action?.action === "eyebrow_raise"
      ? "brow_raise"
      : emotionToAccent(emotion, input.face);

  let energy: 0 | 1 | 2 | 3 = 1;
  if (emotion === "happy") energy = 3;
  else if (emotion === "curious") energy = 2;
  else if (emotion === "neutral") energy = 1;
  else energy = 0;

  if (turnState === "listening_active") {
    energy = Math.max(1, energy) as 0 | 1 | 2 | 3;
  } else if (turnState === "likely_end" || turnState === "assistant_entering") {
    energy = Math.min(3, energy + 1) as 0 | 1 | 2 | 3;
  } else if (turnState === "listening_hold" && energy > 0) {
    energy = (energy - 1) as 0 | 1 | 2 | 3;
  }

  const gestureIntensity = normalizeGestureIntensity(
    input.action?.intensity ??
      (gesture === "happy_hop" ? 2.8
      : gesture === "shrink_in" ? 1.8
      : gesture === "lean_in" ? 1.55
      : gesture === "tilt_head" ? 1.1
      : 0),
  );

  return {
    emotion,
    gesture,
    gestureIntensity,
    facialAccent,
    energy,
    holdMs: clampHoldMs(input.action?.duration ?? (gesture === "happy_hop" ? 820 : 700)),
    source: input.source ?? "rule",
    reason: input.reason,
  };
}
