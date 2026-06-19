import http from "http";
import path from "path";
import { parse } from "node:url";
import crypto from "node:crypto";
import type { NextUrlWithParsedQuery } from "next/dist/server/request-meta";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "http";
import type { IncomingMessage } from "http";
import type { Request, Response } from "express";
import { getConfig } from "../config";

import { createLogger } from "../../infra/logger";
import {
  allowLoopbackAuthBypass,
  getAuthMode,
  verifyToken,
  wsAuthenticateOnce,
} from "../../infra/auth";
import { createWsRateLimiter, createRateLimiter } from "../../infra/rate_limiter";
import type { ServerMessage } from "./types";
import { handleExtApi } from "./rest_api";
import { handleDesktopExchangeToken } from "./desktop_auth";
import { handleSettingsApi, handleServiceHealth } from "./settings_api";

const logger = createLogger("gateway");
const ACCESS_COOKIE_NAME = "rem_access";
const ACCESS_LOGIN_PATH = "/__access/login";
const MOBILE_DEV_KEY_HEADER = "x-remi-mobile-key";
const LEGACY_MOBILE_DEV_KEY_HEADER = "x-rem-mobile-key";

/** 与 `listen`、传给 Next 的 `port` 一致；可通过环境变量覆盖（见 README `PORT`） */
export const PORT = (() => {
  const n = Number(process.env.PORT);
  return Number.isFinite(n) && n > 0 && n < 65536 ? Math.floor(n) : 3000;
})();

/**
 * Next 的 `hostname` 只能是主机名，不能含端口。误设 `localhost:3000` 或完整 URL 会导致畸形绝对链接/重定向。
 */
function remNextHostname(): string {
  const raw = getConfig().REMI_NEXT_HOSTNAME?.trim();
  if (!raw) return "localhost";
  try {
    const u = raw.includes("://") ? new URL(raw) : new URL(`http://${raw}`);
    return u.hostname || "localhost";
  } catch {
    return "localhost";
  }
}
const dev = process.env.NODE_ENV !== "production";
const webDir = path.join(process.cwd(), "web");

/** 少数客户端/代理会把完整 URL 放进 `req.url`，必须先收成 `/path?query`，否则 Next 会拼出畸形重定向 */
function normalizeIncomingUrl(raw: string | undefined): string {
  if (!raw) return "/";
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    try {
      const u = new URL(raw);
      return u.pathname + u.search;
    } catch {
      return "/";
    }
  }
  return raw;
}

/**
 * Next 文档与内部实现均以 `url.parse(req.url, true)` 为准；须配合 **await handle()**（handler 为 async）。
 */
function parseRequestUrl(req: IncomingMessage): NextUrlWithParsedQuery {
  return parse(normalizeIncomingUrl(req.url), true) as NextUrlWithParsedQuery;
}

function requestPathname(req: IncomingMessage): string {
  return parseRequestUrl(req).pathname ?? "/";
}

function getAccessPassword(): string | null {
  const raw = getConfig().REMI_ACCESS_PASSWORD?.trim();
  return raw ? raw : null;
}

// ── ComfyUI image proxy ──────────────────────────────────────────────

/**
 * Proxy GET /api/comfyui/view?filename=…&subfolder=…&type=… to the local
 * ComfyUI `/view` endpoint.  This lets the frontend `<img>` render generated
 * images without hitting CORS (ComfyUI runs on a different port).
 */
async function handleComfyuiProxy(
  req: IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const comfyBase = getConfig().COMFYUI_BASE_URL.replace(/\/+$/, "");
  const qs = parseRequestUrl(req).search ?? "";
  const targetUrl = `${comfyBase}/view${qs}`;
  try {
    const upstream = await fetch(targetUrl);
    if (!upstream.ok) {
      res.statusCode = upstream.status;
      res.end();
      return;
    }
    const ct = upstream.headers.get("content-type") ?? "image/png";
    res.writeHead(200, {
      "Content-Type": ct,
      "Cache-Control": "public, max-age=86400, immutable",
    });
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.end(buf);
  } catch {
    res.statusCode = 502;
    res.end("ComfyUI unreachable");
  }
}

function hasSharedPasswordGate(): boolean {
  return !!getAccessPassword();
}

function parseCookies(req: IncomingMessage): Record<string, string> {
  const raw = req.headers.cookie;
  if (!raw) return {};
  return raw.split(";").reduce<Record<string, string>>((acc, pair) => {
    const idx = pair.indexOf("=");
    if (idx <= 0) return acc;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    acc[key] = decodeURIComponent(value);
    return acc;
  }, {});
}

function accessCookieValue(password: string): string {
  return crypto.createHash("sha256").update(`rem-access:${password}`).digest("hex");
}

function hasValidAccessCookie(req: IncomingMessage): boolean {
  const password = getAccessPassword();
  if (!password) return true;
  const cookies = parseCookies(req);
  const actual = cookies[ACCESS_COOKIE_NAME];
  if (!actual) return false;
  const expected = accessCookieValue(password);
  const actualBuf = Buffer.from(actual);
  const expectedBuf = Buffer.from(expected);
  if (actualBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(actualBuf, expectedBuf);
}

function shouldUseSecureCookie(req: IncomingMessage): boolean {
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (typeof forwardedProto === "string") {
    return forwardedProto.split(",")[0].trim() === "https";
  }
  return false;
}

function loginHtml(message?: string): string {
  const error = message
    ? `<p style="margin:0;color:#fecaca;font-size:14px;">${message}</p>`
    : "";
  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Remi Access</title>
    <style>
      body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0a0a0a;color:#f5f5f5;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
      .card{width:min(100%,380px);background:#111827;border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:24px;box-shadow:0 16px 50px rgba(0,0,0,.35)}
      h1{margin:0 0 10px;font-size:24px}
      p{margin:0 0 16px;color:#cbd5e1;font-size:14px;line-height:1.5}
      input{width:100%;box-sizing:border-box;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:#030712;color:#fff;padding:12px 14px;font-size:16px}
      button{margin-top:14px;width:100%;border:0;border-radius:12px;background:#f8fafc;color:#020617;padding:12px 14px;font-size:15px;font-weight:600;cursor:pointer}
    </style>
  </head>
  <body>
    <main class="card">
      <h1>Remi 访问验证</h1>
      <p>这个开发预览入口已加本地门禁。输入共享密码后才能继续访问。</p>
      ${error}
      <form method="post" action="${ACCESS_LOGIN_PATH}">
        <input type="password" name="password" placeholder="输入访问密码" autocomplete="current-password" required />
        <button type="submit">进入</button>
      </form>
    </main>
  </body>
</html>`;
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseFormEncoded(body: string): URLSearchParams {
  return new URLSearchParams(body);
}

function loginRedirectTarget(req: IncomingMessage): string {
  const parsed = parseRequestUrl(req);
  const returnTo = parsed.query.returnTo;
  if (typeof returnTo === "string" && returnTo.startsWith("/")) return returnTo;
  return "/";
}

function writeAccessCookie(req: IncomingMessage, res: http.ServerResponse, password: string): void {
  const secure = shouldUseSecureCookie(req) ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${ACCESS_COOKIE_NAME}=${accessCookieValue(password)}; Path=/; HttpOnly; SameSite=Lax${secure}`,
  );
}

function clearAccessCookie(req: IncomingMessage, res: http.ServerResponse): void {
  const secure = shouldUseSecureCookie(req) ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${ACCESS_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
  );
}

async function handleAccessLogin(req: IncomingMessage, res: http.ServerResponse): Promise<boolean> {
  if (!hasSharedPasswordGate()) return false;
  const pathname = requestPathname(req);
  if (pathname !== ACCESS_LOGIN_PATH) return false;

  if (req.method === "GET") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(loginHtml());
    return true;
  }

  if (req.method === "POST") {
    const password = getAccessPassword();
    const body = await readRequestBody(req);
    const form = parseFormEncoded(body);
    if (password && form.get("password") === password) {
      writeAccessCookie(req, res, password);
      res.statusCode = 303;
      res.setHeader("Location", loginRedirectTarget(req));
      res.end();
      return true;
    }
    clearAccessCookie(req, res);
    res.statusCode = 401;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(loginHtml("密码不正确，请重试。"));
    return true;
  }

  res.statusCode = 405;
  res.end("Method Not Allowed");
  return true;
}

function denyWithoutAccessCookie(req: IncomingMessage, res: http.ServerResponse): boolean {
  if (!hasSharedPasswordGate()) return false;
  if (canBypassLoopbackAuth(req)) return false;
  const pathname = requestPathname(req);
  if (pathname === "/health" || pathname === ACCESS_LOGIN_PATH) return false;
  if (hasValidMobileDevKey(req)) return false;
  if (hasValidAuthToken(req)) return false;
  if (hasValidAccessCookie(req)) return false;

  if (req.method === "GET" || req.method === "HEAD") {
    res.statusCode = 303;
    res.setHeader("Location", `${ACCESS_LOGIN_PATH}?returnTo=${encodeURIComponent(normalizeIncomingUrl(req.url) || "/")}`);
    res.end();
    return true;
  }

  res.statusCode = 401;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ error: "Access gate login required" }));
  return true;
}

// ── HTTP rate limiter using unified implementation ──

const httpRateLimiter = createRateLimiter();

function getClientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress ?? "unknown";
}

function mobileDevAuthEnabled(): boolean {
  return getConfig().REMI_MOBILE_DEV_ENABLED;
}

function getMobileDevKey(): string | null {
  const raw = getConfig().REMI_MOBILE_DEV_KEY?.trim();
  return raw ? raw : null;
}

function readHeaderValue(req: IncomingMessage, headerName: string): string | null {
  const raw = req.headers[headerName.toLowerCase()];
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && typeof raw[0] === "string") return raw[0];
  const target = headerName.toLowerCase();
  for (let i = 0; i + 1 < req.rawHeaders.length; i += 2) {
    if (req.rawHeaders[i]?.trim().toLowerCase() === target) {
      const value = req.rawHeaders[i + 1];
      return typeof value === "string" ? value : null;
    }
  }
  return null;
}

function extractAuthToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice(7);
}

function extractWsToken(req: IncomingMessage): string | null {
  const { query: qs } = parseRequestUrl(req);
  const t = qs.token;
  if (typeof t === "string") return t;
  if (Array.isArray(t) && typeof t[0] === "string") return t[0];
  return extractAuthToken(req);
}

function hasValidAuthToken(req: IncomingMessage): boolean {
  const token = extractWsToken(req);
  if (!token) return false;
  return !!verifyToken(token);
}

function hasValidMobileDevKey(req: IncomingMessage): boolean {
  if (!mobileDevAuthEnabled()) return false;
  const expected = getMobileDevKey();
  if (!expected) return false;
  const provided = (
    readHeaderValue(req, MOBILE_DEV_KEY_HEADER) ??
    readHeaderValue(req, LEGACY_MOBILE_DEV_KEY_HEADER)
  )?.trim();
  if (!provided) return false;
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

function hasValidWsAuth(req: IncomingMessage): boolean {
  return hasValidAuthToken(req) || hasValidMobileDevKey(req);
}

function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const normalized = address.trim().toLowerCase().replace(/^::ffff:/, "");
  return (
    normalized === "::1" ||
    normalized === "127.0.0.1"
  );
}

function isDockerBridgeAddress(address: string | undefined): boolean {
  if (!address) return false;
  const normalized = address.trim().toLowerCase().replace(/^::ffff:/, "");
  const parts = normalized.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  const [a, b, c, d] = parts;
  if ([a, b, c, d].some((part) => part < 0 || part > 255)) return false;
  return a === 172 && b >= 16 && b <= 31;
}

function normalizeRequestHost(hostHeader: string | undefined): string {
  if (typeof hostHeader !== "string" || hostHeader.trim() === "") return "";
  const trimmed = hostHeader.trim().toLowerCase();
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    return end >= 0 ? trimmed.slice(1, end) : trimmed;
  }
  return trimmed.split(":")[0];
}

function isLoopbackHostname(host: string): boolean {
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "lvh.me" ||
    host.endsWith(".lvh.me")
  );
}

export function isLocalLoopbackRequestParts(
  hostHeader: string | undefined,
  remoteAddress: string | undefined,
): boolean {
  const host = normalizeRequestHost(hostHeader);
  if (!isLoopbackHostname(host)) return false;
  return isLoopbackAddress(remoteAddress) || isDockerBridgeAddress(remoteAddress);
}

function isLocalLoopbackRequest(req: IncomingMessage): boolean {
  return isLocalLoopbackRequestParts(req.headers.host, req.socket.remoteAddress);
}

function canBypassLoopbackAuth(req: IncomingMessage): boolean {
  return allowLoopbackAuthBypass() && isLocalLoopbackRequest(req);
}

const AUTH_SKIP_PREFIXES = ["/_next/", "/favicon.ico", "/__nextjs", "/vrm/", "/api/ext/"];

function shouldSkipAuth(pathname: string): boolean {
  return AUTH_SKIP_PREFIXES.some((p) => pathname.startsWith(p));
}

function shouldSkipHttpRateLimit(pathname: string): boolean {
  return AUTH_SKIP_PREFIXES.some((p) => pathname.startsWith(p));
}

function shouldEnforceHttpAuth(authMode: ReturnType<typeof getAuthMode>, pathname: string): boolean {
  if (authMode === "disabled") return false;
  if (authMode === "clerk") return false;
  return !shouldSkipAuth(pathname);
}

export interface GatewayConfig {
  onConnection: (ws: WebSocket, req: IncomingMessage) => void;
}

export function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

let wsRateLimiter: ReturnType<typeof createWsRateLimiter>;

export function getWsRateLimiter(): ReturnType<typeof createWsRateLimiter> {
  return wsRateLimiter;
}

export async function createGateway(config: GatewayConfig): Promise<HttpServer> {
  /** 与 `listen(PORT)` 一致，供 Next 拼规范 URL。勿用系统环境变量 `HOST`（常为机器名）。 */
  const nextApp = next({
    dev,
    dir: webDir,
    hostname: remNextHostname(),
    port: PORT,
  });
  const handle = nextApp.getRequestHandler();
  await nextApp.prepare();
  const nextUpgrade = dev ? nextApp.getUpgradeHandler() : null;

  const authMode = getAuthMode();
  const useAuth = authMode !== "disabled";

  if (useAuth) {
    logger.info("[Auth] auth enabled", { mode: authMode });
  } else {
    logger.info("[Auth] auth disabled", { mode: authMode });
  }

  wsRateLimiter = createWsRateLimiter();

  const server = http.createServer(async (req, res) => {
    try {
      const { pathname } = parseRequestUrl(req);

      if (await handleAccessLogin(req, res)) {
        return;
      }

      if (!shouldSkipHttpRateLimit(pathname ?? "/")) {
        // Use Express rate limiter
        // @ts-ignore - Using Express middleware with Node.js http server
        httpRateLimiter(req, res, () => {});
      }

      // If rate limiter already sent a 429 response, don't proceed
      if (res.headersSent) {
        return;
      }

      if (pathname === "/health") {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(
          JSON.stringify({
            ok: true,
            service: "remi",
            uptimeSec: Math.floor(process.uptime()),
          }),
        );
        return;
      }

      if (denyWithoutAccessCookie(req, res)) {
        return;
      }

      if (shouldEnforceHttpAuth(authMode, pathname ?? "/")) {
        const token = extractWsToken(req);
        if (!token && !canBypassLoopbackAuth(req)) {
          res.statusCode = 401;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Missing token" }));
          return;
        }
        const payload = token ? verifyToken(token) : null;
        if (!payload && token) {
          res.statusCode = 401;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Invalid or expired token" }));
          return;
        }
      }

      // Desktop sign-in flow exchanges a Clerk session token for a long-lived
      // legacy JWT. Auth is enforced inside the handler (clerk mode skips the
      // gateway-level HTTP auth check above).
      if (pathname === "/api/desktop/exchange-token") {
        await handleDesktopExchangeToken(req, res);
        return;
      }

      // ComfyUI image proxy — forward /api/comfyui/view?… to the local ComfyUI
      // server so the frontend can display generated images without CORS issues.
      if (pathname === "/api/comfyui/view") {
        await handleComfyuiProxy(req, res);
        return;
      }

      // In-app settings page: read/write the runtime config overlay (ComfyUI /
      // MLX TTS / adult-mode switch) and probe local service health.
      if (pathname === "/api/settings") {
        await handleSettingsApi(req, res);
        return;
      }
      if (pathname === "/api/health/services") {
        await handleServiceHealth(req, res);
        return;
      }

      if (pathname?.startsWith("/api/ext/")) {
        await handleExtApi(req, res, pathname);
        return;
      }

      const parsedUrl = parseRequestUrl(req);
      await handle(req, res, parsedUrl);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      logger.error("[HTTP]", { err: message, stack });
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end("Internal Server Error");
      }
    }
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const pathname = requestPathname(req);
    if (pathname.startsWith("/_next/")) {
      if (!nextUpgrade) {
        socket.destroy();
        return;
      }
      void nextUpgrade(req, socket, head).catch(() => socket.destroy());
      return;
    }
    if (pathname !== "/ws") {
      socket.destroy();
      return;
    }

    const mobileKeyAccepted = hasValidMobileDevKey(req);

    if (hasSharedPasswordGate() && !hasValidAccessCookie(req)) {
      if (canBypassLoopbackAuth(req)) {
        // local browser debug path: do not force access-cookie gate on loopback
      } else if (!hasValidWsAuth(req)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
    }

    if (useAuth) {
      const token = extractWsToken(req);
      if (!token && !mobileKeyAccepted && !canBypassLoopbackAuth(req)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      const payload = token
        ? wsAuthenticateOnce(token)
        : (mobileKeyAccepted ? { id: "mobile-dev" } : { id: "dev" });
      if (!payload) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws, req) => {
    config.onConnection(ws, req);
  });

  return server;
}

export function startServer(server: HttpServer): void {
  server.once("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      logger.error("[Remi AI] 端口已被占用，请结束占用该端口的进程或修改 .env 中的 PORT", {
        port: PORT,
      });
    } else {
      logger.error("[Remi AI] HTTP 监听失败", { err: err.message, code: err.code });
    }
    process.exit(1);
  });
  server.listen(PORT, () => {
    logger.info(`[Remi AI] 服务已启动 — http://localhost:${PORT}`);
    if (dev) {
      logger.info(`[Remi AI] Next.js 开发模式`, { dir: webDir });
    }
  });
}
