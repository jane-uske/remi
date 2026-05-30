import OpenAI from "openai";
import { withRetry } from "../utils/retry";
import { getConfig } from "../server/config";
import { createProxyFetch } from "./proxy_fetch";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionOptions {
  maxTokens?: number;
  temperature?: number;
  model?: string;
  signal?: AbortSignal;
  reasoningEffort?: string;
}

export interface StreamTokensCallbacks {
  onFirstRawChunk?: () => void;
  onFirstChunk?: () => void;
  onFirstReasoningChunk?: () => void;
  onFirstVisibleContent?: () => void;
}

export interface StreamTokensOptions {
  reasoningEffort?: string;
  model?: string;
}

let client: OpenAI | null = null;

export function buildLlmProviderOptions(thinkingMode?: string): Record<string, unknown> {
  if (thinkingMode !== "enabled" && thinkingMode !== "disabled") return {};
  return {
    thinking: {
      type: thinkingMode,
    },
  };
}

export function localLlmEnabled(): boolean {
  return getConfig().REMI_LOCAL_LLM_ENABLED;
}

export function hasLlmConfig(modelOverride?: string): boolean {
  const cfg = getConfig();
  const model = (modelOverride ?? cfg.REMI_LLM_MODEL)?.trim();
  return localLlmEnabled() && Boolean(cfg.REMI_LLM_API_KEY && cfg.REMI_LLM_BASE_URL && model);
}

function getClient(): OpenAI {
  if (!localLlmEnabled()) {
    throw new Error("LLM 已禁用：REMI_LOCAL_LLM_ENABLED=0");
  }
  if (client) return client;
  const cfg = getConfig();
  const apiKey = cfg.REMI_LLM_API_KEY;
  const baseURL = cfg.REMI_LLM_BASE_URL;
  if (!apiKey || !baseURL) throw new Error("LLM 未配置：缺少 key / base_url");
  const proxyFetch = createProxyFetch(baseURL);
  client = new OpenAI({
    apiKey,
    baseURL,
    ...(proxyFetch ? { fetch: proxyFetch } : {}),
  });
  return client;
}

/**
 * Non-streaming completion. Used by Slow Brain for background analysis.
 * Returns the full text with <think> blocks stripped.
 */
export async function complete(
  messages: ChatMessage[],
  maxTokens = 512,
  signal?: AbortSignal,
): Promise<string> {
  return completeWithOptions(messages, {
    maxTokens,
    signal,
    reasoningEffort: getConfig().REMI_SLOW_BRAIN_REASONING_EFFORT,
  });
}

export async function completeWithOptions(
  messages: ChatMessage[],
  options: CompletionOptions = {},
): Promise<string> {
  const openai = getClient();
  const cfg = getConfig();
  const model = options.model ?? cfg.REMI_LLM_MODEL;
  if (!model) throw new Error("LLM 未配置：缺少 model");

  const noThink = options.reasoningEffort === "none";
  const providerThinkingMode = noThink ? "disabled" : cfg.REMI_LLM_THINKING;
  const effectiveMessages = noThink
    ? messages.map((m, i) =>
        i === 0 && m.role === "system"
          ? { ...m, content: m.content + "\n/no_think" }
          : m,
      )
    : messages;

  const res = await withRetry(
    () =>
      (openai.chat.completions.create as Function)({
        model,
        messages: effectiveMessages,
        temperature: options.temperature ?? 0.3,
        max_tokens: options.maxTokens ?? 512,
        ...buildLlmProviderOptions(providerThinkingMode),
        ...(options.reasoningEffort && !noThink
          ? { reasoning_effort: options.reasoningEffort as "low" | "medium" | "high" }
          : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      }),
    { retries: 1, label: "complete" },
  ) as {
    choices?: {
      message?: {
        content?: string | null;
      };
    }[];
  };

  const raw = res.choices?.[0]?.message?.content ?? "";
  const stripped = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  // If all content was inside think tags and stripping leaves empty, return original
  return stripped || raw.trim();
}

/**
 * Stream tokens from the LLM, automatically filtering <think>...</think> blocks.
 * Accepts an optional AbortSignal to cancel mid-stream.
 */
export async function* streamTokens(
  messages: ChatMessage[],
  signal?: AbortSignal,
  callbacks?: StreamTokensCallbacks,
  options?: StreamTokensOptions,
): AsyncGenerator<string> {
  const openai = getClient();
  const cfg = getConfig();
  const model = options?.model ?? cfg.REMI_LLM_MODEL;
  if (!model) throw new Error("LLM 未配置：缺少 model");
  const onFirstRawChunk = callbacks?.onFirstRawChunk;
  const onFirstChunk = callbacks?.onFirstChunk;
  const onFirstReasoningChunk = callbacks?.onFirstReasoningChunk;
  const onFirstVisibleContent = callbacks?.onFirstVisibleContent;
  let hasNotifiedFirstChunk = false;
  let hasNotifiedFirstReasoningChunk = false;
  let hasNotifiedFirstVisibleContent = false;

  const noThink = options?.reasoningEffort === "none";
  const providerThinkingMode = noThink ? "disabled" : cfg.REMI_LLM_THINKING;
  const effectiveMessages = noThink
    ? messages.map((m, i) =>
        i === 0 && m.role === "system"
          ? { ...m, content: m.content + "\n/no_think" }
          : m,
      )
    : messages;

  const stream = (await withRetry(
    () =>
      (openai.chat.completions.create as Function)({
        model,
        messages: effectiveMessages,
        temperature: 0.7,
        max_tokens: 1024,
        ...buildLlmProviderOptions(providerThinkingMode),
        ...(options?.reasoningEffort && !noThink
          ? { reasoning_effort: options.reasoningEffort }
          : {}),
        stream: true,
        ...(signal ? { signal } : {}),
      }),
    { retries: 1, label: "streamTokens" },
  )) as AsyncIterable<{
    choices?: {
      delta?: {
        content?: string;
        reasoning_content?: string;
        role?: string;
      };
    }[];
  }>;

  let inThink = false;
  let buf = "";

  for await (const chunk of stream) {
    if (!hasNotifiedFirstChunk) {
      hasNotifiedFirstChunk = true;
      onFirstRawChunk?.();
      onFirstChunk?.();
    }
    if (signal?.aborted) break;

    const reasoningText = chunk.choices?.[0]?.delta?.reasoning_content;
    if (reasoningText && !hasNotifiedFirstReasoningChunk) {
      hasNotifiedFirstReasoningChunk = true;
      onFirstReasoningChunk?.();
    }

    const text = chunk.choices?.[0]?.delta?.content;
    if (!text) continue;

    buf += text;
    let out = "";

    while (buf) {
      if (inThink) {
        const end = buf.indexOf("</think>");
        if (end === -1) {
          // No closing tag found yet - keep the full buffer
          // don't truncate to last 8 bytes because we might need all of it next chunk
          break;
        }
        buf = buf.slice(end + 8);
        inThink = false;
      } else {
        const start = buf.indexOf("<think>");
        if (start !== -1) {
          out += buf.slice(0, start);
          buf = buf.slice(start + 7);
          inThink = true;
        } else {
          let cutoff = buf.length;
          for (let i = 1; i < 7; i++) {
            if (buf.endsWith("<think>".slice(0, i))) {
              cutoff = buf.length - i;
              break;
            }
          }
          out += buf.slice(0, cutoff);
          buf = buf.slice(cutoff);
          break;
        }
      }
    }

    if (out) {
      if (!hasNotifiedFirstVisibleContent) {
        hasNotifiedFirstVisibleContent = true;
        onFirstVisibleContent?.();
      }
      yield out;
    }
  }

  // If we're still in think mode after stream ends, it means the entire response is think content
  // output whatever is left (don't drop it)
  if (buf && !signal?.aborted) {
    // if still in think mode, output all remaining content since closing tag was never found
    if (!hasNotifiedFirstVisibleContent) {
      hasNotifiedFirstVisibleContent = true;
      onFirstVisibleContent?.();
    }
    yield buf;
  }
}
