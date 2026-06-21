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

export class SseChatClient {
  private baseUrl: string;

  constructor(baseUrl = "") {
    this.baseUrl = baseUrl;
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
      }),
      signal: opts.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`SSE chat failed: ${res.status} ${body}`);
    }

    let sessionToken = opts.sessionToken ?? "";
    let startedStreaming = false;

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
            if (eventType === "session" && typeof parsed.token === "string") {
              sessionToken = parsed.token;
            } else {
              startedStreaming = true;
            }
            parsed.type = parsed.type ?? eventType;
            opts.onEvent?.(parsed);
          } catch { /* skip malformed */ }
          eventType = "message";
        }
      }
    }

    return { sessionToken, startedStreaming };
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
