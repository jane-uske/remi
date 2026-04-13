import { createLogger } from "../infra/logger";
import type {
  AvatarIntent,
  AvatarIntentBeat,
  AvatarIntentFacialAccent,
  AvatarIntentGesture,
  Emotion,
} from "../avatar/types";
import {
  asEmotion,
  asFacialAccent,
  asGesture,
  clampBand,
  clampMs,
} from "../avatar/utils";
import { complete as completeQwen } from "../llm/qwen_client";
const logger = createLogger("avatar-intent-agent");

const SYSTEM_PROMPT = [
  "你是 Remi 的 avatar 编排器。",
  "任务：根据 assistant 已经生成好的回复文本，提取一个高层 avatar intent，以及最多 3 个后续 beats。",
  "只输出合法 JSON，不要 markdown，不要解释。",
  "禁止输出底层骨骼值、blendshape 数组、摄像机参数。",
  "gesture 只能是: none|happy_hop|nod|shake_head|wave|tilt_head|shrug|lean_in|recoil|shrink_in",
  "facialAccent 只能是: none|brow_furrow|brow_raise|soft_smile|sad_mouth",
  "emotion 只能是: neutral|happy|curious|shy|sad",
  "gestureIntensity/energy 只能是 0|1|2|3。",
  "holdMs 建议 300-1800，delayMs 建议 0-2200。",
  "如果文本里有括号动作、语气词、舞台提示，要优先转成高层动作语义。",
  "Schema:",
  "{",
  '  "intent": {',
  '    "emotion": "neutral|happy|curious|shy|sad",',
  '    "gesture": "none|happy_hop|nod|shake_head|wave|tilt_head|shrug|lean_in|recoil|shrink_in",',
  '    "gestureIntensity": 0,',
  '    "facialAccent": "none|brow_furrow|brow_raise|soft_smile|sad_mouth",',
  '    "energy": 0,',
  '    "holdMs": 700,',
  '    "reason": "简短原因"',
  "  },",
  '  "beats": [',
  "    {",
  '      "delayMs": 450,',
  '      "gesture": "tilt_head",',
  '      "facialAccent": "brow_raise",',
  '      "gestureIntensity": 1,',
  '      "energy": 2,',
  '      "holdMs": 700,',
  '      "reason": "简短原因"',
  "    }",
  "  ]",
  "}",
].join("\n");

type AvatarIntentEnvelope = {
  intent: AvatarIntent;
  beats: AvatarIntentBeat[];
};

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const src = raw.trim();
  try {
    return JSON.parse(src) as Record<string, unknown>;
  } catch {
    const first = src.indexOf("{");
    const last = src.lastIndexOf("}");
    if (first < 0 || last <= first) return null;
    try {
      return JSON.parse(src.slice(first, last + 1)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}


function fallbackIntent(text: string, emotion: Emotion): AvatarIntentEnvelope {
  const hasSurprisedCue = /眼睛|亮起来|忽然|惊讶|诶|欸|哎呀/.test(text);
  const hasSoftCue = /轻声|温柔|悄悄|小声/.test(text);
  const hasPlayfulCue = /调皮|眨眨眼|歪头|笑着|偷笑/.test(text);

  const intent: AvatarIntent = {
    emotion,
    gesture:
      emotion === "happy" ? "happy_hop"
      : emotion === "sad" ? "shrink_in"
      : hasPlayfulCue ? "tilt_head"
      : hasSurprisedCue ? "lean_in"
      : "none",
    gestureIntensity: emotion === "happy" ? 2 : 1,
    facialAccent:
      emotion === "sad" ? "brow_furrow"
      : hasSurprisedCue ? "brow_raise"
      : emotion === "happy" || hasSoftCue ? "soft_smile"
      : "none",
    energy:
      emotion === "happy" ? 3
      : emotion === "curious" ? 2
      : emotion === "sad" ? 0
      : 1,
    holdMs: emotion === "happy" ? 820 : 700,
    source: "rule",
    reason: "fallback-from-reply",
  };

  const beats: AvatarIntentBeat[] = [];
  if (hasPlayfulCue) {
    beats.push({
      delayMs: 400,
      gesture: "tilt_head",
      facialAccent: "soft_smile",
      gestureIntensity: 1,
      energy: Math.max(1, intent.energy) as 0 | 1 | 2 | 3,
      holdMs: 650,
      reason: "playful-cue",
    });
  }
  if (hasSurprisedCue) {
    beats.push({
      delayMs: 120,
      facialAccent: "brow_raise",
      gesture: "lean_in",
      gestureIntensity: 1,
      energy: Math.max(1, intent.energy) as 0 | 1 | 2 | 3,
      holdMs: 700,
      reason: "surprised-cue",
    });
  }

  return { intent, beats: beats.slice(0, 3) };
}

function sanitizeEnvelope(
  parsed: Record<string, unknown> | null,
  replyText: string,
  emotion: Emotion,
): AvatarIntentEnvelope {
  const fallback = fallbackIntent(replyText, emotion);
  if (!parsed) return fallback;

  const rawIntent =
    parsed.intent && typeof parsed.intent === "object"
      ? (parsed.intent as Record<string, unknown>)
      : null;
  if (!rawIntent) return fallback;

  const intent: AvatarIntent = {
    emotion: asEmotion(rawIntent.emotion, fallback.intent.emotion),
    gesture: asGesture(rawIntent.gesture, fallback.intent.gesture),
    gestureIntensity: clampBand(rawIntent.gestureIntensity, fallback.intent.gestureIntensity),
    facialAccent: asFacialAccent(rawIntent.facialAccent, fallback.intent.facialAccent),
    energy: clampBand(rawIntent.energy, fallback.intent.energy),
    holdMs: clampMs(rawIntent.holdMs, fallback.intent.holdMs, 240, 2400),
    source: "llm",
    reason: typeof rawIntent.reason === "string" ? rawIntent.reason.trim().slice(0, 120) : undefined,
  };

  const beatsSrc = Array.isArray(parsed.beats) ? parsed.beats : [];
  const beats: AvatarIntentBeat[] = [];
  for (const entry of beatsSrc.slice(0, 3)) {
    if (!entry || typeof entry !== "object") continue;
    const beat = entry as Record<string, unknown>;
    beats.push({
      delayMs: clampMs(beat.delayMs, 0, 0, 2400),
      emotion: beat.emotion == null ? undefined : asEmotion(beat.emotion, intent.emotion),
      gesture: beat.gesture == null ? undefined : asGesture(beat.gesture, intent.gesture),
      facialAccent:
        beat.facialAccent == null
          ? undefined
          : asFacialAccent(beat.facialAccent, intent.facialAccent),
      gestureIntensity:
        beat.gestureIntensity == null
          ? undefined
          : clampBand(beat.gestureIntensity, intent.gestureIntensity),
      energy: beat.energy == null ? undefined : clampBand(beat.energy, intent.energy),
      holdMs: beat.holdMs == null ? undefined : clampMs(beat.holdMs, intent.holdMs, 240, 2000),
      reason:
        typeof beat.reason === "string" ? beat.reason.trim().slice(0, 120) : undefined,
    });
  }

  return { intent, beats };
}

export async function inferAvatarIntentFromReply(
  replyText: string,
  emotion: Emotion,
  signal?: AbortSignal,
): Promise<AvatarIntentEnvelope> {
  const trimmed = replyText.trim();
  if (!trimmed) return fallbackIntent(replyText, emotion);

  try {
    const raw = await completeQwen(
      [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `reply_emotion=${emotion}\nassistant_reply=${trimmed}`,
        },
      ],
      260,
      signal,
    );
    const envelope = sanitizeEnvelope(parseJsonObject(raw), trimmed, emotion);
    logger.info("[AvatarIntent] generated", {
      emotion: envelope.intent.emotion,
      gesture: envelope.intent.gesture,
      accent: envelope.intent.facialAccent,
      beats: envelope.beats.length,
      source: envelope.intent.source,
    });
    return envelope;
  } catch (err) {
    logger.warn("[AvatarIntent] fallback due to error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return fallbackIntent(trimmed, emotion);
  }
}
