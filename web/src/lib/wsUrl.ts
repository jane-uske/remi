/**
 * WebSocket URL for Remi backend（/ws）。
 *
 * - 一体启动（根目录 `npm run dev`）：页面与 API 同端口，用 `ws://当前 host/ws` 即可。
 * - 仅前端（`npm run dev:web:standalone`）：Next 常在 **3001**，若后端不在同端口，需显式设置 `NEXT_PUBLIC_WS_URL`。
 *
 * 环境变量须为绝对 WebSocket URL。若写成 `localhost:3000/ws`（无 `ws://`），浏览器会当成相对路径，
 * 解析成 `http(s)://当前页/localhost:3000/ws`，地址栏易出现 `/localhost:3000/...` 嵌套。
 */
function normalizeEnvWsUrl(raw: string): string {
  const t = raw.trim();
  if (/^(ws|wss):\/\//i.test(t)) return t;
  // host:port/path → ws://host:port/path
  if (/^[\w.-]+:\d+(\/.*)?$/i.test(t)) return `ws://${t}`;
  return t;
}

function browserWsProtocol(): "ws" | "wss" {
  if (typeof window === "undefined") return "ws";
  return window.location.protocol === "https:" ? "wss" : "ws";
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

function rewriteLoopbackEnvWsUrl(rawUrl: string): string {
  if (typeof window === "undefined") return rawUrl;
  try {
    const envUrl = new URL(rawUrl);
    const pageHost = window.location.hostname;
    if (!pageHost || isLoopbackHost(pageHost)) return rawUrl;
    if (!isLoopbackHost(envUrl.hostname)) return rawUrl;

    const pageUrl = new URL(window.location.href);
    envUrl.protocol = browserWsProtocol();
    envUrl.hostname = pageUrl.hostname;
    envUrl.port = pageUrl.port;
    return envUrl.toString();
  } catch {
    return rawUrl;
  }
}

function appendWebClientParamsToWsUrl(wsUrl: string): string {
  try {
    const url = new URL(wsUrl);
    if (!url.searchParams.get("client")) {
      url.searchParams.set("client", "web");
    }
    if (!url.searchParams.get("tts_transport")) {
      url.searchParams.set("tts_transport", "pcm_stream_v1");
    }
    return url.toString();
  } catch {
    return wsUrl;
  }
}

export function appendTokenToWsUrl(wsUrl: string, token?: string | null): string {
  if (typeof window === "undefined" && !token) return wsUrl;
  const resolvedToken =
    token ??
    (typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("token")
      : null);
  if (!resolvedToken) return wsUrl;
  try {
    const url = new URL(wsUrl);
    if (!url.searchParams.get("token")) {
      url.searchParams.set("token", resolvedToken);
    }
    return url.toString();
  } catch {
    return wsUrl;
  }
}

export function getRemWsUrl(sessionToken?: string | null): string {
  const fromEnv = process.env.NEXT_PUBLIC_WS_URL;
  if (typeof fromEnv === "string" && fromEnv.trim() !== "") {
    const normalized = normalizeEnvWsUrl(fromEnv);
    return appendTokenToWsUrl(
      appendWebClientParamsToWsUrl(rewriteLoopbackEnvWsUrl(normalized)),
      sessionToken,
    );
  }
  if (typeof window === "undefined") return "";

  const protocol = browserWsProtocol();

  return appendTokenToWsUrl(
    appendWebClientParamsToWsUrl(`${protocol}://${window.location.host}/ws`),
    sessionToken,
  );
}
