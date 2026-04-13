const { loadModule } = require("../utils/module_loader") as typeof import("../utils/module_loader");
const { routeMessage } = loadModule<{
  routeMessage: typeof import("../brains/brain_router").routeMessage;
}>("../brains/brain_router");
import type { RouteMessageOptions } from "../brains/brain_router";
import type { RemSessionContext } from "../brains/rem_session_context";
import type { Emotion } from "../emotion/emotion_state";

export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Streams AI reply tokens for the given user message.
 * Internally delegates to Brain Router which drives Fast Brain (streaming)
 * and Slow Brain (background analysis) in parallel.
 */
export async function* chatStream(
  ctx: RemSessionContext,
  message: string,
  emotion: Emotion,
  signal?: AbortSignal,
  routeOpts?: RouteMessageOptions,
): AsyncGenerator<string> {
  yield* routeMessage(ctx, message, emotion, signal, routeOpts);
}
