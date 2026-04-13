import { fastBrainStream } from "./fast_brain";
import { trimHistoryToTokenBudget } from "./history_budget";
import { runSlowBrain } from "./slow_brain";
import { isFallbackAssistantReply } from "./assistant_reply_guard";
import { extractMemory, retrievePromptMemory } from "../memory/memory_agent";
import type { PromptMessage } from "../brain/prompt_builder";
import type { Emotion } from "../emotion/emotion_state";
import type { RemiSessionContext } from "./remi_session_context";
import { createLogger } from "../infra/logger";
import {
  relationshipStateEnabled,
  savePersistentRelationshipState,
} from "../memory/relationship_state";

const MAX_HISTORY = 10;
const logger = createLogger("brain_router");

function slowBrainEnabled(): boolean {
  const raw = (process.env.REMI_SLOW_BRAIN_ENABLED ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false";
}

export interface RouteMessageOptions {
  /** 服务端触发的陪伴搭话：不跑记忆提取与慢脑，历史中 user 用短占位 */
  systemTriggered?: boolean;
  /** 阶段1增量输入命中预判时，复用已生成回复，避免再次触发LLM。 */
  pregeneratedReply?: string;
  /** 打断承接提示，帮助快脑把新一轮回复接在正确的会话分支上。 */
  carryForwardHint?: string;
}

async function persistContinuityCueState(ctx: RemiSessionContext): Promise<void> {
  if (!relationshipStateEnabled()) return;
  const relationshipRepo =
    ctx.persistentRelationshipRepo ??
    ctx.memory.getPersistentBackend() ??
    ctx.memory;
  if (!relationshipRepo) return;

  try {
    await savePersistentRelationshipState(
      relationshipRepo,
      ctx.slowBrain.exportPersistentState(),
    );
  } catch (err) {
    logger.warn("连续性提示持久化失败", {
      connId: ctx.connId,
      error: (err as Error).message,
    });
  }
}

/**
 * Brain Router: dispatches user input to both brains.
 *
 *  ┌─────────┐   stream tokens   ┌──────────┐
 *  │  Router  │ ────────────────► │Fast Brain│ ──► caller
 *  └────┬────┘                    └──────────┘
 *       │  fire-and-forget
 *       └───────────────────────► ┌──────────┐
 *                                 │Slow Brain│ (background)
 *                                 └──────────┘
 *
 * Slow brain NEVER blocks the token stream.
 */
export async function* routeMessage(
  ctx: RemiSessionContext,
  userMessage: string,
  emotion: Emotion,
  signal?: AbortSignal,
  opts?: RouteMessageOptions,
): AsyncGenerator<string> {
  ctx.cancelSlowBrain();

  // 处理「刚才说到哪了」查询
  const interruptedQueryRegex = /^(刚才|刚刚|刚刚|刚才)(说到哪|说什么|在说啥|讲到哪)/i;
  if (interruptedQueryRegex.test(userMessage.trim()) && ctx.lastInterruptedReply) {
    yield `我刚才说到：${ctx.lastInterruptedReply}`;
    return;
  }

  if (!opts?.systemTriggered) {
    extractMemory(userMessage, ctx.memory);
  }
  const memory = await retrievePromptMemory(ctx.memory, {
    userId: ctx.userId,
    userMessage,
    slowBrainSnapshot: ctx.slowBrain.getSnapshot(),
  });

  const slowBrainContext = ctx.slowBrain.synthesizeContext();
  const historyForPrompt = trimHistoryToTokenBudget([...ctx.history]);
  const pregeneratedReply = opts?.pregeneratedReply?.trim();
  const carryForwardHint = opts?.carryForwardHint?.trim();
  const guidance = ctx.slowBrain.buildConversationGuidance(userMessage);

  let fullReply = "";
  if (pregeneratedReply) {
    logger.info("复用 partial transcript 预判回复", {
      replyChars: pregeneratedReply.length,
      userChars: userMessage.length,
    });
    fullReply = pregeneratedReply;
    yield pregeneratedReply;
  } else {
    for await (const token of fastBrainStream({
      userMessage,
      emotion,
      memory,
      history: historyForPrompt,
      slowBrainContext,
      strategyHints: [
        guidance.hints,
        carryForwardHint,
      ]
        .filter((part): part is string => Boolean(part?.trim()))
        .join("\n\n"),
      signal,
      persona: ctx.persona,
    })) {
      fullReply += token;
      yield token;
    }
  }

  if (signal?.aborted) {
    if (!opts?.systemTriggered && fullReply.trim()) {
      ctx.lastInterruptedReply = fullReply;
    }
    ctx.updateLiveState(emotion);
    if (!opts?.systemTriggered) {
      ctx.markInterrupted();
    }
    return;
  }

  const historyUserContent = opts?.systemTriggered
    ? "［你主动开口陪对方聊天］"
    : userMessage;
  const shouldPersistAssistantReply = !isFallbackAssistantReply(fullReply);
  // Update history
  ctx.history.push({ role: "user", content: historyUserContent });
  if (shouldPersistAssistantReply) {
    ctx.history.push({ role: "assistant", content: fullReply });
  }
  while (ctx.history.length > MAX_HISTORY) {
    ctx.history.shift();
  }

  // Update live persona state after interaction
  ctx.updateLiveState(
    emotion,
    userMessage,
    fullReply
  );
  ctx.slowBrain.recordUserTurnActivity(userMessage);
  ctx.slowBrain.setLastEmotion(emotion);

  ctx.slowBrain.markContinuityCueUsed({
    proactiveCandidate: guidance.proactiveCandidate,
    sharedMomentCandidate: guidance.sharedMomentCandidate,
  });

  if (!opts?.systemTriggered && shouldPersistAssistantReply && slowBrainEnabled()) {
    const slowBrainSignal = ctx.beginSlowBrain();
    runSlowBrain({
      userId: ctx.userId,
      userMessage,
      assistantReply: fullReply,
      history: [...ctx.history],
      slowBrain: ctx.slowBrain,
      memoryRepo: ctx.memory,
      relationshipRepo:
        ctx.persistentRelationshipRepo ??
        ctx.memory.getPersistentBackend() ??
        ctx.memory,
      signal: slowBrainSignal,
    }).catch((err) =>
      logger.warn("后台分析失败", { error: (err as Error).message }),
    ).finally(() => {
      ctx.endSlowBrain(slowBrainSignal);
    });
  } else if (!opts?.systemTriggered && !shouldPersistAssistantReply) {
    logger.info("skip history persistence for fallback assistant reply", {
      connId: ctx.connId,
      preview: fullReply.slice(0, 40),
    });
  } else if (!opts?.systemTriggered) {
    logger.debug("slow brain skipped by budget gate", {
      connId: ctx.connId,
    });
    await persistContinuityCueState(ctx);
  }
}
