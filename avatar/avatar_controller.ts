import { createTransition, getEmotionFace } from "./emotion_mapper";
import { detectActions } from "./action_triggers";
import type { ActionCommand, AvatarFrame, Emotion, ExpressionBlendMode, FaceParams } from "./types";

const DEFAULT_EMOTION_TRANSITION_MS = 450;

// ---------------------------------------------------------------------------
// Plugin-chain frame update architecture (airi pattern)
// ---------------------------------------------------------------------------

export interface FramePluginContext {
  delta: number;
  currentFace: FaceParams;
  emotion: Emotion;
  isSpeaking: boolean;
  handled: boolean;
  markHandled(): void;
}

export type FramePluginResult = Partial<FaceParams> & { blendMode?: ExpressionBlendMode };

export type FramePlugin = (ctx: FramePluginContext) => FramePluginResult | void;

// ---------------------------------------------------------------------------
// Blink plugin (airi pattern: sine-curve natural blink)
// ---------------------------------------------------------------------------

const BLINK_DURATION = 0.2;
const MIN_BLINK_INTERVAL = 1;
const MAX_BLINK_INTERVAL = 6;

function createBlinkPlugin(): FramePlugin {
  let timeSinceLast = 0;
  let isBlinking = false;
  let progress = 0;
  let nextAt = randFloat(MIN_BLINK_INTERVAL, MAX_BLINK_INTERVAL);

  return (ctx) => {
    timeSinceLast += ctx.delta;
    if (!isBlinking && timeSinceLast >= nextAt) {
      isBlinking = true;
      progress = 0;
    }
    if (isBlinking) {
      progress += ctx.delta / BLINK_DURATION;
      const blinkValue = Math.sin(Math.PI * Math.min(progress, 1));
      if (progress >= 1) {
        isBlinking = false;
        timeSinceLast = 0;
        nextAt = randFloat(MIN_BLINK_INTERVAL, MAX_BLINK_INTERVAL);
      }
      const mult = 1 - blinkValue;
      return { eyeOpenL: mult, eyeOpenR: mult, blendMode: "multiply" };
    }
  };
}

// ---------------------------------------------------------------------------
// Idle eye saccade plugin (airi pattern)
// ---------------------------------------------------------------------------

const SACCADE_MIN_MS = 200;
const SACCADE_MAX_MS = 1000;

function createSaccadePlugin(): FramePlugin {
  let nextAt = randFloat(SACCADE_MIN_MS, SACCADE_MAX_MS) / 1000;
  let elapsed = 0;
  let targetX = 0;
  let targetY = 0;
  let currentX = 0;
  let currentY = 0;

  return (ctx) => {
    if (ctx.isSpeaking) return;
    elapsed += ctx.delta;
    if (elapsed >= nextAt) {
      targetX = randFloat(-0.15, 0.15);
      targetY = randFloat(-0.1, 0.1);
      elapsed = 0;
      nextAt = randFloat(SACCADE_MIN_MS, SACCADE_MAX_MS) / 1000;
    }
    currentX += (targetX - currentX) * 0.3;
    currentY += (targetY - currentY) * 0.3;
    return { browUpL: clamp01(ctx.currentFace.browUpL + currentY * 0.3), browUpR: clamp01(ctx.currentFace.browUpR + currentY * 0.3) };
  };
}

function randFloat(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function applyPatch(face: FaceParams, patch: FramePluginResult): FaceParams {
  const mode: ExpressionBlendMode = patch.blendMode ?? "overwrite";
  const out = { ...face };
  for (const key of Object.keys(patch) as Array<keyof FaceParams>) {
    if (key === ("blendMode" as any)) continue;
    const v = patch[key];
    if (typeof v !== "number") continue;
    switch (mode) {
      case "multiply":
        out[key] = clamp01(out[key] * v);
        break;
      case "add":
        out[key] = clamp01(out[key] + v);
        break;
      default:
        out[key] = clamp01(v);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// AvatarController
// ---------------------------------------------------------------------------

export class AvatarController {
  private currentEmotion: Emotion = "neutral";
  private currentFace: FaceParams = getEmotionFace("neutral");
  private isSpeaking = false;

  private readonly prePlugins: FramePlugin[] = [];
  private readonly finalPlugins: FramePlugin[] = [];

  constructor() {
    this.finalPlugins.push(createBlinkPlugin());
    this.prePlugins.push(createSaccadePlugin());
  }

  registerPlugin(plugin: FramePlugin, phase: "pre" | "final" = "pre"): void {
    (phase === "final" ? this.finalPlugins : this.prePlugins).push(plugin);
  }

  setSpeaking(speaking: boolean): void {
    this.isSpeaking = speaking;
  }

  setEmotion(emotion: Emotion): AvatarFrame[] {
    if (emotion === this.currentEmotion) {
      return [];
    }
    const frames = createTransition(
      this.currentEmotion,
      emotion,
      DEFAULT_EMOTION_TRANSITION_MS
    );
    this.currentEmotion = emotion;
    this.currentFace = getEmotionFace(emotion);
    return frames;
  }

  processReply(text: string): AvatarFrame[] {
    const actions = detectActions(text);
    return actions.map((action: ActionCommand) => ({ action }));
  }

  /** Run one tick of the plugin chain and return the composited frame. */
  tick(delta: number): AvatarFrame {
    let face = { ...this.currentFace };
    let handled = false;

    const ctx: FramePluginContext = {
      delta,
      currentFace: face,
      emotion: this.currentEmotion,
      isSpeaking: this.isSpeaking,
      handled: false,
      markHandled() { handled = true; },
    };

    for (const plugin of this.prePlugins) {
      if (handled) break;
      const patch = plugin(ctx);
      if (patch) face = applyPatch(face, patch);
      ctx.currentFace = face;
      ctx.handled = handled;
    }

    for (const plugin of this.finalPlugins) {
      const patch = plugin(ctx);
      if (patch) face = applyPatch(face, patch);
      ctx.currentFace = face;
    }

    return { emotion: this.currentEmotion, face };
  }

  getFrame(): AvatarFrame {
    return {
      emotion: this.currentEmotion,
      face: this.currentFace,
    };
  }
}
