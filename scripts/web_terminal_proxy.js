#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { URLSearchParams, parse: parseUrl } = require("node:url");
const net = require("node:net");

const ROOT_DIR = env("REMI_TERMINAL_ROOT_DIR", "REM_TERMINAL_ROOT_DIR") || process.cwd();
const PUBLIC_PORT = toPort(env("REMI_TERMINAL_PORT", "REM_TERMINAL_PORT"), 7681);
const INTERNAL_PORT = toPort(env("REMI_TERMINAL_INTERNAL_PORT", "REM_TERMINAL_INTERNAL_PORT"), 7682);
const ACCESS_COOKIE_NAME = "rem_term_access";
const ACCESS_LOGIN_PATH = "/__term_access/login";
const SESSION_PICKER_PATH = "/__term_access/sessions";
const TARGET_HOST = "127.0.0.1";

const PASSWORD = getAccessPassword();

function toPort(raw, fallback) {
  const port = Number(raw);
  if (!Number.isFinite(port) || port <= 0 || port >= 65536) return fallback;
  return Math.floor(port);
}

function getAccessPassword() {
  const rawPassword = env("REMI_TERMINAL_PASSWORD", "REM_TERMINAL_PASSWORD");
  if (typeof rawPassword === "string") {
    const password = rawPassword.trim();
    if (password) return password;
  }
  return env("REMI_ACCESS_PASSWORD", "REM_ACCESS_PASSWORD").trim();
}

function env(preferredKey, legacyKey) {
  const preferred = process.env[preferredKey];
  if (typeof preferred === "string" && preferred.length > 0) {
    return preferred;
  }
  const legacy = process.env[legacyKey];
  return typeof legacy === "string" ? legacy : "";
}

function parseCookies(req) {
  const raw = req.headers.cookie;
  if (!raw) return {};
  return raw.split(";").reduce((acc, pair) => {
    const idx = pair.indexOf("=");
    if (idx <= 0) return acc;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    acc[key] = decodeURIComponent(value);
    return acc;
  }, {});
}

function accessCookieValue(password) {
  return crypto.createHash("sha256").update(`rem-term-access:${password}`).digest("hex");
}

function hasValidAccessCookie(req) {
  if (!PASSWORD) return true;
  const cookies = parseCookies(req);
  const actual = cookies[ACCESS_COOKIE_NAME];
  if (!actual) return false;
  const expected = accessCookieValue(PASSWORD);
  const actualBuf = Buffer.from(actual);
  const expectedBuf = Buffer.from(expected);
  if (actualBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(actualBuf, expectedBuf);
}

function shouldUseSecureCookie(req) {
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (typeof forwardedProto === "string") {
    return forwardedProto.split(",")[0].trim() === "https";
  }
  return false;
}

function writeAccessCookie(req, res) {
  const secure = shouldUseSecureCookie(req) ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${ACCESS_COOKIE_NAME}=${accessCookieValue(PASSWORD)}; Path=/; HttpOnly; SameSite=Lax${secure}`,
  );
}

function clearAccessCookie(req, res) {
  const secure = shouldUseSecureCookie(req) ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${ACCESS_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
  );
}

function normalizeIncomingUrl(raw) {
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

function requestPathname(req) {
  return parseUrl(normalizeIncomingUrl(req.url), true).pathname || "/";
}

function loginRedirectTarget(req) {
  const parsed = parseUrl(normalizeIncomingUrl(req.url), true);
  const returnTo = parsed.query.returnTo;
  if (typeof returnTo === "string" && returnTo.startsWith("/")) return returnTo;
  return "/";
}

function loginHtml(message) {
  const error = message
    ? `<p style="margin:0;color:#fecaca;font-size:14px;">${message}</p>`
    : "";
  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Remi Terminal Access</title>
    <style>
      body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0b1020;color:#f8fafc;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
      .card{width:min(100%,420px);background:#111827;border:1px solid rgba(255,255,255,.08);border-radius:20px;padding:26px;box-shadow:0 18px 48px rgba(0,0,0,.35)}
      h1{margin:0 0 10px;font-size:24px}
      p{margin:0 0 16px;color:#cbd5e1;font-size:14px;line-height:1.6}
      input{width:100%;box-sizing:border-box;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:#020617;color:#fff;padding:12px 14px;font-size:16px}
      button{margin-top:14px;width:100%;border:0;border-radius:12px;background:#f8fafc;color:#020617;padding:12px 14px;font-size:15px;font-weight:600;cursor:pointer}
      code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#0f172a;padding:2px 6px;border-radius:8px}
    </style>
  </head>
  <body>
    <main class="card">
      <h1>Remi 终端验证</h1>
      <p>这个远程终端入口会直接落到你家里电脑的 <code>tmux</code> 会话。输入共享密码后才能继续访问。</p>
      ${error}
      <form method="post" action="${ACCESS_LOGIN_PATH}">
        <input type="password" name="password" placeholder="输入访问密码" autocomplete="current-password" required />
        <button type="submit">进入终端</button>
      </form>
    </main>
  </body>
</html>`;
}

function sessionPickerHtml() {
  const presets = ["rem-dev", "agent-1", "agent-2", "debug"];
  const links = presets
    .map(
      (name) =>
        `<a href="/?arg=${encodeURIComponent(name)}" style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:#0f172a;color:#f8fafc;text-decoration:none;"><span>${name}</span><span style="color:#94a3b8;font-size:12px;">open</span></a>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Remi Terminal Sessions</title>
    <style>
      body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0b1020;color:#f8fafc;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
      .card{width:min(100%,520px);background:#111827;border:1px solid rgba(255,255,255,.08);border-radius:20px;padding:26px;box-shadow:0 18px 48px rgba(0,0,0,.35)}
      h1{margin:0 0 10px;font-size:24px}
      p{margin:0 0 16px;color:#cbd5e1;font-size:14px;line-height:1.6}
      .grid{display:grid;gap:10px;margin:18px 0}
      input{width:100%;box-sizing:border-box;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:#020617;color:#fff;padding:12px 14px;font-size:16px}
      button{margin-top:14px;width:100%;border:0;border-radius:12px;background:#f8fafc;color:#020617;padding:12px 14px;font-size:15px;font-weight:600;cursor:pointer}
      code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#0f172a;padding:2px 6px;border-radius:8px}
      .hint{margin-top:14px;font-size:12px;color:#94a3b8}
    </style>
  </head>
  <body>
    <main class="card">
      <h1>选择终端会话</h1>
      <p>每个会话对应一个独立的 <code>tmux session</code>。你可以同时打开多个网页终端，只要使用不同的会话名即可。</p>
      <div class="grid">${links}</div>
      <form method="get" action="/">
        <input type="text" name="arg" placeholder="输入自定义会话名，例如 feature-a" autocomplete="off" />
        <button type="submit">打开自定义终端</button>
      </form>
      <p class="hint">同名会话会复用，使用不同名称可同时开多个终端。</p>
    </main>
  </body>
</html>`;
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function handleAccessLogin(req, res) {
  if (!PASSWORD) return false;
  const pathname = requestPathname(req);
  if (pathname !== ACCESS_LOGIN_PATH) return false;

  if (req.method === "GET") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(loginHtml());
    return true;
  }

  if (req.method === "POST") {
    const body = await readRequestBody(req);
    const form = new URLSearchParams(body);
    if (form.get("password") === PASSWORD) {
      writeAccessCookie(req, res);
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

function shouldShowSessionPicker(req) {
  if (req.method !== "GET") return false;
  const pathname = requestPathname(req);
  if (pathname !== "/" && pathname !== SESSION_PICKER_PATH) return false;
  const parsed = parseUrl(normalizeIncomingUrl(req.url), true);
  return typeof parsed.query.arg !== "string" || parsed.query.arg.trim() === "";
}

function handleSessionPicker(req, res) {
  if (!hasValidAccessCookie(req)) return false;
  if (!shouldShowSessionPicker(req)) return false;
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(sessionPickerHtml());
  return true;
}

function denyWithoutAccessCookie(req, res) {
  if (!PASSWORD) return false;
  const pathname = requestPathname(req);
  if (pathname === "/health" || pathname === ACCESS_LOGIN_PATH) return false;
  if (hasValidAccessCookie(req)) return false;

  if (req.method === "GET" || req.method === "HEAD") {
    res.statusCode = 303;
    res.setHeader("Location", `${ACCESS_LOGIN_PATH}?returnTo=${encodeURIComponent(normalizeIncomingUrl(req.url) || "/")}`);
    res.end();
    return true;
  }

  res.statusCode = 401;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ error: "Terminal access login required" }));
  return true;
}

function proxyHttp(req, res) {
  const headers = { ...req.headers, host: `${TARGET_HOST}:${INTERNAL_PORT}` };
  const proxyReq = http.request(
    {
      hostname: TARGET_HOST,
      port: INTERNAL_PORT,
      method: req.method,
      path: normalizeIncomingUrl(req.url),
      headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on("error", (err) => {
    if (res.headersSent || res.writableEnded) {
      res.destroy();
      return;
    }
    res.statusCode = 502;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(`Terminal upstream unavailable: ${err.message}`);
  });

  if (req.readableEnded) {
    proxyReq.end();
    return;
  }

  req.pipe(proxyReq);
}

function proxyUpgrade(req, socket, head) {
  const upstream = net.connect(INTERNAL_PORT, TARGET_HOST, () => {
    const headerLines = [`GET ${normalizeIncomingUrl(req.url)} HTTP/1.1`];
    for (const [key, value] of Object.entries({
      ...req.headers,
      host: `${TARGET_HOST}:${INTERNAL_PORT}`,
    })) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          headerLines.push(`${key}: ${item}`);
        }
      } else {
        headerLines.push(`${key}: ${value}`);
      }
    }
    headerLines.push("", "");
    upstream.write(headerLines.join("\r\n"));
    if (head.length > 0) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });

  upstream.on("error", () => {
    if (!socket.destroyed) {
      socket.write("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
      socket.destroy();
    }
  });
}

const ttyd = spawn(
  "ttyd",
  [
    "--interface",
    TARGET_HOST,
    "--port",
    String(INTERNAL_PORT),
    "--writable",
    "--url-arg",
    `${ROOT_DIR}/scripts/web_terminal_session.sh`,
  ],
  {
    cwd: ROOT_DIR,
    env: process.env,
    stdio: "inherit",
  },
);

ttyd.on("exit", (code, signal) => {
  if (signal) {
    console.error(`[term-proxy] ttyd exited due to signal ${signal}`);
  } else {
    console.error(`[term-proxy] ttyd exited with code ${code ?? 0}`);
  }
  process.exit(code ?? 1);
});

const server = http.createServer(async (req, res) => {
  try {
    if (await handleAccessLogin(req, res)) return;

    if (requestPathname(req) === "/health") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: true, service: "rem-term-proxy" }));
      return;
    }

    if (denyWithoutAccessCookie(req, res)) return;
    if (handleSessionPicker(req, res)) return;
    proxyHttp(req, res);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(err instanceof Error ? err.message : String(err));
  }
});

server.on("upgrade", (req, socket, head) => {
  if (PASSWORD && !hasValidAccessCookie(req)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  proxyUpgrade(req, socket, head);
});

server.listen(PUBLIC_PORT, () => {
  console.log(`[term-proxy] listening on http://127.0.0.1:${PUBLIC_PORT} -> ttyd:${INTERNAL_PORT}`);
});

function shutdown(signal) {
  server.close(() => {
    if (!ttyd.killed) ttyd.kill("SIGTERM");
    process.exit(0);
  });
  setTimeout(() => {
    if (!ttyd.killed) ttyd.kill("SIGKILL");
    process.exit(1);
  }, 3000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
