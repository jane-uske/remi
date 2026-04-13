import { VRMExpressionPresetName } from "@pixiv/three-vrm";
import type { RemiState } from "@/types/avatar";
import type { VrmExpressionWeights } from "./emotionToVrm";

export interface SpeechMotionInput {
  delta: number;
  elapsed: number;
  emotion: string;
  remState: RemiState;
  lipEnvelope: number;
  voiceActive: boolean;
}

export interface SpeechMotionFrame {
  expressions: VrmExpressionWeights;
  speakingAmount: number;
  engagement: number;
  chestPitch: number;
  chestYaw: number;
  chestRoll: number;
  neckPitch: number;
  neckYaw: number;
  neckRoll: number;
}

const MIN_BLINK_INTERVAL = 2.6;
const MAX_BLINK_INTERVAL = 5.4;
const SPEECH_HOLD_SECONDS = 0.22;
const SPEAKING_RETARGET_DELAY = 0.6;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampSym(value: number, maxAbs: number): number {
  return Math.max(-maxAbs, Math.min(maxAbs, value));
}

function smooth(current: number, target: number, speed: number, delta: number): number {
  const alpha = 1 - Math.exp(-speed * delta);
  return current + (target - current) * alpha;
}

function pickBlinkInterval(isSpeaking: boolean): number {
  const base = MIN_BLINK_INTERVAL + Math.random() * (MAX_BLINK_INTERVAL - MIN_BLINK_INTERVAL);
  return isSpeaking ? base * 1.08 : base;
}

export class SpeechMotionController {
  private speakingAmount = 0;
  private engagement = 0;
  private affectAmount = 0;
  private mouthOpen = 0;
  private mouthRound = 0;
  private speakingHold = 0;
  private speakingDuration = 0;
  private blinkTimer = pickBlinkInterval(false);
  private blinkPhase = 0;
  private gazeX = 0;
  private gazeY = 0;
  private gazeTargetX = 0;
  private gazeTargetY = 0;
  private gazeRetargetIn = 1;

  reset(): void {
    this.speakingAmount = 0;
    this.engagement = 0;
    this.affectAmount = 0;
    this.mouthOpen = 0;
    this.mouthRound = 0;
    this.speakingHold = 0;
    this.speakingDuration = 0;
    this.blinkTimer = pickBlinkInterval(false);
    this.blinkPhase = 0;
    this.gazeX = 0;
    this.gazeY = 0;
    this.gazeTargetX = 0;
    this.gazeTargetY = 0;
    this.gazeRetargetIn = 1;
  }

  update(input: SpeechMotionInput): SpeechMotionFrame {
    const delta = Math.max(1 / 240, Math.min(input.delta || 0, 0.1));
    const elapsed = Number.isFinite(input.elapsed) ? input.elapsed : 0;
    const emotion = String(input.emotion || "neutral").toLowerCase();
    const lip = clamp01(input.lipEnvelope);
    const bufferedSpeech = input.voiceActive && lip < 0.03;
    const speakingDetected = input.voiceActive || lip > 0.045;

    if (speakingDetected) {
      this.speakingHold = SPEECH_HOLD_SECONDS;
    } else {
      this.speakingHold = Math.max(0, this.speakingHold - delta);
    }

    const holdActive = this.speakingHold > 0;
    if (speakingDetected || holdActive) {
      this.speakingDuration += delta;
    } else {
      this.speakingDuration = Math.max(0, this.speakingDuration - delta * 1.5);
    }

    const mouthCarrier = bufferedSpeech
      ? 0.34 +
        0.18 * (0.5 + 0.5 * Math.sin(elapsed * 11.6)) +
        0.11 * (0.5 + 0.5 * Math.sin(elapsed * 17.8 + 0.9))
      : 0;
    const speakingTarget = Math.max(lip, mouthCarrier, holdActive ? 0.1 : 0);
    this.speakingAmount = smooth(
      this.speakingAmount,
      speakingTarget,
      speakingTarget > this.speakingAmount ? 18 : 11.5,
      delta,
    );

    const engagementSeed = Math.max(
      lip * 0.95,
      bufferedSpeech ? 0.34 : input.voiceActive ? 0.16 : 0,
      holdActive ? 0.06 : 0,
    );
    const engagementTarget =
      speakingDetected || holdActive
        ? clamp01(0.18 + engagementSeed * 0.78)
        : 0;
    this.engagement = smooth(
      this.engagement,
      engagementTarget,
      engagementTarget > this.engagement ? 8.5 : 3.1,
      delta,
    );
    this.affectAmount = smooth(
      this.affectAmount,
      engagementTarget > 0 ? this.engagement : 0,
      engagementTarget > this.affectAmount ? 5.5 : 4.2,
      delta,
    );

    const talkPulse = 0.5 + 0.5 * Math.sin(elapsed * 15.5);
    const mouthTarget = clamp01(
      this.speakingAmount * 1.26 + talkPulse * this.speakingAmount * 0.12,
    );
    this.mouthOpen = smooth(
      this.mouthOpen,
      mouthTarget,
      mouthTarget > this.mouthOpen ? 22 : 12,
      delta,
    );
    this.mouthRound = smooth(
      this.mouthRound,
      clamp01(this.mouthOpen * (0.12 + 0.05 * Math.sin(elapsed * 5.8 + 1.2))),
      8.5,
      delta,
    );

    this.updateBlink(delta, this.engagement > 0.18);
    this.updateGaze(delta, emotion, this.engagement, this.speakingDuration);

    const blink = this.blinkValue();
    const speaking = this.speakingAmount;
    const engagement = this.engagement;
    const postureAmount = Math.max(
      engagement * (0.9 + speaking * 0.62),
      bufferedSpeech ? 0.22 + speaking * 0.4 : 0,
    );
    const thinking = input.remState === "thinking" ? 1 : 0;
    const listening = input.remState === "listening" ? 1 : 0;

    const speechWave =
      Math.sin(elapsed * 1.45 + 0.25) * 0.6 + Math.sin(elapsed * 0.9 + 1.2) * 0.4;
    const speechNod = Math.sin(elapsed * 3.8 + 0.35) * speaking;

    const emotionPitchBias =
      emotion === "sad" ? 0.012
      : emotion === "curious" ? -0.01
      : emotion === "shy" ? 0.008
      : 0;
    const emotionRollBias =
      emotion === "happy" ? 0.008
      : emotion === "shy" ? -0.01
      : 0;

    const expressions: VrmExpressionWeights = {
      [VRMExpressionPresetName.Aa]: clamp01(this.mouthOpen * 1.18),
      [VRMExpressionPresetName.Oh]: clamp01(this.mouthRound * 1.22),
      [VRMExpressionPresetName.Blink]: blink,
    };

    if (this.gazeX > 0.015) {
      expressions[VRMExpressionPresetName.LookRight] = this.gazeX;
    } else if (this.gazeX < -0.015) {
      expressions[VRMExpressionPresetName.LookLeft] = -this.gazeX;
    }
    if (this.gazeY > 0.015) {
      expressions[VRMExpressionPresetName.LookUp] = this.gazeY;
    } else if (this.gazeY < -0.015) {
      expressions[VRMExpressionPresetName.LookDown] = -this.gazeY;
    }
    if (this.affectAmount > 0.04) {
      expressions[VRMExpressionPresetName.Relaxed] = 0.035 + this.affectAmount * 0.065;
    }
    if (emotion === "happy" && this.affectAmount > 0.05) {
      expressions[VRMExpressionPresetName.Happy] = 0.025 + this.affectAmount * 0.055;
    }
    if (emotion === "sad" && this.affectAmount > 0.05) {
      expressions[VRMExpressionPresetName.Sad] = 0.025 + this.affectAmount * 0.05;
    }
    if (emotion === "shy" && this.affectAmount > 0.05) {
      expressions[VRMExpressionPresetName.Happy] = 0.02 + this.affectAmount * 0.03;
    }
    if (emotion === "curious" && this.affectAmount > 0.06) {
      expressions[VRMExpressionPresetName.Surprised] = 0.02 + this.affectAmount * 0.04;
    }

    return {
      expressions,
      speakingAmount: speaking,
      engagement,
      chestPitch: clampSym(
        0.0072 * speechWave * postureAmount +
          0.0054 * speechNod * postureAmount +
          0.0045 * thinking,
        0.014,
      ),
      chestYaw: clampSym(
        0.0065 * Math.sin(elapsed * 1.1 + 0.4) * postureAmount +
          0.004 * thinking,
        0.01,
      ),
      chestRoll: clampSym(
        emotionRollBias * 0.32 * engagement +
          0.0045 * Math.sin(elapsed * 1.05 + 1.4) * postureAmount,
        0.009,
      ),
      neckPitch: clampSym(
        emotionPitchBias * (0.38 + engagement * 0.7) +
          0.0102 * speechNod * postureAmount +
          0.0058 * speechWave * postureAmount +
          0.01 * listening,
        0.022,
      ),
      neckYaw: clampSym(
        this.gazeX * 0.18 +
          0.0068 * Math.sin(elapsed * 1.35 + 0.55) * postureAmount,
        0.024,
      ),
      neckRoll: clampSym(
        emotionRollBias * (0.46 + engagement * 0.6) +
          this.gazeX * 0.09 +
          0.0052 * Math.sin(elapsed * 1.1 + 2.1) * postureAmount,
        0.018,
      ),
    };
  }

  private updateBlink(delta: number, speaking: boolean): void {
    if (this.blinkPhase > 0) {
      this.blinkPhase = Math.max(0, this.blinkPhase - delta / 0.18);
      if (this.blinkPhase === 0) {
        this.blinkTimer = pickBlinkInterval(speaking);
      }
      return;
    }

    this.blinkTimer -= delta;
    if (this.blinkTimer <= 0) {
      this.blinkPhase = 1;
    }
  }

  private blinkValue(): number {
    if (this.blinkPhase <= 0) return 0;
    const x = 1 - this.blinkPhase;
    if (x < 0.35) return clamp01(x / 0.35);
    return clamp01((1 - x) / 0.65);
  }

  private updateGaze(
    delta: number,
    emotion: string,
    engagement: number,
    speakingDuration: number,
  ): void {
    const biasY =
      emotion === "curious" ? 0.012
      : emotion === "shy" || emotion === "sad" ? -0.012
      : 0;

    this.gazeRetargetIn -= delta;
    if (this.gazeRetargetIn <= 0) {
      if (engagement > 0.12 && speakingDuration < SPEAKING_RETARGET_DELAY) {
        this.gazeTargetX = 0;
        this.gazeTargetY = biasY * 0.65;
        this.gazeRetargetIn = 0.32;
      } else {
        const speakingSteady = engagement > 0.12 && speakingDuration >= SPEAKING_RETARGET_DELAY;
        const rangeX = speakingSteady ? 0.018 : 0.035;
        const rangeY = speakingSteady ? 0.014 : 0.024;
        this.gazeTargetX = clampSym((Math.random() * 2 - 1) * rangeX, rangeX);
        this.gazeTargetY = clampSym((Math.random() * 2 - 1) * rangeY + biasY, 0.04);
        this.gazeRetargetIn = speakingSteady
          ? 1.4 + Math.random() * 0.8
          : 1.9 + Math.random() * 1.3;
      }
    }

    const gazeSpeed = engagement > 0.12 ? 2.1 : 1.8;
    this.gazeX = smooth(this.gazeX, this.gazeTargetX, gazeSpeed, delta);
    this.gazeY = smooth(this.gazeY, this.gazeTargetY, gazeSpeed * 0.95, delta);
  }
}
