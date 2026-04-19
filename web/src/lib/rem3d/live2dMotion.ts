import type { AvatarFrameState, RemiState, RemiTurnState } from "@/types/avatar";
import type { ConversationPerformanceModel } from "@/lib/presence/conversationPerformanceModel";
import type { AvatarRenderModel } from "@/runtime/avatarRenderModel";
import { samplePortraitMotionFrame } from "@/lib/portrait/motionModel";

export type Live2DMotionFrame = {
  focus: { x: number; y: number };
  mouthOpen: number;
  mouthForm: number;
  angleX: number;
  angleY: number;
  bodyAngleX: number;
  eyeOpen: number;
};

export type SampleLive2DMotionInput = {
  nowMs: number;
  lipWeight: number;
  emotion: string;
  remState: RemiState;
  turnState: RemiTurnState;
  renderModel?: AvatarRenderModel | null;
  avatarFrame?: AvatarFrameState | null;
  performanceModel?: ConversationPerformanceModel | null;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function fallbackFocus(remState: RemiState, turnState: RemiTurnState) {
  if (turnState === "interrupted_by_user") return { x: -0.22, y: -0.2 };
  switch (remState) {
    case "listening":
      return { x: 0.06, y: 0.04 };
    case "thinking":
      return { x: -0.05, y: -0.18 };
    case "speaking":
      return { x: 0.03, y: 0.02 };
    default:
      return { x: 0, y: 0 };
  }
}

function fallbackBlink(nowMs: number, remState: RemiState): number {
  const cycleMs =
    remState === "thinking" ? 5_800 : remState === "listening" ? 4_900 : 4_300;
  const phase = nowMs % cycleMs;
  if (phase > cycleMs - 140) {
    const closing = (phase - (cycleMs - 140)) / 140;
    return 1 - Math.sin(closing * Math.PI);
  }
  return 1;
}

function expressionMouthForm(emotion: string, smile = 0): number {
  let base = 0;
  switch (emotion) {
    case "happy":
      base = 0.48;
      break;
    case "sad":
      base = -0.32;
      break;
    case "curious":
      base = 0.12;
      break;
    case "angry":
      base = -0.16;
      break;
    default:
      base = 0;
      break;
  }
  return clamp(base + smile * 0.9, -1, 1);
}

function applyPerformanceModelToMotion(
  base: Live2DMotionFrame,
  performanceModel: ConversationPerformanceModel,
  nowMs: number,
): Live2DMotionFrame {
  const cadence = Math.max(18, performanceModel.languageBeat.cadenceMs);
  const beatPhase = nowMs / cadence + performanceModel.languageBeat.seed;
  const beatWave =
    performanceModel.languageBeat.channel === "none"
      ? Math.max(0, Math.sin(nowMs / 460 + performanceModel.languageBeat.seed))
      : Math.max(0, Math.sin(beatPhase));
  const attentiveWave =
    performanceModel.avatarSync.attentivePulse > 0
      ? Math.max(0, Math.sin(nowMs / 340 + performanceModel.languageBeat.seed * 0.7)) *
        performanceModel.avatarSync.attentivePulse
      : 0;
  const energy = performanceModel.energyLevel;
  const emphasis = performanceModel.languageBeat.emphasis;
  const yieldClamp = performanceModel.avatarSync.yieldClamp;
  const phaseAgeMs =
    performanceModel.phaseStartedAtMs != null
      ? Math.max(0, nowMs - performanceModel.phaseStartedAtMs)
      : null;
  const prepareEnvelope =
    performanceModel.phase === "speaking_prepare" && phaseAgeMs != null
      ? clamp(1 - phaseAgeMs / 280, 0, 1)
      : 0;
  const activeEnvelope =
    performanceModel.phase === "speaking_active" && phaseAgeMs != null
      ? clamp(phaseAgeMs / 180, 0.35, 1)
      : performanceModel.phase === "speaking_active"
        ? 1
        : 0;
  const tailEnvelope =
    performanceModel.phase === "speaking_tail" && phaseAgeMs != null
      ? clamp(1 - phaseAgeMs / 340, 0, 1)
      : 0;
  const yieldEnvelope =
    performanceModel.phase === "yield" && phaseAgeMs != null
      ? clamp(1 - phaseAgeMs / 220, 0.2, 1)
      : yieldClamp;
  const transientLead = prepareEnvelope * 0.8 + activeEnvelope * 0.12 - tailEnvelope * 0.18;
  const headLead =
    performanceModel.avatarSync.headImpulse *
    (0.55 + beatWave * 0.45 + emphasis * 0.4 + transientLead);
  const bodyLead =
    performanceModel.avatarSync.bodyImpulse *
    (0.45 + beatWave * 0.55 + emphasis * 0.35 + transientLead * 0.8);
  const focus = {
    x: round2(
      clamp(
        base.focus.x +
          performanceModel.avatarSync.gazeBiasX +
          headLead * 0.22 +
          emphasis * 0.08 +
          prepareEnvelope * 0.06 +
          activeEnvelope * 0.03 -
          tailEnvelope * 0.02 -
          yieldEnvelope * 0.05 +
          attentiveWave * 0.04,
        -1,
        1,
      ),
    ),
    y: round2(
      clamp(
        base.focus.y +
          performanceModel.avatarSync.gazeBiasY -
          yieldEnvelope * 0.12 -
          prepareEnvelope * 0.01 -
          tailEnvelope * 0.04 +
          attentiveWave * -0.02,
        -1,
        1,
      ),
    ),
  };

  return {
    focus,
    mouthOpen: round2(
      clamp(
        Math.max(
          base.mouthOpen,
          performanceModel.avatarSync.mouthFloor +
            beatWave * 0.16 * energy +
            prepareEnvelope * 0.08 +
            activeEnvelope * 0.03,
        ),
        0,
        1,
      ),
    ),
    mouthForm: round2(
      clamp(base.mouthForm + emphasis * 0.1 - yieldEnvelope * 0.08, -1, 1),
    ),
    angleX: round2(
      clamp(
        base.angleX + headLead * 12 + focus.x * 6 + prepareEnvelope * 4 - tailEnvelope * 2,
        -28,
        28,
      ),
    ),
    angleY: round2(
      clamp(
        base.angleY -
          headLead * 5 +
          focus.y * 10 -
          yieldEnvelope * 4 +
          prepareEnvelope * -2 +
          tailEnvelope * 2,
        -28,
        28,
      ),
    ),
    bodyAngleX: round2(
      clamp(
        base.bodyAngleX + bodyLead * 10 + focus.x * 3 + prepareEnvelope * 2 - tailEnvelope * 1.5,
        -18,
        18,
      ),
    ),
    eyeOpen: round2(
      clamp(
        base.eyeOpen -
          yieldEnvelope * 0.18 -
          emphasis * 0.03 -
          prepareEnvelope * 0.04 +
          tailEnvelope * 0.03 +
          attentiveWave * 0.03,
        0.62,
        1,
      ),
    ),
  };
}

export function sampleLive2DMotionFrame(
  input: SampleLive2DMotionInput,
): Live2DMotionFrame {
  const {
    nowMs,
    lipWeight,
    emotion,
    remState,
    turnState,
    renderModel,
    performanceModel,
  } = input;

  if (!renderModel) {
    const base = {
      focus: fallbackFocus(remState, turnState),
      eyeOpen: round2(fallbackBlink(nowMs, remState)),
      angleX: remState === "listening" ? 5 : remState === "thinking" ? -6 : 0,
      angleY:
        remState === "thinking"
          ? 7
          : turnState === "interrupted_by_user"
            ? 4
            : -1.5,
    };
    const motion = {
      focus: base.focus,
      mouthOpen: clamp(lipWeight, 0, 1),
      mouthForm: expressionMouthForm(emotion),
      angleX: base.angleX,
      angleY: base.angleY,
      bodyAngleX: round2(base.angleX * 0.45),
      eyeOpen: base.eyeOpen,
    };
    return performanceModel
      ? applyPerformanceModelToMotion(motion, performanceModel, nowMs)
      : motion;
  }

  const portraitMotion = samplePortraitMotionFrame(renderModel, nowMs);
  const focus = {
    x: round2(clamp(portraitMotion.gaze.x / 12, -1, 1)),
    y: round2(clamp(portraitMotion.gaze.y / -12, -1, 1)),
  };
  const mouthOpen = round2(
    clamp(
      Math.max(
        lipWeight,
        renderModel.mouthOpen,
        portraitMotion.mouthLevelFloor,
      ),
      0,
      1,
    ),
  );
  const angleX = round2(
    clamp(
      renderModel.headYaw * 40 +
        focus.x * 16 +
        renderModel.posture.rotateDeg * 1.5,
      -28,
      28,
    ),
  );
  const angleY = round2(
    clamp(
      renderModel.headPitch * -52 +
        focus.y * 18 +
        renderModel.posture.translateY * -0.45,
      -28,
      28,
    ),
  );
  const bodyAngleX = round2(
    clamp(
      focus.x * 7 + renderModel.posture.translateX * 0.24,
      -18,
      18,
    ),
  );
  const eyeOpen = round2(clamp(portraitMotion.eyeScale, 0.68, 1));

  const motion = {
    focus,
    mouthOpen,
    mouthForm: round2(expressionMouthForm(renderModel.emotion, renderModel.smile)),
    angleX,
    angleY,
    bodyAngleX,
    eyeOpen,
  };
  return performanceModel
    ? applyPerformanceModelToMotion(motion, performanceModel, nowMs)
    : motion;
}
