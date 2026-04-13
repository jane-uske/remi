import process from "node:process";
import { WebSocket } from "ws";

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const wsUrl =
  process.env.WS_URL ??
  baseUrl.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:") + "/ws";
const prompt =
  process.env.SMOKE_PROMPT ?? "你好，做一个 smoke test，只回复一句简短的话。";

function fail(message) {
  console.error(`[smoke] ${message}`);
  process.exit(1);
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
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
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
