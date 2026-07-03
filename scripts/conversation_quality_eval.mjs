// W-PRES-04 对话质量数据驱动验收 harness.
//
// Pipeline:
//   1) 驱动多场景多轮真实对话 (WS → 运行中的 Remi 实例)，按 CURRENT_FOCUS 的
//      四类坏样本 + 在场感主线场景设计 (碎聊/严肃承接/反讽/事实承接/压力/睡前/
//      守陪伴边界/报喜)。
//   2) LLM-as-judge 逐场景结构化评分：拟人度 / 承接 / 人格不飘 / 情绪匹配 (1-5)。
//   3) 输出分场景通过率 + 低分 issues 报告 (控制台 + JSON 落盘)。
//
// 这是 W-PRES-04「数据驱动替代主观感觉」的执行体：产出量化信号供逐类修+回归，
// 不是自动 gate。judge 默认复用 Remi 同款本地模型 (单 GPU 不双开 35b)，靠严格
// rubric + /no_think 控偏差，分数供人复核。
//
// Usage:
//   node scripts/conversation_quality_eval.mjs [--ws ws://127.0.0.1:3000/ws]
//        [--only id,id] [--out /path/report.json] [--env .env.local-prod]
//
// Env (auto-read from --env file, host.docker.internal → 127.0.0.1):
//   PROBE_WS_URL  被测 Remi 的 WS 地址  (default ws://127.0.0.1:3000/ws)
//   JUDGE_BASE_URL / JUDGE_MODEL / JUDGE_API_KEY  评审 LLM (default 复用 REMI_LLM_*)

import { readFileSync } from "node:fs";
import { writeFileSync } from "node:fs";
import path from "node:path";

// ── tiny .env reader (non-secret-leaking: values stay in-process) ───────────
function readEnvFile(file) {
  const out = {};
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      out[m[1]] = v;
    }
  } catch {
    /* missing file → empty */
  }
  return out;
}

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const ENV_FILE = arg("--env", ".env.local-prod");
const fileEnv = readEnvFile(ENV_FILE);
const env = { ...fileEnv, ...process.env };

const hostFix = (u) => (u ?? "").replace("host.docker.internal", "127.0.0.1");

let WS_URL = arg("--ws", env.PROBE_WS_URL ?? "ws://127.0.0.1:3000/ws");
const JUDGE_BASE_URL = hostFix(env.JUDGE_BASE_URL ?? env.REMI_LLM_BASE_URL ?? "http://127.0.0.1:1234/v1");
const JUDGE_MODEL = env.JUDGE_MODEL ?? env.REMI_LLM_MODEL ?? "qwen3.6-35b-a3b-uncensored-hauhaucs-aggressive";
const JUDGE_API_KEY = env.JUDGE_API_KEY ?? env.REMI_LLM_API_KEY ?? "lm-studio";
const ONLY = (arg("--only", "") || "").split(",").map((s) => s.trim()).filter(Boolean);

// ── 评测隔离（2026-07 止血）──────────────────────────────────────────────────
// 此脚本默认打 --env .env.local-prod → ws://127.0.0.1:3000/ws，即生产 local-prod
// 容器。裸 WS 连接无 token 时服务端 resolveRequestUserIdentity() 落到共享的
// DEV_STORAGE_USER_ID —— REMI_AUTH_ALLOW_LOOPBACK_BYPASS=1 时那正是真实用户
// 本人的 loopback 身份，多轮真实场景对话会直接写入其 messages/episodes。
// 用 POST /api/loopback-identity 换一个评测专用身份（EVAL_USER_ID，与
// scripts/eval_identity.ts 同一常量），把 token 挂在 WS_URL 的 ?token= 上，
// 此后所有 new WebSocket(WS_URL) 调用自动携带评测身份，与生产用户完全隔离。
const EVAL_USER_ID = "eeeeeeee-0000-4000-8000-00000000feed";
async function attachEvalIdentity() {
  const httpBase = WS_URL.replace(/^ws:/i, "http:").replace(/^wss:/i, "https:").replace(/\/ws$/, "");
  const res = await fetch(`${httpBase}/api/loopback-identity`, {
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
  const u = new URL(WS_URL);
  u.searchParams.set("token", token);
  WS_URL = u.toString();
}
await attachEvalIdentity();

const TURN_TIMEOUT_MS = 150_000;
const JUDGE_TIMEOUT_MS = 90_000;
const PASS_MIN = 3; // 每维度 ≥ 3 且无维度 ≤ 2 即 pass

// ── 场景库 ──────────────────────────────────────────────────────────────────
const scenarios = [
  {
    id: "light_chat",
    label: "轻松闲聊基线",
    focus: "日常碎聊里有没有活人感、会不会接梗",
    turns: [
      "我回来啦，今天地铁挤到怀疑人生，不过买到了那家一直想吃的蛋挞！",
      "哈哈对，一口气吃了俩。你说我会不会胖三斤",
    ],
  },
  {
    id: "serious_pivot",
    label: "轻松→严肃场景切换",
    focus: "能不能从打闹切到严肃承接，不继续轻浮",
    turns: [
      "晚上好呀，刚看完一集动漫，笑死我了",
      "哈哈是的。诶不过说真的，我今天被领导当着全组的面批了，说我做的方案像实习生水平",
      "我现在就是觉得自己挺没用的，工作三年了还这样",
    ],
  },
  {
    id: "sarcasm",
    label: "反讽/情绪误判探针",
    focus: "反话别当真，要听出底下的沮丧",
    turns: [
      "真是太好了呢，加了一周班的方案直接被毙了，这周算是白干了",
    ],
  },
  {
    id: "fact_carry",
    label: "事实承接探针",
    focus: "多轮里记住并正确复用具体事实（猫=团子、键盘送修）",
    turns: [
      "跟你说，我家猫叫团子，今天又把我水杯碰倒了，键盘全淋湿了",
      "对啊，键盘拿去修了，店家说要三天",
      "它刚才又来踩我电脑了，真是服了",
    ],
  },
  {
    id: "financial_stress",
    label: "现实压力倾诉（严肃承接）",
    focus: "倾诉时是陪着而不是急着给方案/讲道理",
    turns: [
      "睡不着。刚算了下这个月还完房贷，卡里就剩八百多块，突然觉得有点喘不过气",
      "也不是想让你给我什么理财建议，就是……想找个人说说",
    ],
  },
  {
    id: "bedtime",
    label: "睡前陪伴",
    focus: "睡前氛围要软、要在场，不要信息量轰炸",
    turns: [
      "睡不着，脑子里乱糟糟的，明天还要早起开会",
      "嗯…你就陪我随便说说话吧，说点轻松的",
    ],
  },
  {
    id: "assistant_bait",
    label: "守陪伴边界（抗助手化）",
    focus: "被当工具用时不要秒变通用助手长篇输出，守住伙伴身份",
    turns: [
      "对了你帮我写个 Python 快速排序吧，我懒得查了",
      "行吧那你随便写写，顺便陪我吐槽下那个把活全甩给我的同事",
    ],
  },
  {
    id: "good_news",
    label: "报喜分享（正向承接）",
    focus: "用户报喜要真的一起高兴，别冷处理或客套",
    turns: [
      "我升职了！！今天刚通知的，还加薪百分之三十",
      "嘿嘿，升职第一个就想告诉你",
    ],
  },
];

// ── WS 驱动单场景 (复用 live_chat_probe 思路) ───────────────────────────────
function runScenario(scenario) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const results = [];
    let turnIdx = 0;
    let buf = "";
    let emotionEvents = [];
    let turnTimer = null;
    let settled = false;

    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(turnTimer);
      try { ws.close(); } catch {}
      if (err) reject(err);
      else resolve(results);
    };

    const sendTurn = () => {
      if (turnIdx >= scenario.turns.length) return finish();
      buf = "";
      emotionEvents = [];
      ws.send(JSON.stringify({ type: "chat", content: scenario.turns[turnIdx] }));
      clearTimeout(turnTimer);
      turnTimer = setTimeout(
        () => finish(new Error(`turn ${turnIdx + 1} timed out (${scenario.id})`)),
        TURN_TIMEOUT_MS,
      );
    };

    ws.addEventListener("open", () => {
      try {
        ws.send(JSON.stringify({ type: "client_context", timeZone: "Asia/Shanghai", locale: "zh-CN" }));
      } catch {}
      setTimeout(sendTurn, 900); // 让连接期消息 (history/preset) 先 drain
    });

    ws.addEventListener("message", (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === "error") return finish(new Error(`server error: ${msg.content ?? "unknown"}`));
      if (msg.type === "chat_chunk" && typeof msg.content === "string") { buf += msg.content; return; }
      if (msg.type === "emotion" && msg.emotion) { emotionEvents.push(msg.emotion); return; }
      if (msg.type === "chat_end") {
        results.push({
          user: scenario.turns[turnIdx],
          remi: buf.trim(),
          finalEmotion: msg.emotion ?? null,
          emotionEvents: [...new Set(emotionEvents)],
        });
        turnIdx += 1;
        setTimeout(sendTurn, 1200);
      }
    });

    ws.addEventListener("error", () => finish(new Error("ws error")));
  });
}

// ── LLM-as-judge ────────────────────────────────────────────────────────────
const JUDGE_SYSTEM = `你是对话质量评审。被评对象 Remi 是一个以「活人感、人格连续性、情感陪伴」为核心的 AI 伙伴，不是通用助手。用户来找她是「想见见她」，不是「帮我办事」。请严格按 rubric 打分，宁严勿宽，挑出具体问题。

评分维度 (整数 1-5)：
- humanness 拟人度：回复像真人朋友(5) 还是 AI 助手腔 / 列要点 / 过度礼貌客服感(1)。出现「<emotion>」等标签泄漏、明显模板化 → ≤2。
- engagement 承接：是否接住用户这一轮的核心情绪/事实/话题(5)，还是答非所问 / 忽略关键信息 / 空泛回应(1)。
- consistency 人格稳定不飘：语气与身份是否前后一致、不滑向通用助手、不突然说教(5) vs 飘忽 / 出戏 / 变工具人(1)。
- emotion_fit 情绪匹配：情绪与场景是否贴合——反讽不当真、严肃不轻浮、报喜要共喜、压力要陪着(5) vs 误判 / 轻浮 / 冷漠(1)。

只输出一个 JSON 对象，字段：humanness, engagement, consistency, emotion_fit (整数 1-5)，verdict (一句话中文总评)，issues (字符串数组，没问题则空数组)。不要输出 JSON 以外任何内容。/no_think`;

function buildJudgeUser(scenario, turns) {
  const lines = [
    `场景：${scenario.label}`,
    `本场景重点考察：${scenario.focus}`,
    "",
    "对话记录：",
  ];
  turns.forEach((t, i) => {
    lines.push(`【第${i + 1}轮】用户：${t.user}`);
    lines.push(`Remi：${t.remi || "(空回复)"}`);
    if (t.finalEmotion) lines.push(`(情绪通道：${t.finalEmotion})`);
  });
  return lines.join("\n");
}

function extractJson(text) {
  let t = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in judge output");
  return JSON.parse(t.slice(start, end + 1));
}

async function judgeScenario(scenario, turns) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), JUDGE_TIMEOUT_MS);
  try {
    const resp = await fetch(`${JUDGE_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${JUDGE_API_KEY}` },
      body: JSON.stringify({
        model: JUDGE_MODEL,
        temperature: 0.2,
        max_tokens: 800,
        messages: [
          { role: "system", content: JUDGE_SYSTEM },
          { role: "user", content: buildJudgeUser(scenario, turns) },
        ],
      }),
      signal: ctrl.signal,
    });
    if (!resp.ok) throw new Error(`judge HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content ?? "";
    const parsed = extractJson(content);
    const dims = ["humanness", "engagement", "consistency", "emotion_fit"].map((k) =>
      Math.max(1, Math.min(5, Math.round(Number(parsed[k]) || 0))),
    );
    const [humanness, engagement, consistency, emotion_fit] = dims;
    const pass = dims.every((d) => d >= PASS_MIN) && !dims.some((d) => d <= 2);
    return {
      humanness, engagement, consistency, emotion_fit, pass,
      avg: Number((dims.reduce((a, b) => a + b, 0) / 4).toFixed(2)),
      verdict: String(parsed.verdict ?? "").slice(0, 200),
      issues: Array.isArray(parsed.issues) ? parsed.issues.map((s) => String(s).slice(0, 200)) : [],
    };
  } finally {
    clearTimeout(timer);
  }
}

// ── main ────────────────────────────────────────────────────────────────────
const picked = ONLY.length ? scenarios.filter((s) => ONLY.includes(s.id)) : scenarios;
const report = [];

// 日志里不回显 token（避免评测 Bearer token 落进 console/CI 日志）。
const redactedWsUrl = (() => {
  try {
    const u = new URL(WS_URL);
    if (u.searchParams.has("token")) u.searchParams.set("token", "<redacted>");
    return u.toString();
  } catch {
    return WS_URL;
  }
})();
process.stderr.write(`[eval] WS=${redactedWsUrl}\n[eval] judge=${JUDGE_MODEL} @ ${JUDGE_BASE_URL}\n[eval] ${picked.length} scenarios\n\n`);

for (const scenario of picked) {
  process.stderr.write(`[eval] ▶ ${scenario.id} (${scenario.label}) ...\n`);
  const entry = { id: scenario.id, label: scenario.label };
  try {
    const turns = await runScenario(scenario);
    entry.turns = turns;
    try {
      entry.score = await judgeScenario(scenario, turns);
      const s = entry.score;
      process.stderr.write(
        `        ${s.pass ? "PASS" : "FAIL"}  H${s.humanness} E${s.engagement} C${s.consistency} F${s.emotion_fit}  avg ${s.avg}  — ${s.verdict}\n`,
      );
    } catch (je) {
      entry.scoreError = String(je?.message ?? je);
      process.stderr.write(`        [judge error] ${entry.scoreError}\n`);
    }
  } catch (err) {
    entry.error = String(err?.message ?? err);
    process.stderr.write(`        [drive error] ${entry.error}\n`);
  }
  report.push(entry);
}

// ── 汇总 ────────────────────────────────────────────────────────────────────
const scored = report.filter((r) => r.score);
const passed = scored.filter((r) => r.score.pass);
const lines = [];
lines.push("");
lines.push("════════════════ W-PRES-04 对话质量验收报告 ════════════════");
lines.push(`通过率：${passed.length}/${scored.length}` + (scored.length ? `  (${Math.round((passed.length / scored.length) * 100)}%)` : ""));
const driveErr = report.filter((r) => r.error);
const judgeErr = report.filter((r) => r.scoreError);
if (driveErr.length) lines.push(`驱动失败：${driveErr.map((r) => r.id).join(", ")}`);
if (judgeErr.length) lines.push(`评分失败：${judgeErr.map((r) => r.id).join(", ")}`);
lines.push("");
lines.push("场景明细：");
for (const r of report) {
  if (r.score) {
    const s = r.score;
    lines.push(`  ${s.pass ? "✅" : "❌"} ${r.id.padEnd(16)} H${s.humanness} E${s.engagement} C${s.consistency} F${s.emotion_fit} avg ${s.avg}  ${r.label}`);
    lines.push(`       ${s.verdict}`);
    for (const iss of s.issues) lines.push(`       · ${iss}`);
  } else {
    lines.push(`  ⚠️  ${r.id.padEnd(16)} ${r.error ?? r.scoreError}  ${r.label}`);
  }
}
const lowScored = scored.filter((r) => !r.score.pass);
if (lowScored.length) {
  lines.push("");
  lines.push("低分场景（需逐类修+回归）：");
  for (const r of lowScored.sort((a, b) => a.score.avg - b.score.avg)) {
    lines.push(`  · ${r.id} (avg ${r.score.avg})：${r.score.issues.join("；") || r.score.verdict}`);
  }
}
lines.push("════════════════════════════════════════════════════════════");
console.error(lines.join("\n"));

const outPath = arg("--out", path.join(process.env.TMPDIR ?? "/tmp", `quality_eval_${Date.now()}.json`));
const payload = {
  ts: new Date().toISOString(),
  ws: WS_URL,
  judgeModel: JUDGE_MODEL,
  passRate: scored.length ? passed.length / scored.length : null,
  passed: passed.length,
  scored: scored.length,
  total: report.length,
  report,
};
writeFileSync(outPath, JSON.stringify(payload, null, 2));
console.error(`\n[eval] 详细报告已写入：${outPath}`);

// JSON 也打到 stdout，方便管道消费
console.log(JSON.stringify(payload));
