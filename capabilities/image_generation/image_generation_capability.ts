import type { DirectCapability } from "../../brain/direct_capabilities";
import { getConfig } from "../../server/config";
import { createLogger } from "../../infra/logger";
import { isNsfwEnabled } from "../../brains/nsfw_mode";
import { assembleImagePrompt, type AssembledImagePrompt } from "./assemble_image_prompt";
import { enrichImageIntentWithScenePrompt } from "./enrich_image_intent";
import { classifyImageIntentRegex, type ImageIntent } from "./image_intent";
import {
  ComfyUIError,
  generateImage,
  type GenerateImageResult,
} from "./comfyui_bridge";

const logger = createLogger("image_generation");

const CAPABILITY_ID = "image_generation";

/** Per-session memory of the last thing we drew, for 重画 / 换风格. */
interface SessionImageState {
  subject: string;
  prompt: string;
  characterStyle?: string;
}

const lastBySession = new Map<string, SessionImageState>();

export function sessionHasImage(connId: string): boolean {
  return lastBySession.has(connId);
}

export function getSessionLastImage(
  connId: string,
): SessionImageState | undefined {
  return lastBySession.get(connId);
}

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

/** Step 3: submit assembled prompt to ComfyUI. */
async function invokeComfyUI(
  connId: string,
  assembled: AssembledImagePrompt,
  signal: AbortSignal | undefined,
): Promise<string> {
  const config = getConfig();
  const baseUrl = config.COMFYUI_BASE_URL;
  const nsfw = isNsfwEnabled(connId);
  try {
    logger.info("image generation invoke", {
      connId,
      label: assembled.label,
      comfyPrompt: assembled.comfyPrompt.slice(0, 200),
    });
    const result = await generateImage({
      prompt: assembled.comfyPrompt,
      signal,
      // z_image_turbo uses UNETLoader — only override when explicitly configured.
      ...(nsfw && config.COMFYUI_NSFW_CHECKPOINT?.trim()
        ? { checkpoint: config.COMFYUI_NSFW_CHECKPOINT.trim() }
        : {}),
      ...(nsfw && config.COMFYUI_NSFW_NEGATIVE
        ? { negativePrompt: config.COMFYUI_NSFW_NEGATIVE }
        : {}),
    });
    lastBySession.set(connId, {
      subject: assembled.subject,
      prompt: assembled.comfyPrompt,
      characterStyle: assembled.characterStyle,
    });
    logger.info("image generated", {
      connId,
      promptId: result.promptId,
      label: assembled.label,
    });
    return buildReply(result, assembled.label);
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

    const intent: ImageIntent =
      request.imageIntent ?? classifyImageIntentRegex(request.userMessage);
    if (intent.kind === "none") {
      return { handled: false };
    }

    const connId = request.ctx.connId;
    const last = lastBySession.get(connId);

    // Step 1.5: Qwen writes scene prompt (intent step only classifies).
    const enrichedIntent = await enrichImageIntentWithScenePrompt({
      intent,
      userMessage: request.userMessage,
      recentHistory: request.ctx.history.slice(-6),
      lastImage: last,
      connId,
      signal: request.signal,
    });

    // Step 2: assemble ComfyUI prompt from resolved intent + locked style.
    const planned = assembleImagePrompt({
      intent: enrichedIntent,
      userMessage: request.userMessage,
      lastImage: last,
      characterStyle: last?.characterStyle ?? null,
    });
    if (!planned.ok) {
      return {
        handled: true,
        capabilityId: CAPABILITY_ID,
        reply: planned.clarify,
      };
    }

    // Step 3: invoke ComfyUI.
    const reply = await invokeComfyUI(connId, planned.assembled, request.signal);
    return { handled: true, capabilityId: CAPABILITY_ID, reply };
  },
};