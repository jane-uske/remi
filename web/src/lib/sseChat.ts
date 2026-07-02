/**
 * SSE-based text chat transport.
 *
 * Usage:
 *   const sse = new SseChatClient(getRemHttpBase());
 *   const { sessionToken } = await sse.send("Hello", { onEvent });
 *   const history = await sse.fetchHistory();
 */

import { getRemWsUrl } from "./wsUrl";

export type TextTransport = "sse" | "ws";

/**
 * Which transport to use for text turns. Defaults to "sse"; can be forced to
 * "ws" via the NEXT_PUBLIC_REMI_TEXT_TRANSPORT build flag, or — for an instant
 * no-rebuild kill switch — `localStorage.remi_text_transport = "ws"`.
 */
export function getTextTransport(): TextTransport {
  if (typeof window !== "undefined") {
    try {
      const override = window.localStorage.getItem("remi_text_transport");
      if (override === "ws" || override === "sse") return override;
    } catch {
      /* ignore */
    }
  }
  const flag = process.env.NEXT_PUBLIC_REMI_TEXT_TRANSPORT?.trim().toLowerCase();
  return flag === "ws" ? "ws" : "sse";
}

/** Derive the HTTP(S) origin for the API from the configured WS URL. */
export function getRemHttpBase(): string {
  const wsUrl = getRemWsUrl();
  if (wsUrl) {
    try {
      const u = new URL(wsUrl);
      const proto = u.protocol === "wss:" ? "https:" : "http:";
      return `${proto}//${u.host}`;
    } catch {
      /* fall through */
    }
  }
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

export interface SseChatEvent {
  type: string;
  [key: string]: unknown;
}

export interface SseSendOptions {
  sessionToken?: string | null;
  situational?: string;
  /** User-attached image as a data:image/...;base64 URL. */
  image?: string;
  /** Voice style overrides — synced from localStorage each turn. */
  voiceStyleId?: string | null;
  speedModifier?: string | null;
  pitchModifier?: string | null;
  authToken?: string | null;
  signal?: AbortSignal;
  onEvent?: (event: SseChatEvent) => void;
}

export interface SseSendResult {
  sessionToken: string;
  /** Whether any non-session event was dispatched (i.e. the reply started). */
  startedStreaming: boolean;
}

export interface SseHistoryPage {
  mode: string;
  messages: Array<{
    id: string;
    role: string;
    content: string;
    createdAt: string;
  }>;
  hasMore: boolean;
  nextCursor: { id: string; createdAt: string } | null;
}

/**
 * 浏览器时区/locale。SSE 文本聊天没有 WebSocket 的 client_context 帧，时区只能
 * 随每次 POST /api/chat 捎带；不带的话服务端 brain.getClientTimeZone() 为 null，
 * 时间能力与时间上下文会回退到容器时区（Docker 内是 UTC），导致答错时间、
 * 误判"深夜/刚睡醒"。
 */
function clientTimeContext(): { timeZone?: string; locale?: string } {
  const ctx: { timeZone?: string; locale?: string } = {};
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone?.trim();
    if (tz) ctx.timeZone = tz;
  } catch {
    /* Intl 不可用时忽略，服务端自行回退 */
  }
  if (typeof navigator !== "undefined" && navigator.language) {
    ctx.locale = navigator.language;
  }
  return ctx;
}

export class SseChatClient {
  private baseUrl: string;

  constructor(baseUrl = "") {
    this.baseUrl = baseUrl;
  }

  /**
   * Shared SSE-frame pump: reads a fetch() response body stream and parses
   * `event: <type>\ndata: <json>` frames, invoking onFrame per parsed event.
   * Used by both send() (POST /api/chat, single-turn) and connectEvents()
   * (GET /api/chat/events, long-lived push channel) — both are plain HTTP
   * streaming responses parsed identically, so the loop lives once here
   * rather than duplicated per caller.
   */
  private async pumpSseFrames(
    res: Response,
    onFrame: (eventType: string, parsed: SseChatEvent) => void,
  ): Promise<void> {
    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      let eventType = "message";
      for (const line of lines) {
        if (line.startsWith("event: ")) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "{}") continue;
          try {
            const parsed = JSON.parse(data) as SseChatEvent;
            parsed.type = parsed.type ?? eventType;
            onFrame(eventType, parsed);
          } catch { /* skip malformed */ }
          eventType = "message";
        }
      }
    }
  }

  async send(content: string, opts: SseSendOptions = {}): Promise<SseSendResult> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (opts.sessionToken) {
      headers["X-Remi-Session"] = opts.sessionToken;
    }
    if (opts.authToken) {
      headers["Authorization"] = `Bearer ${opts.authToken}`;
    }

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        content,
        ...(opts.situational ? { situational: opts.situational } : {}),
        ...(opts.image ? { image: opts.image } : {}),
        ...clientTimeContext(),
        ...(opts.voiceStyleId !== undefined ? { voiceStyleId: opts.voiceStyleId } : {}),
        ...(opts.speedModifier !== undefined ? { speedModifier: opts.speedModifier } : {}),
        ...(opts.pitchModifier !== undefined ? { pitchModifier: opts.pitchModifier } : {}),
      }),
      signal: opts.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`SSE chat failed: ${res.status} ${body}`);
    }

    let sessionToken = opts.sessionToken ?? "";
    let startedStreaming = false;

    await this.pumpSseFrames(res, (eventType, parsed) => {
      if (eventType === "session" && typeof parsed.token === "string") {
        sessionToken = parsed.token;
      } else {
        startedStreaming = true;
      }
      opts.onEvent?.(parsed);
    });

    return { sessionToken, startedStreaming };
  }

  /**
   * Prime a pool entry without sending a message. Returns a session token
   * that fetchHistory/connectEvents can use — needed because the token was
   * previously only known after the user's first send() reply, which made
   * it impossible to open connectEvents() (and thus receive the greeting
   * opener push) before the user had already spoken.
   */
  async primeSession(opts: { sessionToken?: string | null; authToken?: string | null } = {}): Promise<string> {
    const headers: Record<string, string> = {};
    if (opts.sessionToken) headers["X-Remi-Session"] = opts.sessionToken;
    if (opts.authToken) headers["Authorization"] = `Bearer ${opts.authToken}`;

    const res = await fetch(`${this.baseUrl}/api/chat/session`, { headers });
    if (!res.ok) throw new Error(`Session priming failed: ${res.status}`);
    const body = (await res.json()) as { token: string };
    return body.token;
  }

  /**
   * Long-lived push channel (GET /api/chat/events) — delivers system-initiated
   * messages that arrive before the user has said anything (e.g. the greeting
   * opener) or between turns (e.g. silence nudges). Uses fetch()'s streaming
   * body rather than the native EventSource API because EventSource cannot
   * set custom request headers, and the endpoint is authenticated via the
   * X-Remi-Session header (matching every other endpoint in this file).
   *
   * Resolves when the connection closes (server-side eviction, network drop,
   * or the caller aborting via opts.signal) — callers should reconnect with
   * backoff if they want a persistent channel across drops.
   */
  async connectEvents(
    sessionToken: string,
    opts: { onEvent?: (event: SseChatEvent) => void; signal?: AbortSignal } = {},
  ): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/chat/events`, {
      headers: { "X-Remi-Session": sessionToken },
      signal: opts.signal,
    });
    if (!res.ok) throw new Error(`Events connect failed: ${res.status}`);

    await this.pumpSseFrames(res, (eventType, parsed) => {
      if (eventType === "connected") return; // connection ack, not a chat event
      opts.onEvent?.(parsed);
    });
  }

  async fetchHistory(opts: {
    authToken?: string | null;
    cursor?: { id: string; createdAt: string } | null;
    pageSize?: number;
  } = {}): Promise<SseHistoryPage> {
    const params = new URLSearchParams();
    if (opts.cursor) params.set("cursor", JSON.stringify(opts.cursor));
    if (opts.pageSize) params.set("pageSize", String(opts.pageSize));

    const headers: Record<string, string> = {};
    if (opts.authToken) headers["Authorization"] = `Bearer ${opts.authToken}`;

    const res = await fetch(
      `${this.baseUrl}/api/chat/history?${params}`,
      { headers },
    );

    if (!res.ok) throw new Error(`History fetch failed: ${res.status}`);
    return res.json();
  }
}
