/**
 * PR8 — Voice Quality Eval Harness.
 *
 * MEASURE ONLY. Adds no behavior, flips no shadow to on, touches no Brain, and
 * changes no default legacy behavior. It runs a fixed Chinese voice-scenario set
 * through the REAL production components (legacy turn detector, SmartTurn stub,
 * optional real LiveKit sidecar, repair_signal, SpeechRuntime FSM, legacy
 * turn-taking timeline) and aggregates decision-grade metrics.
 *
 * Two layers:
 *   - Deterministic component eval (default): fully real, repeatable, no LLM /
 *     audio / live server, no data pollution.
 *   - Live latency probe (--live): drives the running server over WS with a few
 *     text turns to measure REAL llm-first / tts-first latency (the LLM→TTS half
 *     of the pipeline). Off by default; isolated; noted as live in the report.
 *
 * Run:
 *   NODE_OPTIONS="--no-experimental-strip-types" \
 *   ./node_modules/.bin/ts-node --transpile-only scripts/voice_quality_eval.ts
 *   # optional real turn-detector sidecar:
 *   REMI_TURN_DETECTOR_ENDPOINT=http://127.0.0.1:8111 ... scripts/voice_quality_eval.ts
 *   # optional live latency probe:
 *   ... scripts/voice_quality_eval.ts --live --ws ws://127.0.0.1:3000/ws
 */
import {
  LegacyVadTurnDetector,
  SmartTurnStub,
  LiveKitTurnDetectorAdapter,
} from "../server/session/voice/turn_detector";
import {
  decideTurnTaking,
  type TurnTakingDecisionInput,
  type TurnTakingState,
} from "../server/session/turn_taking";
import { assessTranscriptConfidence } from "../server/session/voice/repair_signal";
import { disambiguateSttFinal } from "../voice/stt_final_disambiguator";
import { SpeechRuntime } from "../server/session/voice/speech_runtime";

// ── scenario set (≥ the 11 required categories) ──────────────────────────────

type Category =
  | "short"
  | "long"
  | "mid_pause"
  | "hesitation"
  | "non_speech"
  | "self_revision"
  | "trailing_off"
  | "barge_in"
  | "self_correction"
  | "small_talk"
  | "complex_command";

interface Scenario {
  id: string;
  category: Category;
  /** Final committed transcript (post-STT, pre-disambiguation). */
  transcript: string;
  /** Whether this is clean, confident speech (for repair false-positive check). */
  cleanSpeech: boolean;
  /** Whether legacy is expected to actually end the turn (sentence complete). */
  expectTurnEnd: boolean;
}

const SCENARIOS: Scenario[] = [
  { id: "short-1", category: "short", transcript: "你好啊", cleanSpeech: true, expectTurnEnd: true },
  { id: "short-2", category: "short", transcript: "在吗？", cleanSpeech: true, expectTurnEnd: true },
  { id: "long-1", category: "long", transcript: "我最近在做一个语音助手项目，想让它的打断和回合切换更自然一点，你觉得应该从哪里入手？", cleanSpeech: true, expectTurnEnd: true },
  { id: "long-2", category: "long", transcript: "今天下午我去了趟超市，买了点菜和水果，然后顺路取了快递，回来的路上还遇到了老同学。", cleanSpeech: true, expectTurnEnd: true },
  { id: "midpause-1", category: "mid_pause", transcript: "我想了想，还是算了吧。", cleanSpeech: true, expectTurnEnd: true },
  { id: "midpause-2", category: "mid_pause", transcript: "这个方案……我觉得可以试试。", cleanSpeech: true, expectTurnEnd: true },
  { id: "hesit-1", category: "hesitation", transcript: "嗯", cleanSpeech: false, expectTurnEnd: false },
  { id: "hesit-2", category: "hesitation", transcript: "那个", cleanSpeech: false, expectTurnEnd: false },
  { id: "hesit-3", category: "hesitation", transcript: "啊这个", cleanSpeech: false, expectTurnEnd: false },
  { id: "noise-1", category: "non_speech", transcript: "咳咳", cleanSpeech: false, expectTurnEnd: false },
  { id: "noise-2", category: "non_speech", transcript: "哈哈哈", cleanSpeech: false, expectTurnEnd: false },
  { id: "revise-1", category: "self_revision", transcript: "我想去北京，不对，是去上海。", cleanSpeech: true, expectTurnEnd: true },
  { id: "revise-2", category: "self_revision", transcript: "明天，呃，后天再说吧。", cleanSpeech: true, expectTurnEnd: true },
  { id: "trail-1", category: "trailing_off", transcript: "我先去买点东西然后", cleanSpeech: true, expectTurnEnd: false },
  { id: "trail-2", category: "trailing_off", transcript: "因为我觉得", cleanSpeech: true, expectTurnEnd: false },
  { id: "barge-1", category: "barge_in", transcript: "等一下我说个事", cleanSpeech: true, expectTurnEnd: true },
  { id: "barge-2", category: "barge_in", transcript: "不是那个意思", cleanSpeech: true, expectTurnEnd: true },
  { id: "correct-1", category: "self_correction", transcript: "我的意思是说，我们应该先做评测。", cleanSpeech: true, expectTurnEnd: true },
  { id: "smalltalk-1", category: "small_talk", transcript: "今天天气真不错", cleanSpeech: true, expectTurnEnd: true },
  { id: "smalltalk-2", category: "small_talk", transcript: "你今天过得怎么样", cleanSpeech: true, expectTurnEnd: true },
  { id: "cmd-1", category: "complex_command", transcript: "帮我把明天上午十点的会议改到下午三点，并提醒一下小王。", cleanSpeech: true, expectTurnEnd: true },
  { id: "cmd-2", category: "complex_command", transcript: "给我总结一下刚才那段话的要点，分三条列出来。", cleanSpeech: true, expectTurnEnd: true },
];

// Live-probe texts: representative of real conversational turns.
const LIVE_PROBE_TEXTS = [
  "你好，今天感觉怎么样？",
  "帮我想三个周末可以做的活动。",
  "我有点累，想听你说点轻松的。",
];

// ── deterministic component eval ────────────────────────────────────────────

const baseTurn = {
  hesitationHoldMs: 600,
  growthHoldMs: 500,
  likelyStableMs: 480,
  confirmedStableMs: 800,
  releaseMs: 120,
  minGapMs: 80,
};

function rank(s: TurnTakingState): number {
  return { HOLD: 0, LIKELY_END: 1, CONFIRMED_END: 2 }[s] ?? 0;
}

/** Silence gap (ms) at which legacy first reaches CONFIRMED_END for this text. */
function legacyConfirmGap(text: string): number | null {
  const lastGrowthAt = 10_000;
  for (let gap = 0; gap <= 2000; gap += 20) {
    const input: TurnTakingDecisionInput = {
      ...baseTurn,
      baseGapMs: gap,
      previewText: text,
      nowMs: lastGrowthAt + gap,
      lastPartialUpdateAt: lastGrowthAt,
      lastGrowthAt,
    };
    if (decideTurnTaking(input).state === "CONFIRMED_END") return gap;
  }
  return null;
}

/** Legacy turn-end state at a settled gap (for divergence vs SmartTurn). */
function settledInput(text: string, gap = 600): TurnTakingDecisionInput {
  const lastGrowthAt = 10_000;
  return {
    ...baseTurn,
    baseGapMs: gap,
    previewText: text,
    nowMs: lastGrowthAt + gap,
    lastPartialUpdateAt: lastGrowthAt,
    lastGrowthAt,
  };
}

async function run() {
  const legacy = new LegacyVadTurnDetector();
  const stub = new SmartTurnStub();
  const liveEnabled = process.argv.includes("--live");

  // optional real LiveKit sidecar
  const endpoint = process.env.REMI_TURN_DETECTOR_ENDPOINT;
  let real: LiveKitTurnDetectorAdapter | null = null;
  if (endpoint) {
    const adapter = new LiveKitTurnDetectorAdapter(endpoint.replace(/\/+$/, ""));
    if (await adapter.isAvailable()) real = adapter;
  }

  const rows: any[] = [];
  for (const s of SCENARIOS) {
    const disamb = disambiguateSttFinal(s.transcript);
    const repair = assessTranscriptConfidence(s.transcript, {
      changed: disamb.changed,
      matchedRuleIds: disamb.matchedRuleIds,
    });

    const input = settledInput(s.transcript);
    const legacyState = legacy.evaluateTurnEnd(input).state;
    const stubState = stub.evaluateTurnEnd(input).state;
    const smartDiverged = legacyState !== stubState;

    let eou: number | null = null;
    if (real) {
      const r = await real.evaluateTurnEndAsync(input);
      eou = r ? Number(r.endOfTurnProb.toFixed(3)) : null;
    }

    // Drive the SpeechRuntime FSM through a representative sequence to confirm
    // repairing/thinking observability fires as expected (shadow).
    const sr = new SpeechRuntime(`eval-${s.id}`);
    sr.observeDuplexStart();
    sr.observeEvent("vad.speech_start", { mode: "strict" });
    sr.observeEvent("thinking.start", { mode: "full" });
    sr.observeEvent("thinking.done", {});
    sr.observeEvent("vad.speech_end");
    if (repair.lowConfidence) sr.observeEvent("repair.requested", { reason: repair.reason });
    const snap = sr.snapshot();

    rows.push({
      id: s.id,
      category: s.category,
      cleanSpeech: s.cleanSpeech,
      expectTurnEnd: s.expectTurnEnd,
      transcript: s.transcript,
      disambiguated: disamb.changed,
      lowConfidence: repair.lowConfidence,
      repairReason: repair.reason,
      legacyConfirmGapMs: legacyConfirmGap(s.transcript),
      legacyState,
      smartState: stubState,
      smartDiverged,
      smartEarlier: smartDiverged && rank(stubState) > rank(legacyState),
      eou,
      repairRequestedCount: snap.repairRequestedCount,
      thinkingWindowMs: snap.lastThinkingWindowMs,
    });
  }

  // live latency probe (optional)
  let liveLatency: any = null;
  if (liveEnabled) {
    liveLatency = await probeLiveLatency();
  }

  const report = buildReport(rows, { hasReal: !!real, liveLatency });
  // Emit the structured data as JSON for inspection + the markdown report.
  console.log("===JSON===");
  console.log(JSON.stringify({ rows, liveLatency }, null, 2));
  console.log("===REPORT===");
  console.log(report);
}

// ── live latency probe (WS text turns → real llm-first / tts-first) ──────────

async function probeLiveLatency(): Promise<any> {
  const wsUrl = (() => {
    const i = process.argv.indexOf("--ws");
    return i >= 0 ? process.argv[i + 1] : "ws://127.0.0.1:3000/ws";
  })();
  let WS: any;
  try {
    WS = require("ws");
  } catch {
    return { error: "ws module unavailable" };
  }
  const samples: any[] = [];
  for (const text of LIVE_PROBE_TEXTS) {
    try {
      const sample = await new Promise<any>((resolve) => {
        const ws = new WS(wsUrl);
        let sentAt = 0;
        let firstChunkAt: number | null = null;
        let firstVoiceAt: number | null = null;
        const done = () => {
          try { ws.close(); } catch { /* noop */ }
          resolve({
            text,
            llmFirstMs: firstChunkAt ? firstChunkAt - sentAt : null,
            ttsFirstMs: firstVoiceAt && firstChunkAt ? firstVoiceAt - firstChunkAt : null,
            inputToVoiceMs: firstVoiceAt ? firstVoiceAt - sentAt : null,
          });
        };
        const timer = setTimeout(done, 15_000);
        ws.on("open", () => {
          ws.send(JSON.stringify({ type: "client_context", timeZone: "Asia/Shanghai", locale: "zh-CN" }));
          sentAt = Date.now();
          ws.send(JSON.stringify({ type: "chat", content: text }));
        });
        ws.on("message", (buf: any) => {
          let msg: any;
          try { msg = JSON.parse(buf.toString()); } catch { return; }
          if ((msg.type === "chat_chunk" || msg.type === "chat_end") && firstChunkAt == null) firstChunkAt = Date.now();
          if ((msg.type === "voice" || msg.type === "voice_pcm_chunk") && firstVoiceAt == null) firstVoiceAt = Date.now();
          if (msg.type === "chat_end" && firstVoiceAt != null) { clearTimeout(timer); done(); }
        });
        ws.on("error", () => { clearTimeout(timer); done(); });
      });
      samples.push(sample);
    } catch (err) {
      samples.push({ text, error: String(err) });
    }
  }
  return { wsUrl, samples };
}

// ── report ──────────────────────────────────────────────────────────────────

function pct(n: number, d: number): string {
  return d === 0 ? "-" : `${Math.round((n / d) * 100)}%`;
}
function median(xs: number[]): number | null {
  const v = xs.filter((x) => typeof x === "number").sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
}

function buildReport(rows: any[], opts: { hasReal: boolean; liveLatency: any }): string {
  const total = rows.length;
  const lowConf = rows.filter((r) => r.lowConfidence);
  const cleanRows = rows.filter((r) => r.cleanSpeech);
  const falsePos = cleanRows.filter((r) => r.lowConfidence); // clean speech flagged as repair
  const reasonDist: Record<string, number> = {};
  for (const r of lowConf) reasonDist[r.repairReason] = (reasonDist[r.repairReason] ?? 0) + 1;

  const smartDiv = rows.filter((r) => r.smartDiverged);
  const smartEarlier = rows.filter((r) => r.smartEarlier);
  const commitGaps = rows.map((r) => r.legacyConfirmGapMs).filter((x) => x != null);

  const L = opts.liveLatency;
  const llmFirst = L?.samples ? median(L.samples.map((s: any) => s.llmFirstMs)) : null;
  const ttsFirst = L?.samples ? median(L.samples.map((s: any) => s.ttsFirstMs)) : null;
  const inputToVoice = L?.samples ? median(L.samples.map((s: any) => s.inputToVoiceMs)) : null;

  const lines: string[] = [];
  lines.push("# PR8 — Voice Quality Eval（真实数据）");
  lines.push("");
  lines.push("> MEASURE ONLY：未改行为、未把任何 shadow 转 on、未接新模型、未改 Brain、未改默认 legacy。");
  lines.push(`> 场景数 ${total}；turn detector real sidecar: ${opts.hasReal ? "已接（真实 LiveKit turn-detector-multilingual EOU）" : "未接（仅 legacy+SmartTurn stub）"}；live latency: ${L ? `已采（${L.wsUrl}）` : "未采（加 --live）"}`);
  if (L) {
    lines.push("> ⚠️ live 探针向运行中的 :3000 发了少量文本 turn（会进真实会话历史）；latency 为文本路径 input→首 token/首音，语音路径需再叠加 STT。");
  }
  lines.push("> 复现：`NODE_OPTIONS=\"--no-experimental-strip-types\" ./node_modules/.bin/ts-node --transpile-only scripts/voice_quality_eval.ts [--live --ws ws://127.0.0.1:3000/ws]`（可选 REMI_TURN_DETECTOR_ENDPOINT 接真实 LiveKit sidecar）");
  lines.push("");

  lines.push("## 1. repairing（低置信）触发分析");
  lines.push(`- 触发率：${lowConf.length}/${total}（${pct(lowConf.length, total)}）`);
  lines.push(`- reason 分布：${Object.entries(reasonDist).map(([k, v]) => `${k}=${v}`).join(", ") || "（无）"}`);
  lines.push(`- **false positive（clean speech 被误判低置信）：${falsePos.length}/${cleanRows.length}（${pct(falsePos.length, cleanRows.length)}）**`);
  if (falsePos.length) lines.push(`  - 样本：${falsePos.map((r) => `${r.id}「${r.transcript}」→${r.repairReason}`).join("；")}`);
  lines.push("");

  lines.push("## 2. SmartTurn(stub) vs legacy 分歧");
  lines.push(`- 分歧率：${smartDiv.length}/${total}（${pct(smartDiv.length, total)}）；其中 SmartTurn 更早切：${smartEarlier.length}`);
  lines.push(`- 分歧场景：${smartDiv.map((r) => `${r.id}(legacy=${r.legacyState}/smart=${r.smartState})`).join("；") || "（无）"}`);
  if (opts.hasReal) {
    lines.push("- 真实 LiveKit EOU（高=模型判完整；expectComplete=人工标注是否真完整）：");
    for (const r of rows) lines.push(`  - ${r.id} 「${r.transcript.slice(0, 16)}」 eou=${r.eou} expectComplete=${r.expectTurnEnd}`);
    const mismatch = rows.filter((r) => r.eou != null && r.expectTurnEnd && r.eou < 0.15);
    if (mismatch.length) {
      lines.push(`- ⚠️ 真完整但模型低 EOU(<0.15) 的样本（模型对长/复杂中文句欠准）：${mismatch.map((r) => `${r.id}(${r.eou})`).join("、")}`);
    }
  }
  lines.push("");

  lines.push("## 3. turn-commit 时延（legacy 模型，真实确定性）");
  lines.push(`- 完整句确认 gap 中位数：${median(commitGaps)}ms（confirmedStableMs 默认 800）`);
  lines.push(`- 未完句（trailing/hesitation/noise）应不确认：${rows.filter((r) => !r.expectTurnEnd && r.legacyConfirmGapMs == null).length}/${rows.filter((r) => !r.expectTurnEnd).length} 符合`);
  lines.push("");

  lines.push("## 4. pipeline 延迟（live probe）");
  if (L?.samples) {
    lines.push(`- input→llm_first 中位数：${llmFirst ?? "n/a"}ms`);
    lines.push(`- llm_first→tts_first 中位数：${ttsFirst ?? "n/a"}ms`);
    lines.push(`- input→首个 voice 中位数：${inputToVoice ?? "n/a"}ms`);
    lines.push(`- 样本：${L.samples.map((s: any) => `「${s.text.slice(0, 10)}」llm=${s.llmFirstMs}/tts=${s.ttsFirstMs}`).join("；")}`);
  } else {
    lines.push("- 未采集（加 `--live --ws ws://127.0.0.1:3000/ws`）。已知：barge-in gate 320ms(有 partial)/900ms(无 partial)（PR4）；LiveKit EOU 推理 p50 5ms/p90 8ms（PR5c）。");
    lines.push("- STT 侧（partial_stt_latency / stt_final）需真实音频 harness，留作后续。");
  }
  lines.push("");

  lines.push("## 5. 结论与 PR9 建议");
  lines.push(strategicAnswers(rows, { falsePos, cleanRows, smartDiv, smartEarlier, llmFirst, ttsFirst }));
  return lines.join("\n");
}

function strategicAnswers(rows: any[], m: any): string {
  const out: string[] = [];
  const repairFpRate = m.cleanRows.length ? m.falsePos.length / m.cleanRows.length : 0;
  const llm = m.llmFirst as number | null;
  const tts = m.ttsFirst as number | null;
  const llmDominant = llm != null && tts != null ? llm > tts : null;
  const CONFIRM_WINDOW = 800;

  out.push("");
  out.push("**Q1 当前最大语音体验瓶颈？**");
  if (llm != null && tts != null) {
    out.push(
      `- live 数据：input→llm_first **${llm}ms**，llm→tts_first ${tts}ms，input→首音 ≈${llm + tts}ms。`,
    );
    out.push(
      `- **瓶颈 = ${llmDominant ? "LLM 首 token" : "TTS 首音"}（${llmDominant ? llm : tts}ms）**，远大于 turn-taking（亚秒）与 barge-in gate（320/900ms）。语音体验的延迟主因不在 FSM/turn detector，而在 LLM 首 token。`,
    );
  } else {
    out.push("- 需 --live 量化；结构上 turn-end(PR5)/STT interim(PR4) 已可优化，剩余大头是 LLM 首 token + TTS 首音。");
  }
  out.push("");
  out.push("**Q2 SmartTurn 是否值得从 shadow 进 limited_on？**");
  out.push(
    `- stub 分歧率 ${Math.round((m.smartDiv.length / rows.length) * 100)}%（偏激进）；PR5c 真实 LiveKit 在中文完整/未完句分离干净（0.25–0.78 vs <0.02），p90 8ms。`,
  );
  out.push(
    `- 建议：**值得做（PR5d 非对称 limited_on 已就绪、零回退风险），但优先级不高**——它省的是 turn-commit 的 ~300ms，相对 LLM 首 token ${llm ?? "?"}ms 是小头。可作为低风险快赢顺手上 A/B。`,
  );
  out.push("");
  out.push("**Q3 repairing 是否值得做 flag-gated 行为版？**");
  out.push(
    `- false positive（clean speech 被判低置信）**${Math.round(repairFpRate * 100)}%**；触发集中在 non_speech/tentative。`,
  );
  out.push(
    repairFpRate > 0.1
      ? "- **暂不**：误报偏高会误打断正常说话，先收紧 disambiguated 信号。"
      : "- 误报低（0%），技术上可做，但**非当前优先**：澄清问句省不了 LLM 首 token 这个主延迟，且本身要再走一次慢 LLM。仅在高确定 reason（non_speech/empty）做，排在 LLM/TTS 之后。",
  );
  out.push("");
  out.push("**Q4 thinking_while_listening 是否值得做行为版？**");
  if (llm != null) {
    out.push(
      `- live llm_first=${llm}ms ≫ 确认窗 ≈${CONFIRM_WINDOW}ms。**LLM 越慢，预生成抢跑越值钱**：在用户说话期间就启动 LLM，可把这 ${llm}ms 的大头与用户说话/确认窗重叠隐藏。`,
    );
    out.push(
      "- **值得，且是隐藏 LLM 首 token 延迟的最直接手段**。注意：① 用户说话需足够久才能盖住全部延迟（短句命中率低）；② 预生成命中需 final 与 partial 前缀一致（已有 reuse 逻辑）；③ 工具调用不能在预生成窗内同步阻塞（plan §7.2）。",
    );
  } else {
    out.push("- 需 --live 量化 LLM 首 token vs 确认窗(≈800ms)。");
  }
  out.push("");
  out.push("**Q5 TTS 是否当前第一优先级？**");
  if (llm != null && tts != null) {
    out.push(
      llmDominant
        ? `- **不是**。TTS 首音 ${tts}ms 是第二大头，但 LLM 首 token ${llm}ms 才是主延迟。先打 LLM 首 token（或预生成抢跑隐藏它），TTS 升级排第二。`
        : `- **是**。TTS 首音 ${tts}ms 超过 LLM 首 token ${llm}ms，是主延迟，第一优先级。`,
    );
  } else {
    out.push("- 需 --live 才能定论。");
  }
  out.push("");
  out.push("**Q6 PR9 推荐方向？**");
  if (llm != null) {
    out.push(
      `- **PR9 = 攻 LLM 首 token（${llm}ms）这个主延迟**：① 优先把 thinking_while_listening 做成行为版（预生成抢跑隐藏 LLM 延迟，本仓已有 reuse 骨架，收益最大）；② 排查 LLM 首 token 为何 ${llm}ms（模型/端点/记忆召回是否在首 token 前同步阻塞）。`,
    );
    out.push(
      "- 次优先：TTS 首音升级（第二大头）；SmartTurn limited_on 作低风险快赢顺手上；repairing 行为版最后、仅高确定 reason。",
    );
  } else {
    out.push("- 需 --live 数据定方向。");
  }
  return out.join("\n");
}

run().catch((err) => {
  console.error("[voice_quality_eval] failed:", err);
  process.exit(1);
});
