import { createLogger } from "../infra/logger";
import type { Emotion } from "./emotion_state";

const logger = createLogger("emotion_runtime");

const DECAY_MAP: Record<Emotion, Emotion> = {
  happy: "neutral",
  curious: "neutral",
  shy: "neutral",
  sad: "neutral",
  concerned: "neutral",
  playful: "neutral",
  thoughtful: "neutral",
  neutral: "neutral",
};

const DECAY_STEP = 0.28;

/**
 * 每条 WebSocket 连接独立一份情绪状态（C1）。
 */
export class EmotionRuntime {
  private currentEmotion: Emotion = "neutral";
  private intensity = 0;

  constructor(readonly connId: string) {}

  getEmotion(): Emotion {
    return this.currentEmotion;
  }

  getEmotionIntensity(): number {
    return this.intensity;
  }

  setEmotion(emotion: Emotion): void {
    if (this.currentEmotion !== emotion) {
      logger.info("情绪变化", { connId: this.connId, from: this.currentEmotion, to: emotion });
    }
    this.currentEmotion = emotion;
    this.intensity = emotion === "neutral" ? 0 : this.intensity;
  }

  weakenEmotionAfterReply(): void {
    if (this.currentEmotion === "neutral") return;
    this.intensity = Math.max(0, this.intensity - DECAY_STEP);
    if (this.intensity > 0.08) return;
    const prev = this.currentEmotion;
    this.currentEmotion = DECAY_MAP[prev];
    this.intensity = 0;
    if (prev !== this.currentEmotion) {
      logger.info("情绪衰减", { connId: this.connId, from: prev, to: this.currentEmotion });
    }
  }

  applyEmotionCandidate(candidate: Emotion): Emotion {
    const prev = this.currentEmotion;

    if (candidate === prev) {
      if (candidate !== "neutral") {
        this.intensity = Math.min(1, this.intensity + 0.22);
      }
    } else {
      this.currentEmotion = candidate;
      this.intensity = candidate === "neutral" ? 0 : 0.72;
      if (prev !== candidate) {
        logger.info("情绪变化", {
          connId: this.connId,
          from: prev,
          to: candidate,
          intensity: this.intensity,
        });
      }
    }

    return this.currentEmotion;
  }
}
