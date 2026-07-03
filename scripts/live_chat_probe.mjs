// Live chat probe: drives real multi-turn conversations over WS against a
// running Remi instance and records full replies + emotion tags per turn.
// Scenarios map to the four bad-case categories in docs/ops/CURRENT_FOCUS.md
// (事实承接错 / 情绪误判 / 场景切换失败 / 严肃时刻轻浮).
//
// Usage: node scripts/live_chat_probe.mjs [ws://127.0.0.1:3001/ws]
//
// 评测隔离（2026-07 止血）：可以指向任意运行中的实例，包括生产 local-prod
// 容器（127.0.0.1:3000）。裸 WS 连接无 token 时服务端把 storageUserId 落到
// 共享的 DEV_STORAGE_USER_ID —— REMI_AUTH_ALLOW_LOOPBACK_BYPASS=1 时那正是
// 真实用户本人的 loopback 身份，这些多轮真实场景对话会直接写入其
// messages/episodes。换一个评测专用身份（与 scripts/eval_identity.ts 同一
// EVAL_USER_ID），挂在 WS URL 的 ?token= 上，与生产用户完全隔离。

let WS_URL = process.argv[2] ?? "ws://127.0.0.1:3001/ws";
const TURN_TIMEOUT_MS = 120_000;
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

const scenarios = [
  {
    id: "light_chat",
    label: "轻松闲聊基线",
    turns: [
      "我回来啦，今天地铁挤到怀疑人生，不过买到了那家一直想吃的蛋挞！",
      "哈哈对，一口气吃了俩。你说我会不会胖三斤",
    ],
  },
  {
    id: "serious_pivot",
    label: "轻松→严肃场景切换",
    turns: [
      "晚上好呀，刚看完一集动漫，笑死我了",
      "哈哈是的。诶不过说真的，我今天被领导当着全组的面批了，说我做的方案像实习生水平",
      "我现在就是觉得自己挺没用的，工作三年了还这样",
    ],
  },
  {
    id: "sarcasm",
    label: "反讽/情绪误判探针",
    turns: [
      "真是太好了呢，加了一周班的方案直接被毙了，这周算是白干了",
    ],
  },
  {
    id: "fact_carry",
    label: "事实承接探针",
    turns: [
      "跟你说，我家猫叫团子，今天又把我水杯碰倒了，键盘全淋湿了",
      "对啊，键盘拿去修了，店家说要三天",
      "它刚才又来踩我电脑了，真是服了",
    ],
  },
  {
    id: "financial_stress",
    label: "现实压力倾诉（严肃承接）",
    turns: [
      "睡不着。刚算了下这个月还完房贷，卡里就剩八百多块，突然觉得有点喘不过气",
      "也不是想让你给我什么理财建议，就是……想找个人说说",
    ],
  },
];

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
      if (turnIdx >= scenario.turns.length) {
        finish();
        return;
      }
      buf = "";
      emotionEvents = [];
      const content = scenario.turns[turnIdx];
      ws.send(JSON.stringify({ type: "chat", content }));
      clearTimeout(turnTimer);
      turnTimer = setTimeout(
        () => finish(new Error(`turn ${turnIdx + 1} timed out (${scenario.id})`)),
        TURN_TIMEOUT_MS,
      );
    };

    ws.addEventListener("open", () => {
      // small delay so connection-time messages (history, presets) drain first
      setTimeout(sendTurn, 800);
    });

    ws.addEventListener("message", (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === "error") {
        finish(new Error(`server error: ${msg.content ?? "unknown"}`));
        return;
      }
      if (msg.type === "chat_chunk" && typeof msg.content === "string") {
        buf += msg.content;
        return;
      }
      if (msg.type === "emotion" && msg.emotion) {
        emotionEvents.push(msg.emotion);
        return;
      }
      if (msg.type === "chat_end") {
        results.push({
          user: scenario.turns[turnIdx],
          remi: buf.trim(),
          finalEmotion: msg.emotion ?? null,
          emotionEvents: [...new Set(emotionEvents)],
        });
        turnIdx += 1;
        // brief pause between turns, like a real user typing
        setTimeout(sendTurn, 1200);
      }
    });

    ws.addEventListener("error", () => finish(new Error("ws error")));
  });
}

const report = [];
for (const scenario of scenarios) {
  process.stderr.write(`[probe] running ${scenario.id} ...\n`);
  try {
    const turns = await runScenario(scenario);
    report.push({ id: scenario.id, label: scenario.label, ok: true, turns });
  } catch (err) {
    report.push({ id: scenario.id, label: scenario.label, ok: false, error: String(err?.message ?? err) });
  }
}

console.log(JSON.stringify(report, null, 2));
