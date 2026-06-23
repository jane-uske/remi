import type { MessageSink } from "../gateway/types";

import type { AvatarController } from "../../avatar/avatar_controller";
import type {
  InterruptionType,
  RemiTurnState,
  RemiTurnStateReason,
} from "../../avatar/types";
import type { RemiSessionContext } from "../../brains/remi_session_context";
import { createLogger } from "../../infra/logger";
import { getLatencyTracer } from "../../infra/latency_tracer";
import { runPipeline } from "../pipeline";
import { send } from "../gateway";
import { synthesize, isTtsEnabled } from "../../voice/tts_stream";
import type { InterruptController } from "../../voice/interrupt_controller";
import { getConfig } from "../config";
import { sanitizePastedChatContent } from "../../voice/tts_helpers";
import { randomInterruptReaction } from "./runtime_config";
import type { SessionTtsTransport } from "./tts_transport";

const logger = createLogger("session");

export type SessionTextChatRuntime = {
  sink: MessageSink;
  connId: string;
  brain: RemiSessionContext;
  interrupt: InterruptController;
  avatar: AvatarController;
  sessionId: string | null;
  ensureDbSession: () => Promise<string | null>;
  activeGenerationId: number | null;
  touchUserActivity: (userMessage?: string) => void;
  classifyCarryForward: (userText: string) => {
    interruptionType: InterruptionType | null;
    carryForwardHint?: string;
  };
  sendInterrupt: (generationId?: number | null) => void;
  nextGenerationId: () => number;
  createTraceId: (
    source: "voice" | "text" | "silence_nudge",
    generationId?: number,
  ) => string;
  bindActiveGeneration: (
    generationId: number,
    traceId: string,
    source: "voice" | "text" | "silence_nudge",
  ) => void;
  publishTurnState: (
    state: RemiTurnState,
    reason: RemiTurnStateReason,
    extras?: {
      generationId?: number;
      preview?: string;
      interruptionType?: InterruptionType | null;
      force?: boolean;
    },
  ) => void;
  setPipelineChain: (next: Promise<void>) => void;
  getPipelineChain: () => Promise<void>;
  getResolvedTtsTransport: () => SessionTtsTransport;
};

export function handleSessionTextChat(
  runtime: SessionTextChatRuntime,
  data: { content?: string | null; situational?: string | null; image?: string | null },
): void {
  const content = sanitizePastedChatContent(data.content ?? "");
  if (!content?.trim()) {
    send(runtime.sink, { type: "error", content: "消息内容为空" });
    return;
  }
  // 世界情境（RW-P1-4）：来自 RemiWorld 客户端，封顶防滥用
  const situationalContext =
    typeof data.situational === "string" && data.situational.trim()
      ? data.situational.trim().slice(0, 600)
      : undefined;

  logger.info(`[用户] ${content}`, { connId: runtime.connId });
  runtime.touchUserActivity(content);
  const { interruptionType, carryForwardHint } = runtime.classifyCarryForward(content);

  // 丢消息修复：只有"显式打断意图"（纠正/换话题/情绪打断/承接 —— 即 interruptionType
  // 为明确类型，而非 unknown 的全新问题）才真的打断正在生成的上一条。文本快速连发的
  // 新问题(unknown)不再 abort 上一条，而是靠下方 pipelineChain 串行排队：上一条正常
  // 答完，再答这一条，不丢消息（回到 CLAUDE.md §17"排队不丢失"的本意）。
  // 语音打断走 voice_submit，不经此函数；"不对/停/换个话题"等显式打断仍即时生效。
  const shouldInterrupt =
    runtime.interrupt.active && !!interruptionType && interruptionType !== "unknown";

  if (shouldInterrupt && runtime.brain.currentAssistantDraft?.trim()) {
    runtime.brain.lastInterruptedReply = runtime.brain.currentAssistantDraft.trim();
  }

  const interruptedGenerationId = runtime.activeGenerationId;
  const interruptReactionEnabled =
    getConfig().interrupt_reaction !== "0" && isTtsEnabled();
  if (shouldInterrupt && interruptReactionEnabled) {
    void synthesize(
      randomInterruptReaction(),
      undefined,
      runtime.brain.emotion.getEmotion() as any,
      {
        connId: runtime.connId,
        generationId: interruptedGenerationId ?? 0,
        usage: "interrupt_reaction",
        relationalStance: runtime.brain.persona.liveState.relationalStance,
        responsePolicy: runtime.brain.lastResponsePolicy ?? null,
      },
    )
      .then((buf) => {
        send(runtime.sink, {
          type: "voice",
          audio: buf.toString("base64"),
          generationId: interruptedGenerationId ?? 0,
        });
        runtime.sendInterrupt(interruptedGenerationId ?? null);
      })
      .catch(() => {
        runtime.sendInterrupt(interruptedGenerationId ?? null);
      });
    runtime.interrupt.interrupt();
    logger.info("[Chat] → interrupted pipeline with reaction", {
      connId: runtime.connId,
    });
    runtime.publishTurnState("interrupted_by_user", "user_interrupt", {
      generationId: interruptedGenerationId ?? undefined,
      interruptionType: interruptionType ?? "unknown",
      force: true,
    });
  } else if (shouldInterrupt) {
    runtime.sendInterrupt(interruptedGenerationId ?? null);
    runtime.interrupt.interrupt();
    runtime.publishTurnState("interrupted_by_user", "user_interrupt", {
      generationId: interruptedGenerationId ?? undefined,
      interruptionType: interruptionType ?? "unknown",
      force: true,
    });
  }

  const generationId = runtime.nextGenerationId();
  const traceId = runtime.createTraceId("text", generationId);
  runtime.bindActiveGeneration(generationId, traceId, "text");
  getLatencyTracer(runtime.connId).mark("input_received", traceId);
  getLatencyTracer(runtime.connId).annotateTrace(traceId, {
    finalTranscript: content,
    interruptionType: interruptionType ?? null,
  });
  runtime.publishTurnState("assistant_entering", "tts_prepare", {
    generationId,
    interruptionType,
    force: true,
  });

  const nextPipelineChain = runtime
    .getPipelineChain()
    .then(() =>
      runPipeline(
        runtime.sink,
        content,
        runtime.interrupt,
        runtime.avatar,
        runtime.sessionId,
        runtime.brain,
        generationId,
        traceId,
        {
          // 只有显式打断才把上一句 carry-forward；新问题(unknown)即便因排队而落在
          // 上一条之后，也不承接上一条 → 不复读。这层统一门控同时覆盖 WS 路径
          // （其 classifyCarryForward 未单独 gate）。
          carryForwardHint: shouldInterrupt ? carryForwardHint : undefined,
          situationalContext,
          interruptionType: interruptionType ?? undefined,
          inputSource: "text",
          ttsTransport: runtime.getResolvedTtsTransport(),
          ensureSessionId: () => runtime.ensureDbSession(),
          ...(data.image ? { imageBase64: data.image } : {}),
        },
      ),
    )
    .catch((err) => logger.error("[pipeline]", { error: err, connId: runtime.connId }));
  runtime.setPipelineChain(nextPipelineChain);
}
