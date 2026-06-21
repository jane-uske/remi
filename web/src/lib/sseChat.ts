/**
 * SSE-based text chat transport.
 *
 * Usage:
 *   const sse = new SseChatClient("/api/chat");
 *   const { sessionToken } = await sse.send("Hello", { onChunk, onEnd, onEvent });
 *   const history = await sse.fetchHistory();
 */

export interface SseChatEvent {
  type: string;
  [key: string]: unknown;
}

export interface SseSendOptions {
  sessionToken?: string | null;
  situational?: string;
  authToken?: string | null;
  signal?: AbortSignal;
  onEvent?: (event: SseChatEvent) => void;
}

export interface SseSendResult {
  sessionToken: string;
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
      }),
      signal: opts.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`SSE chat failed: ${res.status} ${body}`);
    }

    let sessionToken = opts.sessionToken ?? "";

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
            }
            parsed.type = parsed.type ?? eventType;
            opts.onEvent?.(parsed);
          } catch { /* skip malformed */ }
          eventType = "message";
        }
      }
    }

    return { sessionToken };
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
