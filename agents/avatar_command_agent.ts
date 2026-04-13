import { complete } from "../llm/qwen_client";
import { createLogger } from "../infra/logger";
import type { AvatarCommand, Emotion, Motion } from "../avatar/command_types";
import { isEmotion, isMotion } from "../avatar/command_types";

const logger = createLogger("avatar-command-agent");
const cmdMetrics = {
  total: 0,
  parseOk: 0,
  parseFail: 0,
  schemaFail: 0,
  fallback: 0,
};

const SYSTEM_PROMPT = [
  "你是 Remi，一个温柔、自然、简洁的陪伴型角色。",
  "你必须始终输出合法 JSON，不要输出 markdown，不要输出解释。",
  "Schema:",
  "{",
  '  "text": "要说的话",',
  '  "emotion": "neutral|happy|sad|gentle|thinking|surprised",',
  '  "motion": "idle|nod|wave|thinking|shake_head",',
  '  "interruptible": true',
  "}",
].join("\n");

function fallbackCommand(userInput: string, text?: string): AvatarCommand {
  return {
    text: text?.trim() || userInput.trim() || "我在呢，你继续说。",
    emotion: "neutral",
    motion: "idle",
    interruptible: true,
  };
}

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

function asEmotion(v: unknown): Emotion | null {
  if (typeof v !== "string") return null;
  return isEmotion(v) ? v : null;
}

function asMotion(v: unknown): Motion | null {
  if (typeof v !== "string") return null;
  return isMotion(v) ? v : null;
}

function sanitizeCommand(
  parsed: Record<string, unknown> | null,
  userInput: string,
): AvatarCommand {
  if (!parsed) {
    cmdMetrics.parseFail += 1;
    cmdMetrics.fallback += 1;
    return fallbackCommand(userInput);
  }

  const textRaw = typeof parsed.text === "string" ? parsed.text.trim() : "";
  const emotionRaw = asEmotion(parsed.emotion);
  const motionRaw = asMotion(parsed.motion);
  const emotion = emotionRaw ?? "neutral";
  const motion = motionRaw ?? "idle";
  const interruptible =
    typeof parsed.interruptible === "boolean" ? parsed.interruptible : true;
  if (!emotionRaw || !motionRaw || !textRaw) {
    cmdMetrics.schemaFail += 1;
  } else {
    cmdMetrics.parseOk += 1;
  }

  return {
    text: textRaw || userInput.trim() || "我在呢，你继续说。",
    emotion,
    motion,
    interruptible,
  };
}

export async function getAvatarCommand(userInput: string): Promise<AvatarCommand> {
  const input = userInput.trim();
  if (!input) return fallbackCommand("你好");
  cmdMetrics.total += 1;

  try {
    const raw = await complete(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: input },
      ],
      220,
    );

    const parsed = parseJsonObject(raw);
    const cmd = sanitizeCommand(parsed, input);
    if (cmdMetrics.total % 20 === 0) {
      logger.info("[AvatarCommand] metrics", { ...cmdMetrics });
    }
    logger.info("[AvatarCommand] generated", {
      emotion: cmd.emotion,
      motion: cmd.motion,
      interruptible: cmd.interruptible,
      textPreview: cmd.text.slice(0, 40),
    });
    return cmd;
  } catch (err) {
    cmdMetrics.fallback += 1;
    logger.warn("[AvatarCommand] fallback due to error", {
      error: (err as Error).message,
    });
    return fallbackCommand(input);
  }
}
