/**
 * Vision sidecar client — calls a separate vision-capable model (MiniCPM-V,
 * LLaVA, Qwen-VL, etc.) to describe images.  The description is plain text
 * that gets injected into the main conversation history, keeping the primary
 * LLM on a text-only path.
 *
 * Usage:
 *   import { visionEnabled, describeImage } from "./vision_client";
 *   if (visionEnabled()) {
 *     const description = await describeImage(base64DataUrl);
 *   }
 */
import OpenAI from "openai";
import { getConfig } from "../server/config";
import { createLogger } from "../infra/logger";
import { salvageVisibleFromReasoning, stripThinkBlocks } from "./qwen_client";

const logger = createLogger("vision_client");

let client: OpenAI | null = null;

/** Whether the vision sidecar is configured and enabled. */
export function visionEnabled(): boolean {
  const cfg = getConfig();
  return Boolean(cfg.REMI_VISION_ENABLED && cfg.REMI_VISION_BASE_URL && cfg.REMI_VISION_MODEL);
}

function getVisionClient(): OpenAI {
  if (client) return client;
  const cfg = getConfig();
  client = new OpenAI({
    apiKey: cfg.REMI_VISION_API_KEY || "lm-studio",
    baseURL: cfg.REMI_VISION_BASE_URL,
  });
  return client;
}

const DEFAULT_DESCRIBE_PROMPT =
  "/no_think 用一两句中文简洁描述这张图的主要内容、风格和氛围。不要说「这是一张图片」之类的废话，直接描述你看到了什么。";

/**
 * Prompt for user-sent images — emphasizes accurate reading over vibe.
 * Reads any text verbatim (chat logs, documents, posters) and describes
 * scenes/people concretely. Used when the user shares a photo or screenshot.
 */
export const USER_IMAGE_PROMPT =
  "/no_think 仔细看这张图，用中文如实、具体地描述你看到的内容。如果图里有文字（聊天记录、文档、海报、表格等），逐条把文字内容准确读出来，不要遗漏也不要编造。如果是照片或画面，描述清楚人物、场景、动作和关键细节。直接说你看到了什么，不要说「这是一张图片」之类的废话。";

/**
 * Extract visible text from the response, handling Qwen3-style models that put
 * everything into reasoning_content while leaving content empty.
 */
function extractVisible(message: {
  content?: string | null;
  reasoning_content?: string | null;
}): string {
  const raw = (message.content ?? "").trim();
  const visible = stripThinkBlocks(raw);
  if (visible) return visible;

  // Qwen3 uncensored often fills reasoning_content only — salvage from there
  const reasoning = (message.reasoning_content ?? "").trim();
  if (reasoning) {
    const salvaged = salvageVisibleFromReasoning(reasoning);
    if (salvaged) {
      logger.info("vision: salvaged description from reasoning channel", {
        chars: salvaged.length,
      });
      return salvaged;
    }
    // Last resort: take the last substantive paragraph from reasoning
    const paragraphs = reasoning
      .split(/\n+/)
      .map((p) => p.replace(/^[-*•\d.)\s]+/u, "").trim())
      .filter((p) => p.length > 5 && /[一-鿿]/u.test(p));
    if (paragraphs.length > 0) {
      return paragraphs[paragraphs.length - 1];
    }
  }

  return "";
}

/**
 * Ask the vision model to describe an image.
 *
 * @param imageBase64 - data URL (data:image/png;base64,...) or raw base64
 * @param prompt      - optional instruction override
 * @returns description text, or empty string on failure
 */
export async function describeImage(
  imageBase64: string,
  prompt?: string,
): Promise<string> {
  if (!visionEnabled()) return "";

  const cfg = getConfig();
  const openai = getVisionClient();

  // Ensure proper data URL format
  const imageUrl = imageBase64.startsWith("data:")
    ? imageBase64
    : `data:image/jpeg;base64,${imageBase64}`;

  try {
    const res = await (openai.chat.completions.create as Function)({
      model: cfg.REMI_VISION_MODEL,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt ?? DEFAULT_DESCRIBE_PROMPT },
            {
              type: "image_url",
              // detail:"high" tiles the image so small/dense text stays legible
              // instead of being downscaled to ~512px.
              image_url: { url: imageUrl, detail: cfg.REMI_VISION_DETAIL },
            },
          ],
        },
      ],
      max_tokens: cfg.REMI_VISION_MAX_TOKENS,
      temperature: 0.3,
      reasoning_effort: "none",
      signal: AbortSignal.timeout(cfg.REMI_VISION_TIMEOUT_MS),
    });

    const message = res.choices?.[0]?.message ?? {};
    const text = extractVisible(
      message as { content?: string | null; reasoning_content?: string | null },
    );

    if (text) {
      logger.info("vision describe succeeded", {
        model: cfg.REMI_VISION_MODEL,
        chars: text.length,
        preview: text.slice(0, 80),
      });
    } else {
      logger.warn("vision describe returned empty", {
        model: cfg.REMI_VISION_MODEL,
        contentChars: (message.content ?? "").length,
        reasoningChars: ((message as any).reasoning_content ?? "").length,
      });
    }
    return text;
  } catch (err) {
    logger.warn("vision describe failed", {
      model: cfg.REMI_VISION_MODEL,
      error: (err as Error).message,
    });
    return "";
  }
}
