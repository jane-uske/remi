import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { WebSocket } from "ws";

const repoRoot = process.cwd();
const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3000";
let wsUrl =
  process.env.WS_URL ??
  baseUrl.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:") + "/ws";

// ── 评测隔离（2026-07 止血）──────────────────────────────────────────────────
// 默认 baseUrl 就是生产 local-prod 容器（127.0.0.1:3000）。裸 WS 连接无 token
// 时服务端把 storageUserId 落到共享的 DEV_STORAGE_USER_ID —— 本机
// REMI_AUTH_ALLOW_LOOPBACK_BYPASS=1 时那正是真实用户本人的 loopback 身份，
// 下面这些 prompt 会真实写入其 messages/episodes。换一个评测专用身份（与
// scripts/eval_identity.ts 同一 EVAL_USER_ID），挂在 wsUrl 的 ?token= 上。
const EVAL_USER_ID = "eeeeeeee-0000-4000-8000-00000000feed";
async function attachEvalIdentity() {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/loopback-identity`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId: EVAL_USER_ID }),
  });
  if (!res.ok) {
    throw new Error(
      `换取评测身份失败 (${res.status})：确认目标服务端 REMI_AUTH_ALLOW_LOOPBACK_BYPASS=1 且请求来自 loopback。`,
    );
  }
  const { token } = await res.json();
  if (!token) throw new Error("/api/loopback-identity 响应缺少 token 字段");
  const u = new URL(wsUrl);
  u.searchParams.set("token", token);
  wsUrl = u.toString();
}
await attachEvalIdentity();

const cases = [
  {
    name: "short-natural",
    prompt: "请自然地和我打个招呼，只说一句，不要主持腔。",
  },
  {
    name: "gentle-tone",
    prompt: "我现在有点累，你轻一点安慰我一句，不要太夸张。",
  },
  {
    name: "answer-first",
    prompt: "我该先睡觉还是继续工作？先给判断，再补一句理由。",
  },
  {
    name: "longer-reply",
    prompt: "请用三句简短的话解释你现在能帮我测试什么，语气自然一点。",
  },
  {
    name: "boundary-style",
    prompt: "如果我说话很直接，你也先保持自然，不要过火，回复一句你会怎么拿捏语气。",
  },
];

function fail(message) {
  console.error(`[volc-followup] ${message}`);
  process.exit(1);
}

function latestLiveLogPath() {
  const liveDir = path.join(repoRoot, "artifacts", "live");
  if (!fs.existsSync(liveDir)) fail(`live log dir not found: ${liveDir}`);
  const files = fs
    .readdirSync(liveDir)
    .filter((name) => /^dev_server_.*\.log$/.test(name))
    .map((name) => ({
      name,
      fullPath: path.join(liveDir, name),
      mtimeMs: fs.statSync(path.join(liveDir, name)).mtimeMs,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (files.length === 0) fail("no live dev_server log found");
  return files[0].fullPath;
}

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return null;
  const idx = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.round((sortedValues.length - 1) * p)),
  );
  return sortedValues[idx];
}

function summarizeLogSegment(segment) {
  const metricPatterns = {
    inputToLlmFirstToken: /"input_to_llm_first_token":\s*(\d+)/g,
    llmFirstToTtsFirst: /"llm_first_to_tts_first":\s*(\d+)/g,
    ttsFirstToPlayback: /"tts_first_to_playback":\s*(\d+)/g,
  };

  const metrics = {};
  for (const [key, pattern] of Object.entries(metricPatterns)) {
    const values = [];
    let match;
    while ((match = pattern.exec(segment))) {
      values.push(Number(match[1]));
    }
    values.sort((a, b) => a - b);
    metrics[key] = {
      count: values.length,
      p50: percentile(values, 0.5),
      p95: percentile(values, 0.95),
      max: values.length ? values[values.length - 1] : null,
    };
  }

  return {
    volcSynthCount: (segment.match(/volc 合成完成/g) || []).length,
    ttsFallbackCount: (segment.match(/主 TTS 失败，回退到备用 provider/g) || []).length,
    toneGuardCount: (segment.match(/tone guard flagged assistanty reply/g) || []).length,
    slowBrainJsonFailCount: (segment.match(/JSON 解析失败/g) || []).length,
    metrics,
  };
}

async function runCases() {
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const results = [];
    let currentIndex = -1;
    let active = null;
    let timer = null;

    const clearTimer = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const armTimer = () => {
      clearTimer();
      timer = setTimeout(() => {
        ws.close();
        reject(new Error(`timeout waiting for case ${active?.name ?? currentIndex}`));
      }, 25000);
    };

    const nextCase = () => {
      currentIndex += 1;
      if (currentIndex >= cases.length) {
        clearTimer();
        ws.close();
        resolve(results);
        return;
      }

      active = {
        ...cases[currentIndex],
        startedAt: Date.now(),
        firstTextMs: null,
        firstAudioMs: null,
        audioType: null,
      };
      armTimer();
      ws.send(JSON.stringify({ type: "chat", content: active.prompt }));
    };

    ws.on("open", () => {
      nextCase();
    });

    ws.on("message", (buf) => {
      let msg;
      try {
        msg = JSON.parse(buf.toString());
      } catch {
        return;
      }

      if (!active) return;
      if ((msg.type === "assistant" || msg.type === "chat_delta") && active.firstTextMs == null) {
        active.firstTextMs = Date.now() - active.startedAt;
      }
      if ((msg.type === "voice" || msg.type === "voice_pcm_chunk") && active.firstAudioMs == null) {
        active.firstAudioMs = Date.now() - active.startedAt;
        active.audioType = msg.type;
      }
      if (msg.type === "error") {
        clearTimer();
        ws.close();
        reject(new Error(`server error on ${active.name}: ${msg.content ?? "unknown"}`));
        return;
      }
      if (msg.type === "chat_end") {
        results.push({
          name: active.name,
          prompt: active.prompt,
          firstTextMs: active.firstTextMs,
          firstAudioMs: active.firstAudioMs,
          audioType: active.audioType,
        });
        active = null;
        nextCase();
      }
    });

    ws.on("error", (err) => {
      clearTimer();
      reject(err);
    });

    ws.on("close", () => {
      clearTimer();
    });
  });
}

const logPath = latestLiveLogPath();
const initialSize = fs.statSync(logPath).size;

// 日志里不回显 token（避免评测 Bearer token 落进 console/CI 日志）。
const redactedWsUrl = (() => {
  try {
    const u = new URL(wsUrl);
    if (u.searchParams.has("token")) u.searchParams.set("token", "<redacted>");
    return u.toString();
  } catch {
    return wsUrl;
  }
})();
console.log(`[volc-followup] using ws: ${redactedWsUrl}`);
console.log(`[volc-followup] tailing log: ${logPath}`);

const caseResults = await runCases();
const updatedLog = fs.readFileSync(logPath, "utf8");
const segment = Buffer.from(updatedLog, "utf8").subarray(initialSize).toString("utf8");
const summary = summarizeLogSegment(segment);

console.log("\n[volc-followup] case results");
for (const result of caseResults) {
  console.log(
    JSON.stringify({
      name: result.name,
      firstTextMs: result.firstTextMs,
      firstAudioMs: result.firstAudioMs,
      audioType: result.audioType,
    }),
  );
}

console.log("\n[volc-followup] log summary");
console.log(JSON.stringify(summary, null, 2));

if (summary.volcSynthCount === 0) {
  console.error("[volc-followup] no `volc 合成完成` found in appended logs");
  process.exitCode = 2;
}

