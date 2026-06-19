import type { DirectCapability } from "../../brain/direct_capabilities";
import { getConfig } from "../../server/config";
import { createLogger } from "../../infra/logger";
import { isNsfwEnabled } from "../../brains/nsfw_mode";
import { classifyImageIntent } from "./image_intent";
import {
  ComfyUIError,
  generateImage,
  type GenerateImageResult,
} from "./comfyui_bridge";

const logger = createLogger("image_generation");

const CAPABILITY_ID = "image_generation";

/** Per-session memory of the last thing we drew, for 重画 / 换风格. */
interface SessionImageState {
  /** Base subject (without style), reused when restyling. */
  subject: string;
  /** Full positive prompt last submitted. */
  prompt: string;
}

const lastBySession = new Map<string, SessionImageState>();

function describeError(err: ComfyUIError, baseUrl: string): string {
  switch (err.kind) {
    case "unreachable":
      return `我这边连不上本地的 ComfyUI（${baseUrl}），帮我看看它是不是没开着呀？开好了再让我画一次～`;
    case "timeout":
      return "这张画了好久都没出来，可能有点复杂～要不我们再试一次？";
    case "no_output":
      return "ComfyUI 跑完了却没给我图，可能是工作流里的输出节点有点问题。";
    case "aborted":
      return "好的，这张我先不画了。";
    case "rejected":
    default:
      return `ComfyUI 没能顺利出图：${err.message.slice(0, 160)}`;
  }
}

function buildReply(result: GenerateImageResult, label: string): string {
  const first = result.images[0];
  const extra =
    result.images.length > 1 ? `（一共 ${result.images.length} 张）` : "";
  // Build a proxied URL so the frontend can render it without CORS issues.
  // The server's /api/comfyui/view route proxies to the local ComfyUI /view.
  const proxyParams = new URLSearchParams({
    filename: first.filename,
    subfolder: first.subfolder ?? "",
    type: first.type ?? "output",
  });
  const imgUrl = `/api/comfyui/view?${proxyParams.toString()}`;
  return [
    `画好啦～这是「${label}」🎨${extra}`,
    `![${label}](${imgUrl})`,
  ].join("\n");
}

async function draw(
  connId: string,
  subject: string,
  prompt: string,
  label: string,
  signal: AbortSignal | undefined,
): Promise<string> {
  const config = getConfig();
  const baseUrl = config.COMFYUI_BASE_URL;
  // In adult mode, swap to the NSFW checkpoint / relaxed negatives if configured.
  const nsfw = isNsfwEnabled(connId);
  try {
    const result = await generateImage({
      prompt,
      signal,
      ...(nsfw && config.COMFYUI_NSFW_CHECKPOINT
        ? { checkpoint: config.COMFYUI_NSFW_CHECKPOINT }
        : {}),
      ...(nsfw && config.COMFYUI_NSFW_NEGATIVE
        ? { negativePrompt: config.COMFYUI_NSFW_NEGATIVE }
        : {}),
    });
    lastBySession.set(connId, { subject, prompt });
    logger.info("image generated", { connId, promptId: result.promptId, label });
    return buildReply(result, label);
  } catch (err) {
    if (err instanceof ComfyUIError) {
      logger.warn("comfyui generation failed", { connId, kind: err.kind, error: err.message });
      return describeError(err, baseUrl);
    }
    logger.error("unexpected image generation error", {
      connId,
      error: (err as Error).message,
    });
    return `画图的时候出了点小状况：${(err as Error).message.slice(0, 160)}`;
  }
}

export const imageGenerationCapability: DirectCapability = {
  id: CAPABILITY_ID,
  async tryHandle(request) {
    const config = getConfig();
    if (!config.COMFYUI_ENABLED || request.systemTriggered) {
      return { handled: false };
    }

    const intent = classifyImageIntent(request.userMessage);
    if (intent.kind === "none") {
      return { handled: false };
    }

    const connId = request.ctx.connId;
    const last = lastBySession.get(connId);

    // Past this point the message is clearly an image command — always handle it
    // so it never leaks to the main LLM (which can't draw).

    if (intent.kind === "generate") {
      if (!intent.prompt) {
        return {
          handled: true,
          capabilityId: CAPABILITY_ID,
          reply: "你想让我画点什么呀？比如「画一只戴帽子的橘猫」～",
        };
      }
      const reply = await draw(
        connId,
        intent.prompt,
        intent.prompt,
        intent.prompt,
        request.signal,
      );
      return { handled: true, capabilityId: CAPABILITY_ID, reply };
    }

    if (intent.kind === "redraw") {
      if (!last) {
        return {
          handled: true,
          capabilityId: CAPABILITY_ID,
          reply: "我还没画过图呢，先告诉我想画什么吧～比如「画一片星空」。",
        };
      }
      // Fresh seed (generateImage randomizes when seed is omitted).
      const reply = await draw(
        connId,
        last.subject,
        last.prompt,
        last.subject,
        request.signal,
      );
      return { handled: true, capabilityId: CAPABILITY_ID, reply };
    }

    // intent.kind === "restyle"
    const subject = intent.subject || last?.subject;
    if (!subject) {
      return {
        handled: true,
        capabilityId: CAPABILITY_ID,
        reply: "想画成什么风格呀？先告诉我画什么，比如「画一只猫」，再说「换成水彩风格」就好啦～",
      };
    }
    if (!intent.style) {
      return {
        handled: true,
        capabilityId: CAPABILITY_ID,
        reply: "想换成什么风格呢？比如水彩、油画、赛博朋克、吉卜力～",
      };
    }
    const styledPrompt = `${subject}, ${intent.style}风格`;
    const reply = await draw(
      connId,
      subject,
      styledPrompt,
      `${subject}·${intent.style}风格`,
      request.signal,
    );
    return { handled: true, capabilityId: CAPABILITY_ID, reply };
  },
};
