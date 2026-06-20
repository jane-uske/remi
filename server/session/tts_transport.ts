import type { IncomingMessage } from "http";

export type SessionClientFamily = "ios_lite" | "watch_lite" | "web" | "unknown";
export type SessionTtsTransport = "auto" | "buffered_voice" | "pcm_stream_v1";
export type ClientContextTtsTransport = Exclude<SessionTtsTransport, "auto">;

function readQueryValue(req: IncomingMessage, key: string): string | null {
  const rawUrl = typeof req?.url === "string" ? req.url : "";
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl, "http://localhost");
    const value = url.searchParams.get(key)?.trim();
    return value || null;
  } catch {
    return null;
  }
}

export function normalizeSessionClientFamily(raw: string | null | undefined): SessionClientFamily {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === "ios_lite") return "ios_lite";
  if (normalized === "watch_lite") return "watch_lite";
  if (normalized === "web") return "web";
  return "unknown";
}

export function normalizeSessionTtsTransport(
  raw: string | null | undefined,
): SessionTtsTransport | null {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === "auto") return "auto";
  if (normalized === "buffered_voice") return "buffered_voice";
  if (normalized === "pcm_stream_v1") return "pcm_stream_v1";
  return null;
}

export function normalizeClientContextTtsTransport(
  raw: string | null | undefined,
): ClientContextTtsTransport | null {
  const normalized = normalizeSessionTtsTransport(raw);
  if (normalized === "pcm_stream_v1" || normalized === "buffered_voice") {
    return normalized;
  }
  return null;
}

export function resolveSessionTransportFromRequest(req: IncomingMessage): {
  clientFamily: SessionClientFamily;
  ttsTransport: SessionTtsTransport;
  rawClientFamily: string | null;
  rawTtsTransport: string | null;
} {
  const rawClientFamily = readQueryValue(req, "client");
  const rawTtsTransport = readQueryValue(req, "tts_transport");
  const clientFamily = normalizeSessionClientFamily(rawClientFamily);
  const requestedTransport = normalizeSessionTtsTransport(rawTtsTransport);

  if (requestedTransport) {
    return {
      clientFamily,
      ttsTransport: requestedTransport,
      rawClientFamily,
      rawTtsTransport,
    };
  }

  return {
    clientFamily,
    // ios_lite and watch_lite play buffered base64 `voice` (MP3) frames and do not
    // decode `voice_pcm_chunk` streaming, so they default to buffered_voice. Other
    // clients negotiate streaming via `auto`.
    ttsTransport:
      clientFamily === "ios_lite" || clientFamily === "watch_lite"
        ? "buffered_voice"
        : "auto",
    rawClientFamily,
    rawTtsTransport,
  };
}
