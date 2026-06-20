import {
  collectStreamTokens,
  hasLlmConfig,
  localLlmEnabled,
  recoverVisibleReply,
} from "../llm/qwen_client";
import { buildPrompt, type PromptMessage } from "../brain/prompt_builder";
import type { Emotion } from "../emotion/emotion_state";
import type { Memory } from "../memory/memory_store";
import { createLogger } from "../infra/logger";
import { getConfig } from "../server/config";
import { estimateTextTokens } from "./history_budget";
import type { PersonaState } from "../persona";
import { getFastBrainModel } from "./fast_brain_model";

const logger = createLogger("reply_stream");

const FAST_BRAIN_REASONING_EFFORTS = new Set([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "default",
  "provider_default",
  "off",
]);

function getFastBrainReasoningEffort(): string | undefined {
  const raw = (
    process.env.REMI_FAST_BRAIN_REASONING_EFFORT ??
    process.env.REM_FAST_BRAIN_REASONING_EFFORT
  )
    ?.trim()
    .toLowerCase();
  if (!raw || raw === "default" || raw === "provider_default" || raw === "off") {
    return undefined;
  }
  if (FAST_BRAIN_REASONING_EFFORTS.has(raw)) {
    return raw;
  }
  logger.warn("忽略未知 fast-brain reasoning effort 配置", { value: raw });
  return undefined;
}

function isAbortLikeError(err: unknown): boolean {
  const error = err as { name?: string; message?: string };
  const name = error?.name ?? "";
  const message = (error?.message ?? "").toLowerCase();
  return (
    name === "AbortError" ||
    name === "APIUserAbortError" ||
    message.includes("abort")
  );
}

function llmFailureFallback(err: unknown): string {
  const error = err as {
    code?: string;
    status?: number;
    message?: string;
  };
  const code = error?.code ?? "";
  const status = error?.status;
  const message = (error?.message ?? "").toLowerCase();

  if (
    !localLlmEnabled() ||
    status === 401 ||
    code === "AuthenticationError" ||
    message.includes("api key") ||
    message.includes("authentication")
  ) {
    if (!localLlmEnabled()) {
      return "我这边的本地大脑现在被关掉了，先把 REMI_LOCAL_LLM_ENABLED 打开再试。";
    }
    return "我这边的大脑连接凭据不对，暂时没法回复。把 LLM 的 key 配好后再试一次。";
  }

  return "啊…出了点问题，等我缓缓再试试…";
}

export interface FastBrainInput {
  userMessage: string;
  emotion: Emotion;
  memory: Memory[];
  history: PromptMessage[];
  currentContext?: string;
  /** 由 Router 从 SlowBrainStore 注入 */
  strategyHints?: string;
  slowBrainContext?: string;
  deliberationBudget?: "text_normal" | "text_deliberate";
  reasoningEffortOverride?: string;
  signal?: AbortSignal;
  onFirstLlmChunk?: () => void;
  onFirstLlmReasoningChunk?: () => void;
  onFirstLlmVisibleContent?: () => void;
  /** Optional structured persona state for v1 personality system */
  persona?: PersonaState;
  connId?: string;
}

/**
 * Fast Brain: streams LLM tokens with minimum latency.
 * Receives pre-built context so it never waits on slow analysis.
 */
export async function* fastBrainStream(
  input: FastBrainInput,
): AsyncGenerator<string> {
  const reasoningEffort =
    input.reasoningEffortOverride && input.reasoningEffortOverride !== "provider_default"
      ? input.reasoningEffortOverride
      : getFastBrainReasoningEffort();
  const model = getFastBrainModel();
  const priorityParts = [input.strategyHints, input.slowBrainContext].filter(
    (s): s is string => Boolean(s?.trim()),
  );
  const priorityContext =
    priorityParts.length > 0 ? priorityParts.join("\n\n") : undefined;

  const messages = buildPrompt({
    memory: input.memory,
    emotion: input.emotion,
    history: input.history,
    userMessage: input.userMessage,
    currentContext: input.currentContext,
    priorityContext,
    persona: input.persona,
    connId: input.connId,
  });
  const promptText = messages.map((m) => m.content).join("\n");
  const promptChars = messages.reduce((sum, msg) => sum + msg.content.length, 0);
  const strategyChars = input.strategyHints?.length ?? 0;
  const currentContextChars = input.currentContext?.length ?? 0;
  const slowBrainContextChars = input.slowBrainContext?.length ?? 0;
  const systemChars = messages
    .filter((msg) => msg.role === "system")
    .reduce((sum, msg) => sum + msg.content.length, 0);
  const historyChars = input.history.reduce((sum, msg) => sum + msg.content.length, 0);
  const userChars = input.userMessage.length;
  const memoryChars = input.memory.reduce(
    (sum, entry) => sum + entry.key.length + entry.value.length,
    0,
  );
  logger.info("LLM prompt stats", {
    messages: messages.length,
    estimatedTokens: estimateTextTokens(promptText),
    promptChars,
    systemChars,
    historyChars,
    userChars,
    memoryChars,
    strategyChars,
    slowBrainContextChars,
    memoryCount: input.memory.length,
    historyMessages: input.history.length,
    currentContextChars,
    priorityChars: priorityContext?.length ?? 0,
    deliberationBudget: input.deliberationBudget ?? "unspecified",
    reasoningEffort: reasoningEffort ?? "provider_default",
    model: model ?? "unconfigured",
  });

  const configured = hasLlmConfig(model);

  if (!configured) {
    yield `嗯…我听到了「${input.userMessage.trim()}」，不过我现在还没连上大脑…等一下就好。`;
    return;
  }

  let hasContent = false;
  try {
    const streamCallbacks =
      input.onFirstLlmChunk ||
      input.onFirstLlmReasoningChunk ||
      input.onFirstLlmVisibleContent
        ? {
            onFirstChunk: input.onFirstLlmChunk,
            onFirstReasoningChunk: input.onFirstLlmReasoningChunk,
            onFirstVisibleContent: input.onFirstLlmVisibleContent,
          }
        : undefined;
    const streamResult = await collectStreamTokens(
      messages,
      input.signal,
      streamCallbacks,
      {
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(model ? { model } : {}),
      },
    );
    for (const token of streamResult.tokens) {
      hasContent = true;
      yield token;
    }
    if (!hasContent) {
      if (input.signal?.aborted) {
        logger.debug("LLM 空流结束（已中断）");
        return;
      }
      logger.warn("LLM 返回内容为空（thinking 已过滤）", {
        contentChars: streamResult.contentChars,
        reasoningChars: streamResult.reasoningChars,
        reasoningEffort: reasoningEffort ?? "provider_default",
        model: model ?? "unconfigured",
      });
      const recovered = await recoverVisibleReply(messages, {
        maxTokens: 512,
        signal: input.signal,
        reasoningEffort: reasoningEffort ?? "none",
        ...(model ? { model } : {}),
      });
      if (recovered) {
        yield recovered;
      } else {
        yield "啊…刚刚脑子卡了一下，你再说一次好不好？";
      }
    }
  } catch (err) {
    if (input.signal?.aborted || isAbortLikeError(err)) {
      logger.debug("LLM 调用已中断", { error: (err as Error).message });
      return;
    }
    logger.warn("LLM 调用失败", {
      error: (err as Error).message,
      code: (err as { code?: string }).code,
      status: (err as { status?: number }).status,
    });
    yield llmFailureFallback(err);
  }
}

/**
 * Fast Brain Prediction Only: 仅做LLM生成，不对外输出、不更新状态，用于partial transcript预判
 * 返回完整生成的文本，不会推送任何事件，仅用于缓存提前生成的内容
 */
export async function fastBrainPredictOnly(
  input: FastBrainInput,
): Promise<string> {
  const reasoningEffort =
    input.reasoningEffortOverride && input.reasoningEffortOverride !== "provider_default"
      ? input.reasoningEffortOverride
      : getFastBrainReasoningEffort();
  const model = getFastBrainModel();
  const priorityParts = [input.strategyHints, input.slowBrainContext].filter(
    (s): s is string => Boolean(s?.trim()),
  );
  const priorityContext =
    priorityParts.length > 0 ? priorityParts.join("\n\n") : undefined;

  const messages = buildPrompt({
    memory: input.memory,
    emotion: input.emotion,
    history: input.history,
    userMessage: input.userMessage,
    currentContext: input.currentContext,
    priorityContext,
    persona: input.persona,
    connId: input.connId,
  });
  const promptText = messages.map((m) => m.content).join("\n");
  const promptChars = messages.reduce((sum, msg) => sum + msg.content.length, 0);
  const strategyChars = input.strategyHints?.length ?? 0;
  const currentContextChars = input.currentContext?.length ?? 0;
  const slowBrainContextChars = input.slowBrainContext?.length ?? 0;
  const systemChars = messages
    .filter((msg) => msg.role === "system")
    .reduce((sum, msg) => sum + msg.content.length, 0);
  const historyChars = input.history.reduce((sum, msg) => sum + msg.content.length, 0);
  const userChars = input.userMessage.length;
  const memoryChars = input.memory.reduce(
    (sum, entry) => sum + entry.key.length + entry.value.length,
    0,
  );
  logger.debug("[预判] LLM prompt stats", {
    messages: messages.length,
    estimatedTokens: estimateTextTokens(promptText),
    promptChars,
    systemChars,
    historyChars,
    userChars,
    memoryChars,
    strategyChars,
    slowBrainContextChars,
    memoryCount: input.memory.length,
    historyMessages: input.history.length,
    currentContextChars,
    priorityChars: priorityContext?.length ?? 0,
    deliberationBudget: input.deliberationBudget ?? "unspecified",
    reasoningEffort: reasoningEffort ?? "provider_default",
    model: model ?? "unconfigured",
  });

  const configured = hasLlmConfig(model);

  if (!configured) {
    return `嗯…我听到了「${input.userMessage.trim()}」，不过我现在还没连上大脑…等一下就好。`;
  }

  let fullReply = "";
  try {
    const streamResult = await collectStreamTokens(
      messages,
      input.signal,
      input.onFirstLlmChunk ||
        input.onFirstLlmReasoningChunk ||
        input.onFirstLlmVisibleContent
        ? {
            onFirstChunk: input.onFirstLlmChunk,
            onFirstReasoningChunk: input.onFirstLlmReasoningChunk,
            onFirstVisibleContent: input.onFirstLlmVisibleContent,
          }
        : undefined,
      {
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(model ? { model } : {}),
      },
    );
    fullReply = streamResult.tokens.join("");
    if (!fullReply.trim()) {
      logger.warn("[预判] LLM 返回内容为空", {
        contentChars: streamResult.contentChars,
        reasoningChars: streamResult.reasoningChars,
      });
      return (
        (await recoverVisibleReply(messages, {
          maxTokens: 512,
          signal: input.signal,
          reasoningEffort: reasoningEffort ?? "none",
          ...(model ? { model } : {}),
        })) || ""
      );
    }
    logger.debug("[预判] 生成完成", { textLength: fullReply.length, preview: fullReply.slice(0, 30) });
    return fullReply.trim();
  } catch (err) {
    logger.debug("[预判] 调用失败或被中断", { error: (err as Error).message });
    return "";
  }
}
