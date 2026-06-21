// ── M3-P0 prompt 缓存断点抽象 ──────────────────────────────────────
// 把"易变内容只能在断点之后"这条铁律落进组装层，并按 provider 抽象出断点
// 策略。**注意**：本模块只负责"断点在哪 + provider 是谁"，绝不假定某个
// provider 一定复用前缀省 prefill —— 缓存收益一律视为 best-effort，待本地
// 栈探针确认后再决定是否在调用层做显式标注（如 Anthropic cache_control）。
// 设计见 docs/design/MEMORY_V3_DESIGN.md §13。
//
// ⚠️ STATUS: interface-only（M3-P0）。本模块导出纯函数 + 类型定义，
// 有完整测试覆盖，但 **未接入** 生产 prompt 组装/LLM 调用链路。
// prompt_builder 已通过消息顺序保证"时间块在断点之后"，
// 但不调用 planPromptCache 做标注。接入留待缓存探针确认收益后执行。

import type { PromptMessage } from "./prompt_builder";
import { TIME_CONTEXT_MARKER } from "./time_context";
import { getConfig } from "../server/config";

export type LlmCacheProvider =
  | "anthropic" // 显式 cache_control 断点 + TTL
  | "openai_auto" // 自动前缀缓存，靠稳定前缀命中
  | "local_prefix" // 自托管 vLLM/llama.cpp，enable_prefix_caching
  | "none"; // 未知 / 不缓存

/** 由 base URL 粗判 provider 缓存能力。仅用于选策略，不改变调用行为。 */
export function resolveCacheProvider(baseUrl?: string): LlmCacheProvider {
  let url = baseUrl;
  if (url === undefined) {
    try {
      url = getConfig().REMI_LLM_BASE_URL;
    } catch {
      url = "";
    }
  }
  const u = (url ?? "").toLowerCase();
  if (!u) return "none";
  if (u.includes("anthropic")) return "anthropic";
  if (
    u.includes("127.0.0.1") ||
    u.includes("localhost") ||
    u.includes("0.0.0.0")
  ) {
    return "local_prefix";
  }
  if (
    u.includes("openai.com") ||
    u.includes("dashscope") ||
    u.includes("deepseek") ||
    u.includes("/v1")
  ) {
    return "openai_auto";
  }
  return "none";
}

/**
 * 缓存断点 = 第一条"易变"消息的下标。它之前的内容是可缓存的稳定前缀；
 * 它（含）之后每轮都会变（时间上下文、当前 user 消息），绝不可进缓存前缀。
 *
 * 易变尾部 = 末尾 user 消息 + 紧邻其前的时间上下文块（若存在）。
 */
export function computeCacheBreakpoint(messages: PromptMessage[]): number {
  if (messages.length === 0) return 0;
  let userIdx = messages.length - 1;
  while (userIdx > 0 && messages[userIdx].role !== "user") userIdx--;
  let bp = userIdx;
  const prev = bp > 0 ? messages[bp - 1] : undefined;
  if (prev && prev.role === "system" && prev.content.startsWith(TIME_CONTEXT_MARKER)) {
    bp -= 1;
  }
  return bp;
}

export interface CachePlan {
  provider: LlmCacheProvider;
  /** 稳定前缀 = messages[0 .. breakpointIndex)，易变尾部 = messages[breakpointIndex ..]。 */
  breakpointIndex: number;
  /** 是否已对消息做了 provider 专属标注。P0 一律 false（只保序，不标注）。 */
  annotated: boolean;
}

/**
 * 规划缓存：给出 provider 与断点位置。P0 不对消息做任何标注（annotated=false），
 * 仅把"断点在哪"暴露给调用方，保证不假定 prefill 收益。
 */
export function planPromptCache(messages: PromptMessage[], baseUrl?: string): CachePlan {
  return {
    provider: resolveCacheProvider(baseUrl),
    breakpointIndex: computeCacheBreakpoint(messages),
    annotated: false,
  };
}
