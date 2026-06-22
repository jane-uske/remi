/**
 * LLM Tool Registry — defines the tools available to the main chat LLM.
 *
 * Each tool has an OpenAI-compatible function definition (name, description,
 * parameters) and an `execute` handler that receives parsed arguments and
 * the session context, returning a result string that gets injected as a
 * "tool" role message before the follow-up LLM call.
 *
 * The registry is the single source of truth for tool definitions — both the
 * schema sent to the LLM and the server-side handler live together.
 */

import type { RemiSessionContext } from "../brains/remi_session_context";
import type { Emotion } from "../emotion/emotion_state";
import { getConfig } from "../server/config";
import { createLogger } from "../infra/logger";
import {
  getSessionLastImage,
} from "../capabilities/image_generation/image_generation_capability";

const logger = createLogger("tool_registry");

// ── Types ─────────────────────────────────────────────────────────────

export interface ToolDefinition {
  /** OpenAI function-calling schema (goes into `tools[].function`). */
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
  /** Server-side handler. Receives parsed arguments + session context. */
  execute: (
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ) => Promise<ToolResult>;
  /** If true, the tool is only offered when its gate check passes. */
  gate?: (ctx: ToolGateContext) => boolean;
}

export interface ToolExecutionContext {
  ctx: RemiSessionContext;
  emotion: Emotion;
  userMessage: string;
  signal?: AbortSignal;
}

export interface ToolGateContext {
  ctx: RemiSessionContext;
}

export interface ToolResult {
  /** Text injected as the tool-role message content for the follow-up LLM. */
  output: string;
  /**
   * If set, this is yielded directly as the final reply instead of calling
   * the LLM again. Use for deterministic outputs (mode toggle, time query).
   */
  directReply?: string;
  /** If true, TTS is suppressed for this turn (e.g. image output). */
  skipTts?: boolean;
  /** Capability id for logging / slow brain tagging. */
  capabilityId?: string;
}

// ── Tool: generate_image ──────────────────────────────────────────────

const generateImageTool: ToolDefinition = {
  function: {
    name: "generate_image",
    description:
      "Generate an image based on the user's description. Call this when the user asks you to draw, create, or show an image/photo/illustration. Also call when the user implies they want a visual (e.g. 'show me what you look like', 'what are you wearing'). Pass the subject to draw in Chinese.",
    parameters: {
      type: "object",
      properties: {
        subject: {
          type: "string",
          description:
            "What to draw, in Chinese. Be specific about the scene, pose, clothing, etc. E.g. '穿JK制服的女孩，坐在教室窗边'",
        },
        style: {
          type: "string",
          description:
            "Optional art style. E.g. '动漫', '写实', '水彩'. Leave empty for default.",
        },
      },
      required: ["subject"],
    },
  },
  gate: () => {
    try {
      return Boolean(getConfig().COMFYUI_ENABLED);
    } catch {
      return false;
    }
  },
  execute: async (args, execCtx) => {
    const subject = String(args.subject || "");
    const style = args.style ? String(args.style) : undefined;

    if (!subject.trim()) {
      return { output: "用户没说画什么", capabilityId: "image_generation" };
    }

    try {
      const { enrichImageIntentWithScenePrompt } = await import(
        "../capabilities/image_generation/enrich_image_intent"
      );
      const { assembleImagePrompt } = await import(
        "../capabilities/image_generation/assemble_image_prompt"
      );
      const { generateImage, ComfyUIError } = await import(
        "../capabilities/image_generation/comfyui_bridge"
      );
      const { isNsfwEnabled } = await import("../brains/nsfw_mode");

      const connId = execCtx.ctx.connId;
      const last = getSessionLastImage(connId);

      // Build intent from tool args
      const intent = {
        kind: "generate" as const,
        subject,
        ...(style ? { style } : {}),
      };

      const enrichedIntent = await enrichImageIntentWithScenePrompt({
        intent,
        userMessage: execCtx.userMessage,
        recentHistory: execCtx.ctx.history.slice(-6),
        lastImage: last,
        connId,
        signal: execCtx.signal,
      });

      const planned = assembleImagePrompt({
        intent: enrichedIntent,
        userMessage: execCtx.userMessage,
        lastImage: last,
        characterStyle: last?.characterStyle ?? null,
      });

      if (!planned.ok) {
        return {
          output: planned.clarify,
          directReply: planned.clarify,
          capabilityId: "image_generation",
        };
      }

      const config = getConfig();
      const nsfw = isNsfwEnabled(connId);
      const result = await generateImage({
        prompt: planned.assembled.comfyPrompt,
        signal: execCtx.signal,
        ...(nsfw && config.COMFYUI_NSFW_CHECKPOINT?.trim()
          ? { checkpoint: config.COMFYUI_NSFW_CHECKPOINT.trim() }
          : {}),
        ...(nsfw && config.COMFYUI_NSFW_NEGATIVE
          ? { negativePrompt: config.COMFYUI_NSFW_NEGATIVE }
          : {}),
      });

      const first = result.images[0];
      const proxyParams = new URLSearchParams({
        filename: first.filename,
        subfolder: first.subfolder ?? "",
        type: first.type ?? "output",
      });
      const imgUrl = `/api/comfyui/view?${proxyParams.toString()}`;
      const reply = `![${planned.assembled.label}](${imgUrl})`;

      return {
        output: `图片已生成: ${reply}`,
        directReply: reply,
        skipTts: true,
        capabilityId: "image_generation",
      };
    } catch (err) {
      const msg = (err as Error).message?.slice(0, 200) ?? "unknown error";
      logger.warn("generate_image tool error", {
        connId: execCtx.ctx.connId,
        error: msg,
      });
      return {
        output: `生图失败: ${msg}`,
        capabilityId: "image_generation",
      };
    }
  },
};

// ── Tool: generate_video ──────────────────────────────────────────────

const generateVideoTool: ToolDefinition = {
  function: {
    name: "generate_video",
    description:
      "Generate a short video clip. Call when the user asks for a video, animation, or moving image. This is a slow operation (1-5 minutes); let the user know you're starting.",
    parameters: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "What the video should show, in Chinese.",
        },
      },
      required: ["description"],
    },
  },
  gate: () => {
    try {
      return Boolean(getConfig().COMFYUI_VIDEO_ENABLED);
    } catch {
      return false;
    }
  },
  execute: async (args, execCtx) => {
    const description = String(args.description || "");
    try {
      const { videoGenerationCapability } = await import(
        "../capabilities/video_generation/video_generation_capability"
      );
      // Delegate to existing capability's tryHandle with a synthetic request
      const result = await videoGenerationCapability.tryHandle({
        userMessage: `生成视频：${description}`,
        emotion: execCtx.emotion,
        ctx: execCtx.ctx,
        signal: execCtx.signal,
        systemTriggered: false,
        inputSource: "text",
      });
      if (result.handled) {
        return {
          output: result.reply,
          directReply: result.reply,
          capabilityId: "video_generation",
        };
      }
      return { output: "视频生成功能当前不可用" };
    } catch (err) {
      return { output: `视频生成失败: ${(err as Error).message}` };
    }
  },
};

// ── Tool: toggle_adult_mode ───────────────────────────────────────────

const toggleAdultModeTool: ToolDefinition = {
  function: {
    name: "toggle_adult_mode",
    description:
      "Toggle adult/NSFW mode on or off. Call ONLY when the user explicitly asks to enable or disable adult mode (成人模式).",
    parameters: {
      type: "object",
      properties: {
        enable: {
          type: "boolean",
          description: "true to enable adult mode, false to disable.",
        },
      },
      required: ["enable"],
    },
  },
  gate: () => {
    try {
      return Boolean(getConfig().REMI_NSFW_ENABLED);
    } catch {
      return false;
    }
  },
  execute: async (args, execCtx) => {
    const enable = Boolean(args.enable);
    const { setNsfw } = await import("../brains/nsfw_mode");
    const connId = execCtx.ctx.connId;
    setNsfw(connId, enable, execCtx.ctx.userId);
    logger.info("adult mode toggled via tool", { connId, enabled: enable });

    const reply = enable
      ? "好的～已经为你开启成人模式了😳 这里只有我们俩，想聊什么、想怎么聊都可以。\n（随时说一句「退出成人模式」就能回到平时的我～）"
      : "好啦，已经退出成人模式啦，我们回到平时的样子～";
    return {
      output: `成人模式已${enable ? "开启" : "关闭"}`,
      directReply: reply,
      capabilityId: "mode_control",
    };
  },
};

// ── Tool: get_current_time ────────────────────────────────────────────

const getCurrentTimeTool: ToolDefinition = {
  function: {
    name: "get_current_time",
    description:
      "Get the current date, time, and day of week. Call when the user asks what time or date it is.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  execute: async (_args, _execCtx) => {
    const now = new Date();
    const weekdays = [
      "星期日", "星期一", "星期二", "星期三",
      "星期四", "星期五", "星期六",
    ];
    const timeStr = now.toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const weekday = weekdays[now.getDay()];
    return {
      output: `现在是 ${timeStr}，${weekday}`,
      // Let LLM craft a natural reply with this info
    };
  },
};

// ── Registry ──────────────────────────────────────────────────────────

const ALL_TOOLS: readonly ToolDefinition[] = [
  generateImageTool,
  generateVideoTool,
  toggleAdultModeTool,
  getCurrentTimeTool,
];

/**
 * Get the tools available for this session, filtered by gate checks.
 */
export function getAvailableTools(
  gateCtx: ToolGateContext,
): ToolDefinition[] {
  return ALL_TOOLS.filter((tool) => !tool.gate || tool.gate(gateCtx));
}

/**
 * Build the OpenAI `tools` parameter array from available tools.
 */
export function buildToolsParam(
  gateCtx: ToolGateContext,
): Array<{ type: "function"; function: ToolDefinition["function"] }> {
  return getAvailableTools(gateCtx).map((tool) => ({
    type: "function" as const,
    function: tool.function,
  }));
}

/**
 * Find a tool by name and execute it.
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  execCtx: ToolExecutionContext,
): Promise<ToolResult> {
  const tool = ALL_TOOLS.find((t) => t.function.name === name);
  if (!tool) {
    logger.warn("unknown tool called by LLM", { name });
    return { output: `未知工具: ${name}` };
  }
  logger.info("executing tool", {
    name,
    connId: execCtx.ctx.connId,
    args: JSON.stringify(args).slice(0, 200),
  });
  try {
    return await tool.execute(args, execCtx);
  } catch (err) {
    logger.error("tool execution failed", {
      name,
      connId: execCtx.ctx.connId,
      error: (err as Error).message,
    });
    return { output: `工具执行失败: ${(err as Error).message}` };
  }
}
