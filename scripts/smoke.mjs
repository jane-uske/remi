import process from "node:process";
import { WebSocket } from "ws";

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const wsUrl =
  process.env.WS_URL ??
  baseUrl.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:") + "/ws";
const prompt =
  process.env.SMOKE_PROMPT ?? "你好，做一个 smoke test，只回复一句简短的话。";

// ── 评测隔离（2026-07 止血）──────────────────────────────────────────
// 默认（不传 --eval-user / SMOKE_EVAL_USER）行为不变：无 token 打 WS，服务端
// resolveRequestUserIdentity() 落到共享的 DEV_STORAGE_USER_ID —— 本机
// REMI_AUTH_ALLOW_LOOPBACK_BYPASS=1 时那正是真实用户本人的 loopback 身份，
// 这条 smoke chat 会真实写入其 messages/episodes。加上开关后改用
// POST /api/loopback-identity 换一个评测专用身份（scripts/eval_identity.ts
// 同款 EVAL_USER_ID），把 token 挂在 WS URL 的 ?token= 上——与生产用户完全隔离。
const USE_EVAL_USER =
  process.argv.includes("--eval-user") || process.env.SMOKE_EVAL_USER === "1";
const EVAL_USER_ID = "eeeeeeee-0000-4000-8000-00000000feed";

function fail(message) {
  console.error(`[smoke] ${message}`);
  process.exit(1);
}

async function fetchEvalToken() {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/loopback-identity`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId: EVAL_USER_ID }),
  });
  if (!res.ok) {
    fail(
      `--eval-user 换取评测 token 失败 (${res.status})：确认目标服务端 ` +
        `REMI_AUTH_ALLOW_LOOPBACK_BYPASS=1 且本次请求来自 loopback。`,
    );
  }
  const data = await res.json();
  if (!data?.token) fail("/api/loopback-identity 响应缺少 token 字段");
  return data.token;
}

async function checkHttp(url) {
  const res = await fetch(url);
  if (!res.ok) {
    fail(`HTTP check failed for ${url}: ${res.status}`);
  }
  return res;
}

async function checkHomepage() {
  const res = await checkHttp(baseUrl + "/");
  const html = await res.text();
  if (!html.includes("Remi")) {
    fail("Homepage did not include expected Remi marker");
  }
}

async function checkHealth() {
  const res = await checkHttp(baseUrl + "/health");
  const data = await res.json();
  if (!data?.ok) {
    fail("Health endpoint returned a non-ok payload");
  }
}

async function checkWebSocket() {
  let targetWsUrl = wsUrl;
  if (USE_EVAL_USER) {
    const token = await fetchEvalToken();
    const u = new URL(wsUrl);
    u.searchParams.set("token", token);
    targetWsUrl = u.toString();
    console.log(`[smoke] using eval identity (deviceId=${EVAL_USER_ID})`);
  }

  await new Promise((resolve, reject) => {
    const ws = new WebSocket(targetWsUrl);
    const events = [];
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("WebSocket smoke timed out"));
    }, 15000);

    const finish = (err) => {
      clearTimeout(timer);
      ws.close();
      if (err) {
        reject(err);
        return;
      }
      resolve(events);
    };

    ws.on("open", () => {
      events.push("open");
      ws.send(JSON.stringify({ type: "chat", content: prompt }));
    });

    ws.on("message", (buf) => {
      let msg;
      try {
        msg = JSON.parse(buf.toString());
      } catch {
        return;
      }
      events.push(msg.type);
      if (msg.type === "error") {
        finish(new Error(`Server returned error: ${msg.content ?? "unknown"}`));
        return;
      }
      if (msg.type === "chat_end") {
        finish();
      }
    });

    ws.on("error", (err) => finish(err));
  });
}

await checkHealth();
await checkHomepage();
await checkWebSocket();

console.log("[smoke] Homepage, health, and WebSocket chat checks passed");
