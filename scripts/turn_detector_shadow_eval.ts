/**
 * PR5b turn-detector shadow eval harness.
 *
 * Replays a fixed set of Chinese voice scenarios through BOTH the legacy
 * detector (sync) and the real provider (async, via the sidecar over HTTP),
 * then prints the 5 deliverables:
 *   1. turn-end (endpoint) divergence table
 *   2. barge-in divergence table
 *   3. provider latency distribution (p50 / p90 / max)
 *   4. with-partial vs no-partial comparison
 *   5. on-mode judgment for Chinese voice
 *
 * It NEVER changes any live behavior — it only reads the two detectors.
 *
 * Run (sidecar must be up):
 *   python3 scripts/turn_detector_server.py --backend reference --port 8111 &
 *   REMI_TURN_DETECTOR_ENDPOINT=http://127.0.0.1:8111 \
 *   NODE_OPTIONS="--no-experimental-strip-types" \
 *   ./node_modules/.bin/ts-node --transpile-only scripts/turn_detector_shadow_eval.ts
 */
import {
  LegacyVadTurnDetector,
  LiveKitTurnDetectorAdapter,
} from "../server/session/voice/turn_detector";
import type {
  TurnTakingDecisionInput,
  TurnTakingState,
} from "../server/session/turn_taking";
import type { BargeInEvaluationInput } from "../server/session/voice/turn_detector/types";

const ENDPOINT =
  process.env.REMI_TURN_DETECTOR_ENDPOINT ?? "http://127.0.0.1:8111";

const baseTurn = {
  baseGapMs: 350,
  nowMs: 10_000,
  lastPartialUpdateAt: 9_500,
  lastGrowthAt: 9_500,
  hesitationHoldMs: 600,
  growthHoldMs: 500,
  likelyStableMs: 480,
  confirmedStableMs: 800,
  releaseMs: 120,
  minGapMs: 80,
};

interface TurnScenario {
  label: string;
  previewText: string;
  group: "with_partial" | "no_partial";
  baseGapMs?: number;
}

// Chinese turn-end scenarios spanning complete / incomplete / hesitation / silence.
const TURN_SCENARIOS: TurnScenario[] = [
  { label: "完整陈述句+句号", previewText: "我今天过得还不错。", group: "with_partial" },
  { label: "疑问句+问号", previewText: "你吃饭了吗？", group: "with_partial" },
  { label: "语气词结尾(吧)", previewText: "那就这样吧", group: "with_partial" },
  { label: "尾部连接词(然后)", previewText: "我先去买点东西然后", group: "with_partial" },
  { label: "犹豫填充(嗯)", previewText: "这个嗯", group: "with_partial" },
  { label: "未完成短句", previewText: "我想", group: "with_partial" },
  { label: "陈述无标点", previewText: "我觉得这个方案可以", group: "with_partial" },
  { label: "长停顿无文本", previewText: "", group: "no_partial", baseGapMs: 700 },
  { label: "短停顿无文本", previewText: "", group: "no_partial", baseGapMs: 300 },
  { label: "极短停顿无文本", previewText: "", group: "no_partial", baseGapMs: 150 },
];

interface BargeScenario {
  label: string;
  partialText: string;
  speechDurationMs: number;
  hasPartial: boolean;
  group: "with_partial" | "no_partial";
}

const BARGE_SCENARIOS: BargeScenario[] = [
  { label: "有partial 290ms", partialText: "等一下", speechDurationMs: 290, hasPartial: true, group: "with_partial" },
  { label: "有partial 350ms", partialText: "我说个事", speechDurationMs: 350, hasPartial: true, group: "with_partial" },
  { label: "有partial 220ms(短)", partialText: "嗯", speechDurationMs: 220, hasPartial: true, group: "with_partial" },
  { label: "无partial 350ms", partialText: "", speechDurationMs: 350, hasPartial: false, group: "no_partial" },
  { label: "无partial 500ms", partialText: "", speechDurationMs: 500, hasPartial: false, group: "no_partial" },
  { label: "无partial 200ms(短)", partialText: "", speechDurationMs: 200, hasPartial: false, group: "no_partial" },
];

function turnInput(s: TurnScenario): TurnTakingDecisionInput {
  return {
    ...baseTurn,
    baseGapMs: s.baseGapMs ?? baseTurn.baseGapMs,
    previewText: s.previewText,
  } as TurnTakingDecisionInput;
}

function bargeInput(s: BargeScenario): BargeInEvaluationInput {
  // Strong acoustic evidence held constant so the gate's text/duration effects
  // are what we isolate (we do NOT change any real threshold).
  return {
    assistantActive: true,
    speechDurationMs: s.speechDurationMs,
    minSpeechMs: 320,
    hasReliableEvidence: true,
    hasPartial: s.hasPartial,
    partialText: s.partialText,
  };
}

function rank(state: TurnTakingState): number {
  return { HOLD: 0, LIKELY_END: 1, CONFIRMED_END: 2 }[state] ?? 0;
}

function pct(arr: number[], p: number): number {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function pad(s: string, n: number): string {
  const w = [...s].reduce((acc, ch) => acc + (ch.charCodeAt(0) > 255 ? 2 : 1), 0);
  return s + " ".repeat(Math.max(0, n - w));
}

async function main() {
  const legacy = new LegacyVadTurnDetector();
  const real = new LiveKitTurnDetectorAdapter(ENDPOINT.replace(/\/+$/, ""));

  const available = await real.isAvailable();
  if (!available) {
    console.error(
      `\n[eval] sidecar not reachable at ${ENDPOINT}.\n` +
        `Start it first:\n` +
        `  python3 scripts/turn_detector_server.py --backend reference --port 8111\n` +
        `(or --backend livekit for the production model)\n`,
    );
    process.exit(2);
  }

  const latencies: number[] = [];

  // ── 1. turn-end divergence ────────────────────────────────────────────────
  const turnRows: string[] = [];
  let turnDiverged = 0;
  const partialAgree = { with: [0, 0], no: [0, 0] }; // [agree, total]
  for (const s of TURN_SCENARIOS) {
    const input = turnInput(s);
    const l = legacy.evaluateTurnEnd(input);
    const r = await real.evaluateTurnEndAsync(input);
    if (!r) continue;
    latencies.push(r.latencyMs);
    const diverged = l.state !== r.state;
    if (diverged) turnDiverged++;
    const bucket = s.group === "with_partial" ? partialAgree.with : partialAgree.no;
    bucket[1]++;
    if (!diverged) bucket[0]++;
    const dir = diverged ? (rank(r.state) > rank(l.state) ? "real早" : "legacy早") : "一致";
    turnRows.push(
      `${pad(s.label, 22)} ${pad(l.state, 14)} ${pad(r.state, 14)} ${pad(
        r.endOfTurnProb.toFixed(2),
        6,
      )} ${dir}`,
    );
  }

  // ── 2. barge-in divergence ────────────────────────────────────────────────
  const bargeRows: string[] = [];
  let bargeDiverged = 0;
  for (const s of BARGE_SCENARIOS) {
    const input = bargeInput(s);
    const l = legacy.evaluateBargeIn(input);
    const r = await real.evaluateBargeInAsync(input);
    if (!r) continue;
    latencies.push(r.latencyMs);
    const diverged = l.decision !== r.decision;
    if (diverged) bargeDiverged++;
    bargeRows.push(
      `${pad(s.label, 20)} ${pad(l.decision, 11)} ${pad(r.decision, 11)} ${
        diverged ? "分歧" : "一致"
      }`,
    );
  }

  // ── print ─────────────────────────────────────────────────────────────────
  console.log("\n========== PR5b turn-detector shadow eval ==========");
  console.log(`endpoint: ${ENDPOINT}`);
  console.log(`(legacy = 现网真实逻辑; real = sidecar 模型, shadow only)\n`);

  console.log("【表1】turn-end endpoint 分歧");
  console.log(`${pad("场景", 22)} ${pad("legacy", 14)} ${pad("real", 14)} ${pad("p(eou)", 6)} 方向`);
  console.log("-".repeat(70));
  turnRows.forEach((r) => console.log(r));
  console.log(`turn-end 分歧率: ${turnDiverged}/${TURN_SCENARIOS.length}\n`);

  console.log("【表2】barge-in 分歧");
  console.log(`${pad("场景", 20)} ${pad("legacy", 11)} ${pad("real", 11)} 判定`);
  console.log("-".repeat(50));
  bargeRows.forEach((r) => console.log(r));
  console.log(`barge-in 分歧率: ${bargeDiverged}/${BARGE_SCENARIOS.length}\n`);

  console.log("【表3】provider latency 分布 (ms)");
  console.log(`samples=${latencies.length}  p50=${pct(latencies, 50)}  p90=${pct(latencies, 90)}  max=${Math.max(...latencies)}\n`);

  console.log("【表4】有 partial vs 无 partial 一致率");
  const wp = partialAgree.with, np = partialAgree.no;
  console.log(`有 partial: 一致 ${wp[0]}/${wp[1]}  (分歧 ${wp[1] - wp[0]})`);
  console.log(`无 partial: 一致 ${np[0]}/${np[1]}  (分歧 ${np[1] - np[0]})\n`);

  console.log("【表5】中文语音是否值得进 on 模式 — 判断依据");
  const turnDivRate = turnDiverged / TURN_SCENARIOS.length;
  const p90 = pct(latencies, 90);
  console.log(`- turn-end 分歧率 ${(turnDivRate * 100).toFixed(0)}%；分歧多发生在: 句末语气词/连接词/无标点陈述`);
  console.log(`- real provider p90 延迟 ${p90}ms（${p90 <= 50 ? "可接受，可并入实时" : p90 <= 120 ? "偏高，需异步/缓存" : "过高，仅离线评估"}）`);
  console.log(`- 有 partial 时一致率 ${wp[1] ? ((wp[0] / wp[1]) * 100).toFixed(0) : "-"}%，无 partial 时 ${np[1] ? ((np[0] / np[1]) * 100).toFixed(0) : "-"}%`);
  console.log(`- 建议: ${onModeRecommendation(turnDivRate, p90)}`);
  console.log("\n注意: 若 backend=reference-heuristic，以上为示意数据；最终判断需用 --backend livekit 真实权重重跑。\n");
}

function onModeRecommendation(divRate: number, p90: number): string {
  if (p90 > 120) return "暂不进 on：延迟过高，先优化 provider 部署或仅作离线分析";
  if (divRate < 0.2) return "暂不进 on：与 legacy 分歧太小，收益不明确，继续 shadow 收集真实通话数据";
  if (divRate > 0.5) return "谨慎：分歧过大，需人工核验 real 是否真的更准，避免回退体验";
  return "可进入受控 A/B（仅 turn-end，保留 legacy 兜底），用真实中文通话验证 early-cut 是否提升体验";
}

main().catch((err) => {
  console.error("[eval] failed:", err);
  process.exit(1);
});
