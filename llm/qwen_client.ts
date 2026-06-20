import OpenAI from "openai";
import { withRetry } from "../utils/retry";
import { getConfig } from "../server/config";
import { createLogger } from "../infra/logger";
import { createProxyFetch } from "./proxy_fetch";

const logger = createLogger("qwen_client");

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
  maxTokens?: number;
}

export interface StreamTokenStats {
  contentChars: number;
  reasoningChars: number;
  visibleChars: number;
}

type ApiReasoningEffort = "none" | "low" | "medium" | "high";

const NO_THINK_DIRECTIVE =
  "\n【输出约束】直接用中文回复用户正文，不要输出思考过程，不要输出英文分析。";

const DIRECT_ANSWER_DIRECTIVE =
  "\n\n【输出约束】你必须输出给用户的最终中文正文，禁止留空，禁止只输出思考。";

let client: OpenAI | null = null;

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

export function stripThinkBlocks(raw: string): string {
  const stripped = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  return stripped || raw.trim();
}

export function appendNoThinkDirective(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m, i) =>
    i === 0 && m.role === "system"
      ? { ...m, content: `${m.content}${NO_THINK_DIRECTIVE}` }
      : m,
  );
}

export function appendDirectAnswerDirective(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m, i) =>
    i === 0 && m.role === "system"
      ? { ...m, content: `${m.content}${DIRECT_ANSWER_DIRECTIVE}` }
      : m,
  );
}

type ResolvedReasoning = {
  messages: ChatMessage[];
  apiReasoningEffort?: ApiReasoningEffort;
  mode: string;
};

function normalizeReasoningEffort(raw?: string): string | undefined {
  const value = raw?.trim().toLowerCase();
  if (!value || value === "default" || value === "provider_default" || value === "off") {
    return undefined;
  }
  return value;
}

/** Map Remi reasoning config to provider request shape (Qwen3 / LM Studio friendly). */
export function resolveReasoningRequest(
  messages: ChatMessage[],
  reasoningEffort?: string,
): ResolvedReasoning {
  const normalized = normalizeReasoningEffort(reasoningEffort);
  if (!normalized) {
    return { messages, mode: "provider_default" };
  }
  if (normalized === "none" || normalized === "minimal") {
    // LM Studio Qwen3: API reasoning_effort=none disables the reasoning_content
    // channel; "low" still fills reasoning_content and leaves content empty.
    return {
      messages: appendNoThinkDirective(messages),
      apiReasoningEffort: "none",
      mode: normalized,
    };
  }
  if (normalized === "low" || normalized === "medium" || normalized === "high") {
    return {
      messages,
      apiReasoningEffort: normalized,
      mode: normalized,
    };
  }
  if (normalized === "xhigh") {
    return { messages, apiReasoningEffort: "high", mode: normalized };
  }
  return { messages, mode: normalized };
}

function buildCompletionExtras(
  apiReasoningEffort?: ApiReasoningEffort,
  suppressThinking = false,
): Record<string, unknown> {
  const extras: Record<string, unknown> = {};
  if (apiReasoningEffort) {
    extras.reasoning_effort = apiReasoningEffort;
  }
  if (suppressThinking) {
    // Qwen3.6 official shape (vLLM / LM Studio when Jinja honors chat_template_kwargs).
    extras.top_p = 0.8;
    extras.extra_body = {
      top_k: 20,
      chat_template_kwargs: { enable_thinking: false },
    };
  }
  return extras;
}

function resolveFastBrainMaxTokens(override?: number): number {
  if (override && override > 0) return override;
  return getConfig().REMI_FAST_BRAIN_MAX_TOKENS;
}

function shouldSuppressThinking(mode: string): boolean {
  return mode === "none" || mode === "minimal";
}

function reasoningLooksReadyForSalvage(buf: string): boolean {
  if (/Output:\s*[\u4e00-\u9fff]/u.test(buf)) return true;
  const quoted = [...buf.matchAll(/[""「]([^""」\n]{12,})[""」]/gu)];
  return quoted.some((match) => chineseCharRatio(match[1]) >= 0.5);
}

function hasSubstantialChinese(text: string): boolean {
  return /[\u4e00-\u9fff]{4,}/u.test(text);
}

function chineseCharRatio(text: string): number {
  const chars = [...text];
  if (!chars.length) return 0;
  const zh = chars.filter((c) => /[\u4e00-\u9fff]/u.test(c)).length;
  return zh / chars.length;
}

/**
 * HauhauCS Qwen3.6 uncensored often fills reasoning_content while content stays empty
 * until very late (or never within max_tokens). Recover user-facing text when possible.
 */
export function salvageVisibleFromReasoning(reasoning: string): string {
  const src = reasoning.trim();
  if (!src) return "";

  const outputLine = /(?:^|\n)\s*Output:\s*(.+)$/im.exec(src);
  if (outputLine?.[1]) {
    const line = outputLine[1].trim();
    if (hasSubstantialChinese(line)) return line;
  }

  const quoted = [...src.matchAll(/[""「]([^""」\n]{4,})[""」]/gu)];
  for (let i = quoted.length - 1; i >= 0; i--) {
    const candidate = quoted[i][1].trim();
    if (hasSubstantialChinese(candidate) && chineseCharRatio(candidate) >= 0.35) {
      return candidate;
    }
  }

  const paragraphs = src
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  for (let i = paragraphs.length - 1; i >= 0; i--) {
    const p = paragraphs[i].replace(/^[-*✅\s]+/u, "").trim();
    if (hasSubstantialChinese(p) && chineseCharRatio(p) >= 0.35) {
      return p;
    }
  }

  return "";
}

function extractVisibleMessageContent(message: {
  content?: string | null;
  reasoning_content?: string | null;
}): { visible: string; reasoningChars: number; salvagedFromReasoning: boolean } {
  const raw = message.content ?? "";
  let visible = stripThinkBlocks(raw);
  const reasoning = message.reasoning_content ?? "";
  const reasoningChars = reasoning.length;
  let salvagedFromReasoning = false;

  if (!visible.trim() && reasoningChars > 0) {
    const salvaged = salvageVisibleFromReasoning(reasoning);
    if (salvaged) {
      visible = salvaged;
      salvagedFromReasoning = true;
    }
  }

  return { visible, reasoningChars, salvagedFromReasoning };
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
  const model = options.model ?? getConfig().REMI_LLM_MODEL;
  if (!model) throw new Error("LLM 未配置：缺少 model");

  const resolved = resolveReasoningRequest(messages, options.reasoningEffort);

  const res = await withRetry(
    () =>
      openai.chat.completions.create({
        model,
        messages: resolved.messages,
        temperature: options.temperature ?? 0.3,
        max_tokens: options.maxTokens ?? 512,
        ...buildCompletionExtras(
          resolved.apiReasoningEffort,
          shouldSuppressThinking(resolved.mode),
        ),
        ...(options.signal ? { signal: options.signal } : {}),
      }),
    { retries: 1, label: "complete" },
  );

  const message = res.choices?.[0]?.message ?? {};
  const { visible, reasoningChars, salvagedFromReasoning } = extractVisibleMessageContent(
    message as { content?: string | null; reasoning_content?: string | null },
  );
  if (!visible) {
    logger.warn("LLM non-stream visible content empty", {
      model,
      reasoningMode: resolved.mode,
      reasoningChars,
      contentChars: (message.content ?? "").length,
    });
  } else if (salvagedFromReasoning) {
    logger.info("LLM visible reply salvaged from reasoning channel", {
      model,
      reasoningMode: resolved.mode,
      chars: visible.length,
    });
  }
  return visible;
}

/**
 * Recover a visible assistant reply when streaming yielded no user-facing tokens.
 * Retries with stronger direct-answer constraints before giving up.
 */
export async function recoverVisibleReply(
  messages: ChatMessage[],
  options: {
    model?: string;
    signal?: AbortSignal;
    reasoningEffort?: string;
    maxTokens?: number;
  } = {},
): Promise<string> {
  const efforts = Array.from(
    new Set(
      [options.reasoningEffort ?? "none", "none", "low"].map((v) => v?.trim()).filter(Boolean),
    ),
  );

  for (const effort of efforts) {
    const direct = await completeWithOptions(messages, {
      model: options.model,
      signal: options.signal,
      maxTokens: options.maxTokens ?? 512,
      reasoningEffort: effort,
      temperature: 0.45,
    }).catch((err) => {
      logger.warn("LLM recover attempt failed", {
        effort,
        error: (err as Error).message,
      });
      return "";
    });
    if (direct.trim()) {
      logger.info("LLM recover succeeded", { effort, chars: direct.length });
      return direct.trim();
    }

    const reinforced = await completeWithOptions(appendDirectAnswerDirective(messages), {
      model: options.model,
      signal: options.signal,
      maxTokens: options.maxTokens ?? 512,
      reasoningEffort: effort,
      temperature: 0.55,
    }).catch((err) => {
      logger.warn("LLM reinforced recover failed", {
        effort,
        error: (err as Error).message,
      });
      return "";
    });
    if (reinforced.trim()) {
      logger.info("LLM reinforced recover succeeded", {
        effort,
        chars: reinforced.length,
      });
      return reinforced.trim();
    }
  }

  logger.error("LLM recover exhausted all attempts");
  return "";
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
  const stats = await collectStreamTokens(messages, signal, callbacks, options);
  for (const token of stats.tokens) {
    yield token;
  }
}

export async function collectStreamTokens(
  messages: ChatMessage[],
  signal?: AbortSignal,
  callbacks?: StreamTokensCallbacks,
  options?: StreamTokensOptions,
): Promise<StreamTokenStats & { tokens: string[] }> {
  const openai = getClient();
  const model = options?.model ?? getConfig().REMI_LLM_MODEL;
  if (!model) throw new Error("LLM 未配置：缺少 model");
  const onFirstRawChunk = callbacks?.onFirstRawChunk;
  const onFirstChunk = callbacks?.onFirstChunk;
  const onFirstReasoningChunk = callbacks?.onFirstReasoningChunk;
  const onFirstVisibleContent = callbacks?.onFirstVisibleContent;
  let hasNotifiedFirstChunk = false;
  let hasNotifiedFirstReasoningChunk = false;
  let hasNotifiedFirstVisibleContent = false;

  const resolved = resolveReasoningRequest(messages, options?.reasoningEffort);
  const maxTokens = resolveFastBrainMaxTokens(options?.maxTokens);
  const suppressThinking = shouldSuppressThinking(resolved.mode);

  const stream = (await withRetry(
    () =>
      (openai.chat.completions.create as Function)({
        model,
        messages: resolved.messages,
        temperature: 0.7,
        max_tokens: maxTokens,
        ...buildCompletionExtras(resolved.apiReasoningEffort, suppressThinking),
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
  let reasoningBuf = "";
  let contentChars = 0;
  let reasoningChars = 0;
  let visibleChars = 0;
  let earlySalvageEmitted = false;
  const tokens: string[] = [];

  for await (const chunk of stream) {
    if (!hasNotifiedFirstChunk) {
      hasNotifiedFirstChunk = true;
      onFirstRawChunk?.();
      onFirstChunk?.();
    }
    if (signal?.aborted) break;

    const reasoningText = chunk.choices?.[0]?.delta?.reasoning_content;
    if (reasoningText) {
      reasoningChars += reasoningText.length;
      reasoningBuf += reasoningText;
      if (!hasNotifiedFirstReasoningChunk) {
        hasNotifiedFirstReasoningChunk = true;
        onFirstReasoningChunk?.();
      }
      if (
        suppressThinking &&
        !earlySalvageEmitted &&
        visibleChars === 0 &&
        reasoningLooksReadyForSalvage(reasoningBuf)
      ) {
        const salvaged = salvageVisibleFromReasoning(reasoningBuf);
        if (salvaged && hasSubstantialChinese(salvaged)) {
          earlySalvageEmitted = true;
          if (!hasNotifiedFirstVisibleContent) {
            hasNotifiedFirstVisibleContent = true;
            onFirstVisibleContent?.();
          }
          visibleChars += salvaged.length;
          tokens.push(salvaged);
          logger.info("LLM stream early salvage from reasoning channel", {
            model,
            reasoningMode: resolved.mode,
            chars: salvaged.length,
            reasoningChars,
          });
        }
      }
    }

    const text = chunk.choices?.[0]?.delta?.content;
    if (!text) continue;
    contentChars += text.length;

    buf += text;
    let out = "";

    while (buf) {
      if (inThink) {
        const end = buf.indexOf("</think>");
        if (end === -1) {
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
      if (earlySalvageEmitted) {
        // Prefer the real content channel once it opens (drop reasoning salvage).
        tokens.length = 0;
        visibleChars = 0;
        earlySalvageEmitted = false;
      }
      if (!hasNotifiedFirstVisibleContent) {
        hasNotifiedFirstVisibleContent = true;
        onFirstVisibleContent?.();
      }
      visibleChars += out.length;
      tokens.push(out);
    }
  }

  if (buf && !signal?.aborted) {
    if (!hasNotifiedFirstVisibleContent) {
      hasNotifiedFirstVisibleContent = true;
      onFirstVisibleContent?.();
    }
    visibleChars += buf.length;
    tokens.push(buf);
  }

  if (visibleChars === 0 && !signal?.aborted) {
    const salvaged = salvageVisibleFromReasoning(reasoningBuf);
    if (salvaged) {
      if (!hasNotifiedFirstVisibleContent) {
        hasNotifiedFirstVisibleContent = true;
        onFirstVisibleContent?.();
      }
      visibleChars += salvaged.length;
      tokens.push(salvaged);
      logger.info("LLM stream salvaged visible reply from reasoning channel", {
        model,
        reasoningMode: resolved.mode,
        chars: salvaged.length,
        reasoningChars,
      });
    } else {
      logger.warn("LLM stream produced no visible tokens", {
        model,
        reasoningMode: resolved.mode,
        contentChars,
        reasoningChars,
      });
    }
  }

  return { tokens, contentChars, reasoningChars, visibleChars };
}