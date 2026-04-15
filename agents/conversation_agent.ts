import fs from "fs";
import path from "path";
import type { RouteMessageOptions } from "../brains/brain_router";
import type { RemiSessionContext } from "../brains/remi_session_context";
import type { Emotion } from "../emotion/emotion_state";

function resolveBrainRouterModulePath(): string {
  const jsPath = path.resolve(__dirname, "../brains/brain_router.js");
  if (fs.existsSync(jsPath)) return jsPath;
  return path.resolve(__dirname, "../brains/brain_router.ts");
}

const { routeMessage }: typeof import("../brains/brain_router") = require(resolveBrainRouterModulePath());

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
  ctx: RemiSessionContext,
  message: string,
  emotion: Emotion,
  signal?: AbortSignal,
  routeOpts?: RouteMessageOptions,
): AsyncGenerator<string> {
  yield* routeMessage(ctx, message, emotion, signal, routeOpts);
}
