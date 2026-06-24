/**
 * Video generation DirectCapability — the Remi-side entry point.
 *
 * Design constraints (from CLAUDE.md):
 * • NEVER block the fast path — video takes ~28 min, so tryHandle returns
 *   immediately with a "starting" reply and runs the actual generation in a
 *   detached async task. Completion/failure is pushed via WS.
 * • Only service companionship — the capability speaks in Remi's voice.
 */

import type { DirectCapability } from "../../brain/direct_capabilities";
import { getConfig } from "../../server/config";
import { createLogger } from "../../infra/logger";
import { classifyVideoIntent, type VideoIntent } from "./video_intent";
import {
  generateVideo,
  VideoGenerationError,
} from "./video_bridge";

const logger = createLogger("video_generation");

const CAPABILITY_ID = "video_generation";

/** Map of connId → currently running generation (at most one per session). */
const activeBySession = new Map<string, AbortController>();

function describeError(err: VideoGenerationError): string {
  switch (err.kind) {
    case "unreachable":
      return `我这边连不上本地的视频生成管线，帮我看看 ComfyUI 和 storyboard runner 是不是开着？`;
    case "timeout":
      return "视频跑了好久都没出来，可能镜头太多了～要不减少几个镜头再试试？";
    case "aborted":
      return "好的，视频生成取消了。";
    case "runner_error":
    default:
      return `视频生成出了点状况：${err.message.slice(0, 160)}`;
  }
}

function buildVideoReply(runName: string, label: string): string {
  const videoUrl = `/api/comfyui/video?run=${encodeURIComponent(runName)}`;
  const posterUrl = `/api/comfyui/video/reference?run=${encodeURIComponent(runName)}`;
  return [
    `视频生成好啦～这是「${label}」🎬`,
    `[video:${runName}](${videoUrl}|${posterUrl})`,
  ].join("\n");
}

/**
 * 给 reply brain 注入的"后台任务事实锚"。reply brain 不持有工具、也看不到真实
 * 任务状态，过去只能靠对话历史脑补，于是会编造"视频还在跑 / 已经跑了 24 小时"这类
 * 不存在的进度（线上实测的假视频根因）。这里用 activeBySession（唯一真相源）给它
 * 一句确定的事实，堵住凭空捏造。
 */
export function describeActiveVideoTask(connId: string): string {
  return activeBySession.has(connId)
    ? "【后台任务】此刻确有一个视频在后台生成中。可以说『还在生成』，但不要编造具体进度百分比或『已经跑了多少小时/多少天』。"
    : "【后台任务】你当前没有、也从未在后台跑过任何视频生成任务。若用户提到『那个视频』『跑完了没』，要如实说你并没有在做/没有做过那个视频——绝不要附和着说『还在跑』『早就跑完了』『在等你验收』『关进小黑屋了』这类把不存在的任务说成真的话。可以顺势问要不要现在帮 ta 生成。";
}

export const videoGenerationCapability: DirectCapability = {
  id: CAPABILITY_ID,
  async tryHandle(request) {
    const config = getConfig();
    if (!config.COMFYUI_VIDEO_ENABLED || !config.COMFYUI_ENABLED || request.systemTriggered) {
      return { handled: false };
    }

    const intent: VideoIntent = classifyVideoIntent(request.userMessage);
    const connId = request.ctx.connId;
    const sendWs = request.ctx.sendServerMessage;

    // Cancel a running generation. If nothing is running, fall through to the
    // companion so a bare "停" / "算了" reads naturally instead of being eaten.
    if (intent.kind === "cancel") {
      const running = activeBySession.get(connId);
      if (!running) {
        return { handled: false };
      }
      activeBySession.delete(connId);
      running.abort();
      logger.info("video generation cancelled by user", { connId });
      sendWs?.({ type: "video_cancelled" });
      return {
        handled: true,
        capabilityId: CAPABILITY_ID,
        reply: "好，那这个视频就先不做啦～想做的时候再叫我 🎬",
      };
    }

    if (intent.kind === "none") {
      return { handled: false };
    }

    // Prevent overlapping video generations in the same session.
    if (activeBySession.has(connId)) {
      return {
        handled: true,
        capabilityId: CAPABILITY_ID,
        reply: "上一个视频还在生成中哦～等它好了再帮你做下一个吧 🎬",
      };
    }

    const subject = intent.subject || request.userMessage.slice(0, 40);
    const ac = new AbortController();
    activeBySession.set(connId, ac);

    // Fire-and-forget: run the generation in the background and push result via WS.
    generateVideo({
      prompt: request.userMessage,
      runName: subject,
      signal: ac.signal,
      onProgress: (p) => {
        // Stream live progress to the browser as a single upserted bar message.
        sendWs?.({
          type: "video_progress",
          percent: p.percent,
          label: p.label,
          stage: p.stage,
        });
      },
    })
      .then((result) => {
        activeBySession.delete(connId);
        const reply = buildVideoReply(result.runName, subject);
        logger.info("video ready, pushing to client", { connId, runName: result.runName });
        sendWs?.({
          type: "video_ready",
          runName: result.runName,
          reply,
        });
      })
      .catch((err) => {
        activeBySession.delete(connId);
        // User-initiated cancel already messaged via video_cancelled — stay quiet
        // so we don't double-message with an "error".
        if (ac.signal.aborted) {
          logger.info("video generation aborted; suppressing error push", { connId });
          return;
        }
        const message =
          err instanceof VideoGenerationError
            ? describeError(err)
            : `视频生成失败了：${(err as Error).message?.slice(0, 160)}`;
        logger.error("video generation failed", { connId, error: (err as Error).message });
        sendWs?.({
          type: "video_error",
          error: message,
        });
      });

    // Return immediately — don't block the pipeline.
    return {
      handled: true,
      capabilityId: CAPABILITY_ID,
      reply: `好的，我开始帮你生成「${subject}」的视频啦～大概需要二十多分钟，我会把进度发给你。中途想停就跟我说一声「取消」哦 🎬`,
    };
  },
};
