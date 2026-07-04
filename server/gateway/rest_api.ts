import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { WebSocket } from "ws";

import { RemiSessionContext } from "../../brains/remi_session_context";
import { InterruptController } from "../../voice/interrupt_controller";
import { AvatarController } from "../../avatar/avatar_controller";
import { runPipeline } from "../pipeline/runner";
import { applyPersonaProfilePreset } from "../../persona";
import { isPersonaPresetId } from "../../persona/presets";
import { createLogger } from "../../infra/logger";
import { getConfig } from "../config";
import { isFamilyMemoryEnabled, queryFamilyMemory } from "../../brains/family_memory/client";
import type { ServerMessage } from "./types";

const logger = createLogger("rest-api");

// ── API Key Authentication ─────────────────────────────────────────

function verifyExternalApiKey(req: IncomingMessage): boolean {
  const apiKey = getConfig().REMI_EXTERNAL_API_KEY;
  if (!apiKey) return false;

  const provided = req.headers["x-remi-api-key"];
  if (typeof provided !== "string" || !provided) return false;

  const a = Buffer.from(apiKey, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ── JSON Body Parser ────────────────────────────────────────────────

async function readJsonBody<T>(
  req: IncomingMessage,
  maxBytes = 8192,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        reject(new Error("Body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as T);
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

// ── JSON Error Response Helper ──────────────────────────────────────

function jsonError(res: ServerResponse, status: number, error: string): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ error }));
}

// ── Mock WebSocket Adapter ──────────────────────────────────────────

function createSseWsAdapter(
  res: ServerResponse,
  onEnd: (fullContent: string, emotion: string) => void,
): WebSocket {
  let fullContent = "";

  const mock = {
    readyState: WebSocket.OPEN,
    send(data: string) {
      try {
        const msg: ServerMessage = JSON.parse(data);

        if (msg.type === "chat_chunk") {
          const sseEvent = JSON.stringify({
            type: "chunk",
            content: (msg as any).content,
          });
          res.write(`data: ${sseEvent}\n\n`);
          fullContent += (msg as any).content ?? "";
        } else if (msg.type === "chat_end") {
          // 回复出口时间守卫 drop 过句子时，chat_end 携带剔除后的终稿
          // （finalContent）；外部 API 的最终文本优先用它，与持久化一致，
          // 避免把守卫拦下的坏句原样交给外部调用方。
          const guardFinal = (msg as any).finalContent;
          onEnd(
            typeof guardFinal === "string" && guardFinal ? guardFinal : fullContent,
            (msg as any).emotion ?? "neutral",
          );
        }
      } catch {
        // malformed message — ignore
      }
    },
  } as unknown as WebSocket;

  return mock;
}

// ── POST /api/ext/chat ──────────────────────────────────────────────

interface ExtChatRequest {
  message: string;
  presetId?: string;
}

async function handleExtChat(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "POST") {
    jsonError(res, 405, "Method not allowed");
    return;
  }

  if (!verifyExternalApiKey(req)) {
    jsonError(res, 401, "Invalid or missing API key");
    return;
  }

  let body: ExtChatRequest;
  try {
    body = await readJsonBody<ExtChatRequest>(req);
  } catch {
    jsonError(res, 400, "Invalid request body");
    return;
  }

  const message = body.message?.trim();
  if (!message) {
    jsonError(res, 400, "Message is required");
    return;
  }
  if (message.length > 2000) {
    jsonError(res, 400, "Message too long (max 2000 chars)");
    return;
  }

  // ── Family Memory Intercept ───────────────────────────────────────
  if (isFamilyMemoryEnabled()) {
    try {
      const familyResult = await queryFamilyMemory(message);
      if (familyResult.handled) {
        logger.info("[family_memory] handled by family-memory service", {
          message: message.slice(0, 50),
          answerable: familyResult.answerable,
          reason: familyResult.reason,
          sourcesCount: familyResult.sources.length,
          resultSource: familyResult.resultSource,
        });
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type, X-Remi-Api-Key",
        });
        res.end(JSON.stringify({
          type: "family_memory",
          handled: true,
          answerable: familyResult.answerable,
          reason: familyResult.reason,
          answer: familyResult.answer,
          sources: familyResult.sources,
          resultSource: familyResult.resultSource,
        }));
        return;
      }
      // handled=false → fall through to main LLM pipeline
      logger.info("[family_memory] not handled, falling through to main LLM", {
        message: message.slice(0, 50),
        reason: familyResult.reason,
      });
    } catch (error) {
      // The family-memory service is an optional side path. If it's down, degrade
      // gracefully to the main LLM pipeline rather than failing the whole chat.
      const errorMsg = (error as Error).message ?? "unknown";
      logger.error("[family_memory] intercept failed, falling through to main LLM", {
        error: errorMsg,
      });
    }
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Remi-Api-Key",
  });

  const connId = `ext-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const ctx = new RemiSessionContext(connId);
  const ic = new InterruptController();
  const avatar = new AvatarController();
  const generationId = 1;
  const traceId = `ext-${connId}`;

  if (body.presetId && isPersonaPresetId(body.presetId)) {
    applyPersonaProfilePreset(ctx.persona, body.presetId);
  }

  const mockWs = createSseWsAdapter(res, (fullContent, emotion) => {
    const endEvent = JSON.stringify({ type: "end", content: fullContent, emotion });
    res.write(`data: ${endEvent}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  });

  req.on("close", () => {
    ic.interrupt();
    (mockWs as any).readyState = WebSocket.CLOSED;
  });

  try {
    await runPipeline(
      mockWs,
      message,
      ic,
      avatar,
      null,
      ctx,
      generationId,
      traceId,
      { inputSource: "text" },
    );

    if (!res.writableEnded) {
      const endEvent = JSON.stringify({ type: "end", content: "", emotion: "neutral" });
      res.write(`data: ${endEvent}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    }
  } catch (err) {
    logger.error("[REST API] Pipeline error", { error: err, connId });
    if (!res.writableEnded) {
      const errorEvent = JSON.stringify({ type: "error", content: "Pipeline failed" });
      res.write(`data: ${errorEvent}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    }
  }
}

// ── CORS Preflight ──────────────────────────────────────────────────

function handleCorsPreflight(res: ServerResponse): void {
  res.writeHead(204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Remi-Api-Key",
    "Access-Control-Max-Age": "86400",
  });
  res.end();
}

// ── Route Dispatcher ────────────────────────────────────────────────

export async function handleExtApi(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<void> {
  if (req.method === "OPTIONS") {
    handleCorsPreflight(res);
    return;
  }

  if (pathname === "/api/ext/chat") {
    await handleExtChat(req, res);
    return;
  }

  jsonError(res, 404, "Not found");
}
