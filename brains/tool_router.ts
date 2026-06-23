/**
 * Semi-agent Tool Router.
 *
 * Capability dispatch strategy for the Remi reply path:
 *
 *   1. Regex fast-path (brain/direct_capabilities.ts) — zero-latency, catches
 *      explicit requests ("画一只猫", "开启成人模式").
 *   2. THIS router — a clean, minimal, reasoning-off LLM function-calling call
 *      that catches the AMBIGUOUS phrasings regex misses ("不穿衣服呢？" →
 *      generate_image). It runs only when a broad keyword prefilter fires, so
 *      pure emotional chat never pays the extra call.
 *   3. Main reply brain — never given tools, stays fully in-character.
 *
 * Why a separate router instead of attaching tools to the reply prompt: the
 * local uncensored model ignores tools (and fabricates fake image URLs) when
 * they sit under the heavy ~2k-char persona prompt + history. Given a clean
 * minimal request it emits tool_calls reliably (validated 100% across explicit
 * / ambiguous / pure-chat phrasings). This keeps the in-character voice intact
 * while still getting reliable capability dispatch — no model swap needed.
 */

import type { RemiSessionContext } from "./remi_session_context";
import { buildToolsParam } from "../brain/tool_registry";
import {
  routeToolCalls,
  hasLlmConfig,
  type ChatMessage,
  type StreamToolCall,
} from "../llm/qwen_client";
import { getFastBrainModel } from "./fast_brain_model";
import { createLogger } from "../infra/logger";

const logger = createLogger("tool_router");

// Tuned for precision on the local model: fires on explicit requests but NOT on
// appearance compliments / observations ("你今天好漂亮", "你笑起来真好看"), which
// would otherwise trigger unsolicited image generation. Validated 13/14 across
// explicit-request / compliment / pure-chat phrasings; the model is sensitive to
// wording (more elaborate framings regressed precision), so edit + re-probe
// before changing. See /tmp probe or test fixtures.
const ROUTER_SYSTEM_PROMPT =
  "你是一个函数调用路由器。只在用户【明确要求】你做某件事时才调用对应工具，并用中文填参数。" +
  "判定原则：" +
  "generate_image —— 用户明确要你画图/生成图片/发自拍照片，或明确要你「看看你的样子/长相/穿什么」。" +
  "若用户只是评价、描述、夸你或闲聊（例如「你看起来很开心」「你今天好漂亮」「你笑起来真好看」），不要调用。" +
  "generate_video —— 用户明确要你生成视频/动画。" +
  "toggle_adult_mode —— 用户明确说要开启或退出成人模式。" +
  "get_current_time —— 用户在问现在几点/今天日期。" +
  "其余一切普通聊天、情感倾诉、对你的评价或描述，都不要调用任何工具、也不要输出任何文字。不要解释、不要寒暄。";

/**
 * Broad, cheap, HIGH-RECALL prefilter. Its only job is to keep the extra
 * router LLM call off pure emotional-chat turns (latency is priority #1). It is
 * intentionally loose — precision is the router LLM's job. A false positive
 * just costs one (correct, no-tool) router call; a false negative falls through
 * to a normal in-character reply with no capability dispatch (no worse than
 * regex-only before this router existed).
 */
const CAPABILITY_HINT =
  /画|图|照片|相片|自拍|样子|长什么样|看看你|穿|裸|身材|视频|动画|影片|短片|成人模式|涩涩|色色|nsfw|开车|几点|日期|星期|礼拜几|今天几号|现在时间|时间/iu;

export function toolRouterPrefilter(userMessage: string): boolean {
  const trimmed = userMessage.trim();
  // Very long inputs are essays/pastes, not capability commands — skip.
  if (!trimmed || trimmed.length > 200) return false;
  return CAPABILITY_HINT.test(trimmed);
}

// Hard timeout: the router sits on the reply critical path, so a slow/hung LLM
// endpoint must never stall the turn. On timeout we fall through to a normal
// in-character reply (no capability dispatch) — strictly no worse than before.
const TOOL_ROUTER_TIMEOUT_MS = 4000;

/**
 * Run the tool router for one user message. Returns the tool calls the model
 * chose (empty when it decided this is just chat, or on any failure — the
 * caller then falls through to a normal reply).
 */
export async function routeMessageTools(input: {
  userMessage: string;
  ctx: RemiSessionContext;
  signal?: AbortSignal;
}): Promise<StreamToolCall[]> {
  const tools = buildToolsParam({ ctx: input.ctx });
  if (tools.length === 0) return [];

  const model = getFastBrainModel();
  if (!hasLlmConfig(model)) return [];

  const messages: ChatMessage[] = [
    { role: "system", content: ROUTER_SYSTEM_PROMPT },
    { role: "user", content: input.userMessage },
  ];

  // Abort the routing call on EITHER the turn's abort signal (user interrupt)
  // OR the hard timeout, whichever fires first.
  if (input.signal?.aborted) return [];
  const controller = new AbortController();
  const onTurnAbort = () => controller.abort();
  input.signal?.addEventListener("abort", onTurnAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), TOOL_ROUTER_TIMEOUT_MS);

  try {
    const toolCalls = await routeToolCalls(messages, tools, {
      ...(model ? { model } : {}),
      signal: controller.signal,
    });
    if (toolCalls.length > 0) {
      logger.info("tool router selected tools", {
        connId: input.ctx.connId,
        tools: toolCalls.map((tc) => tc.name),
      });
    }
    return toolCalls;
  } catch (err) {
    if (input.signal?.aborted) return [];
    logger.warn("tool router failed/timed out, falling back to plain reply", {
      connId: input.ctx.connId,
      error: (err as Error).message,
    });
    return [];
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", onTurnAbort);
  }
}
