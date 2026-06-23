import type { IncomingMessage, ServerResponse } from "node:http";
import { WebSocket } from "ws";

import { createLogger } from "../../infra/logger";
import { resolveRequestUserIdentity } from "../../infra/user_identity";
import type { MessageSink, ServerMessage } from "./types";
import {
  textSessionPool,
  buildTextChatRuntime,
  type PoolEntry,
} from "../session/pool";
import { handleSessionTextChat } from "../session/text_chat";
import { sendSessionHistoryPage, parseHistoryCursor } from "../session/history";
import { isNsfwEnabled } from "../../brains/nsfw_mode";
import {
  setSessionMlxVoiceStyle,
  setSessionMlxSpeedModifier,
  setSessionMlxPitchModifier,
} from "../../voice/tts_runtime_overrides";

const logger = createLogger("sse-chat");

// ── SseResponseSink ────────────────────────────────────────────────

export class SseResponseSink implements MessageSink {
  private _open = true;

  constructor(private readonly res: ServerResponse) {
    res.on("close", () => { this._open = false; });
  }

  get readyState(): number {
    return this._open && !this.res.writableEnded ? WebSocket.OPEN : WebSocket.CLOSED;
  }

  send(data: string): void {
    if (!this._open || this.res.writableEnded) return;
    try {
      const msg: ServerMessage = JSON.parse(data);
      this.res.write(`event: ${msg.type}\ndata: ${data}\n\n`);
    } catch {
      this.res.write(`event: message\ndata: ${data}\n\n`);
    }
  }

  end(): void {
    if (!this.res.writableEnded) {
      this.res.write("event: done\ndata: {}\n\n");
      this.res.end();
    }
    this._open = false;
  }
}

// ── Helpers ────────────────────────────────────────────────────────

async function readJsonBody<T>(
  req: IncomingMessage,
  maxBytes = 16384,
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

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function jsonError(res: ServerResponse, status: number, error: string): void {
  jsonResponse(res, status, { error });
}

function extractSessionToken(req: IncomingMessage): string | null {
  const header = req.headers["x-remi-session"];
  if (typeof header === "string" && header.trim()) return header.trim();
  return null;
}

function sseHeaders(res: ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });
}

// ── POST /api/chat ─────────────────────────────────────────────────

interface ChatRequest {
  content: string;
  situational?: string;
  image?: string;
  /**
   * 客户端时区（IANA，如 "Asia/Hong_Kong"）。SSE 没有 WS 的 client_context 帧，
   * 时区只能随每次 POST 捎带；不传则 brain 回退容器时区（Docker 内为 UTC）。
   */
  timeZone?: string | null;
  /** 客户端 locale（如 "zh-HK"），用途同上。 */
  locale?: string | null;
  /** Voice style override — synced from client localStorage each turn. */
  voiceStyleId?: string | null;
  speedModifier?: string | null;
  pitchModifier?: string | null;
}

async function handleChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    jsonError(res, 405, "Method not allowed");
    return;
  }

  const identity = resolveRequestUserIdentity(req);

  let body: ChatRequest;
  try {
    // 10MB ceiling: text is tiny, but an attached image rides as a base64 data
    // URL and easily exceeds the default 16KB limit.
    body = await readJsonBody<ChatRequest>(req, 10 * 1024 * 1024);
  } catch {
    jsonError(res, 400, "Invalid request body");
    return;
  }

  const content = body.content?.trim();
  if (!content) {
    jsonError(res, 400, "content is required");
    return;
  }

  const existingToken = extractSessionToken(req);
  let entry: PoolEntry;

  if (existingToken) {
    const existing = textSessionPool.get(existingToken);
    if (existing) {
      entry = existing;
    } else {
      entry = await textSessionPool.acquire(identity.storageUserId, identity.authPrincipal);
    }
  } else {
    entry = await textSessionPool.acquire(identity.storageUserId, identity.authPrincipal);
  }

  sseHeaders(res);
  res.write(`event: session\ndata: ${JSON.stringify({ token: entry.token })}\n\n`);

  // SSE 客户端没有 WS 的 client_context 帧，时区/locale 只能随每次 POST 捎带。
  // 不设的话 brain.getClientTimeZone() 为 null，时间能力/时间上下文会回退到容器
  // 时区（Docker 内为 UTC），导致答错时间、误判"凌晨/刚睡醒"。只在带了时区时设，
  // 避免无时区的请求把已设好的值清掉。
  if (body.timeZone) {
    entry.brain.setClientContext({
      timeZone: body.timeZone,
      locale: body.locale ?? entry.brain.getClientLocale(),
    });
  }

  // Apply voice style overrides from client localStorage so TTS uses the
  // user's chosen voice even though set_voice_style only travels over WS.
  if (body.voiceStyleId !== undefined) {
    setSessionMlxVoiceStyle(entry.connId, body.voiceStyleId);
  }
  if (body.speedModifier !== undefined) {
    setSessionMlxSpeedModifier(entry.connId, body.speedModifier);
  }
  if (body.pitchModifier !== undefined) {
    setSessionMlxPitchModifier(entry.connId, body.pitchModifier);
  }

  const sink = new SseResponseSink(res);
  const runtime = buildTextChatRuntime(entry, sink);

  const pipelineDone = new Promise<void>((resolve) => {
    const originalSet = runtime.setPipelineChain;
    runtime.setPipelineChain = (next: Promise<void>) => {
      originalSet(next);
      void next.then(resolve, resolve);
    };
  });

  handleSessionTextChat(runtime, {
    content,
    situational: body.situational ?? null,
    image: body.image ?? null,
  });

  req.on("close", () => {
    if (!res.writableEnded) {
      entry.interrupt.interrupt();
    }
  });

  await pipelineDone;
  // Report current adult-mode state so the client UI (layout / theme) reflects a
  // toggle made this turn. The WS-based nsfw notifier doesn't cover SSE pool
  // connections, so without this an "开启成人模式" over SSE never flips the UI.
  sink.send(JSON.stringify({ type: "nsfw_mode_state", enabled: isNsfwEnabled(entry.connId) }));
  sink.end();
}

// ── GET /api/chat/history ──────────────────────────────────────────

async function handleHistory(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") {
    jsonError(res, 405, "Method not allowed");
    return;
  }

  const identity = resolveRequestUserIdentity(req);

  const url = new URL(req.url ?? "/", "http://localhost");
  const rawCursor = url.searchParams.get("cursor");
  let cursor = null;
  if (rawCursor) {
    try {
      cursor = parseHistoryCursor(JSON.parse(rawCursor));
    } catch { /* ignore */ }
  }
  const pageSize = Math.min(
    Math.max(parseInt(url.searchParams.get("pageSize") ?? "20", 10) || 20, 1),
    50,
  );

  const messages: unknown[] = [];
  const collectSink: MessageSink = {
    get readyState() { return WebSocket.OPEN; },
    send(data: string) {
      try {
        const msg = JSON.parse(data);
        if (msg.type === "history_page") {
          messages.push(msg);
        }
      } catch { /* ignore */ }
    },
  };

  await sendSessionHistoryPage({
    sink: collectSink,
    storageUserId: identity.storageUserId,
    connId: "history-api",
    pageSize,
    mode: "replace",
    cursor,
  });

  jsonResponse(res, 200, messages[0] ?? { type: "history_page", mode: "replace", messages: [], hasMore: false, nextCursor: null });
}

// ── GET /api/chat/events (EventSource for push notifications) ──────

async function handleEvents(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") {
    jsonError(res, 405, "Method not allowed");
    return;
  }

  const sessionToken = extractSessionToken(req);
  if (!sessionToken) {
    jsonError(res, 400, "X-Remi-Session header required");
    return;
  }

  const entry = textSessionPool.get(sessionToken);
  if (!entry) {
    jsonError(res, 404, "Session not found");
    return;
  }

  sseHeaders(res);
  res.write(`event: connected\ndata: ${JSON.stringify({ connId: entry.connId })}\n\n`);

  const keepAlive = setInterval(() => {
    if (!res.writableEnded) {
      res.write(":keepalive\n\n");
    }
  }, 15_000);

  req.on("close", () => {
    clearInterval(keepAlive);
  });
}

// ── Route dispatcher ───────────────────────────────────────────────

export async function handleSseChatApi(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<void> {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Remi-Session",
      "Access-Control-Max-Age": "86400",
    });
    res.end();
    return;
  }

  if (pathname === "/api/chat") {
    await handleChat(req, res);
    return;
  }
  if (pathname === "/api/chat/history") {
    await handleHistory(req, res);
    return;
  }
  if (pathname === "/api/chat/events") {
    await handleEvents(req, res);
    return;
  }

  jsonError(res, 404, "Not found");
}
