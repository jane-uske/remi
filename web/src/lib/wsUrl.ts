/**
 * WebSocket URL for Remi backend（/ws）。
 *
 * - 一体启动（根目录 `npm run dev`）：页面与 API 同端口，用 `ws://当前 host/ws` 即可。
 * - 仅前端（`npm run web:dev`）：Next 常在 **3001**，而后端仍在 **3000**，需指向 3000 或设置 `NEXT_PUBLIC_WS_URL`。
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

function appendTokenFromPage(wsUrl: string): string {
  if (typeof window === "undefined") return wsUrl;
  const token = new URLSearchParams(window.location.search).get("token");
  if (!token) return wsUrl;
  try {
    const url = new URL(wsUrl);
    if (!url.searchParams.get("token")) {
      url.searchParams.set("token", token);
    }
    return url.toString();
  } catch {
    return wsUrl;
  }
}

export function getRemWsUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_WS_URL;
  if (typeof fromEnv === "string" && fromEnv.trim() !== "") {
    const normalized = normalizeEnvWsUrl(fromEnv);
    return appendTokenFromPage(rewriteLoopbackEnvWsUrl(normalized));
  }
  if (typeof window === "undefined") return "";

  const hostname = window.location.hostname;
  const port = window.location.port;
  const protocol = browserWsProtocol();

  // Next 单独 dev 常见 3001/3002；后端默认 PORT=3000
  if (port === "3001" || port === "3002") {
    return appendTokenFromPage(`${protocol}://${hostname}:3000/ws`);
  }

  return appendTokenFromPage(`${protocol}://${window.location.host}/ws`);
}
