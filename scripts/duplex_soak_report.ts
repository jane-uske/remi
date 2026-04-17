import fs from "fs";
import path from "path";

const {
  loadSoakSessionHarness,
  emitDuplexStart,
  emitDuplexStop,
  emitFrames,
  waitFor,
} = require("../test/helpers/soak_session_harness");
const {
  makeBroadbandNoiseFrame,
  makeSilenceFrame,
  makeSineFrame,
  makeSparseClickFrame,
  repeatFrames,
} = require("../test/helpers/pcm");

type MetricName =
  | "speech_end_to_stt_final"
  | "stt_final_to_llm_first"
  | "llm_first_to_tts_first"
  | "tts_first_to_playback";

type MetricSummary = {
  count: number;
  min: number | null;
  p50: number | null;
  p95: number | null;
  max: number | null;
};

type BehaviorAnomalies = {
  unexpected_interrupt_count: number;
  noise_promoted_to_assistant_count: number;
  missing_stt_final_count: number;
  duplicate_stt_final_count: number;
  duplicate_assistant_entering_count: number;
  missing_chat_end_count: number;
  stuck_turn_state_count: number;
};

type BehaviorScenarioSummary = {
  name: string;
  loops: number;
  passCount: number;
  failureCount: number;
  anomalies: BehaviorAnomalies;
  messageTypeHistogram: Record<string, number>;
  turnStateHistogram: Record<string, number>;
};

type LatencyTraceRecord = {
  traceId: string;
  connId: string;
  scenarioKey: string | null;
  sessionId: string | null;
  generationId: number | null;
  source: string | null;
  releaseReason: string | null;
  releaseStableMs: number | null;
  prosodyApplied: string | null;
  usedNoVadFallback: boolean;
  previewText: string | null;
  finalTranscript: string | null;
  interruptionType: string | null;
  turnStateTransitions: Array<{
    state: string;
    reason: string;
    at: number;
    generationId?: number;
    preview?: string | null;
    interruptionType?: string | null;
  }>;
  metrics: Record<string, number | null>;
  timestamps: Record<string, number | undefined>;
};

type LatencyScenarioSummary = {
  name: string;
  loops: number;
  traceCount: number;
  requiredTraceCount: number;
  meetsMinimumTraceCount: boolean;
  incompleteReasons: string[];
  metricSummaries: Record<MetricName, MetricSummary>;
};

type MisclassificationCategory =
  | "false_early_release"
  | "false_late_release"
  | "noise_promotion"
  | "resume_missed"
  | "interrupt_missed"
  | "state_stuck_or_duplicate";

type SampleRow = {
  sampleId: string;
  kind: "bad" | "control";
  category?: MisclassificationCategory;
  scenario: string;
  expected: string;
  actual: string;
  previewSummary: string | null;
  finalSummary: string | null;
  releaseSummary: string | null;
  userImpact: string;
};

type FailureRecord = {
  category: "behavior" | "latency";
  scenario: string;
  loop: number;
  reason: string;
  misclassification?: MisclassificationCategory;
  sample?: Omit<SampleRow, "kind">;
  details?: Record<string, unknown>;
};

type WarningRecord = {
  scenario: string;
  metric: MetricName;
  baselineP95: number;
  scenarioP95: number;
  driftPct: number;
};

type SoakRunConfig = {
  behaviorLoops: number;
  latencyLoops: number;
  seed: number;
  outputDir: string;
  generatedAt: string;
  dataSource: "synthetic_harness" | "browser_capture";
};

type SoakReport = {
  runConfig: SoakRunConfig;
  behaviorSummary: {
    totals: BehaviorAnomalies;
    scenarios: BehaviorScenarioSummary[];
  };
  latencySummary: {
    scenarios: LatencyScenarioSummary[];
    warnings: WarningRecord[];
    readiness: "complete" | "incomplete";
    incompleteReasons: string[];
  };
  misclassificationSummary: {
    totalBadSamples: number;
    categories: Array<{
      category: MisclassificationCategory;
      count: number;
      ratio: number;
      sampleIds: string[];
    }>;
  };
  sampleRows: SampleRow[];
  failures: FailureRecord[];
  recommendedAction: {
    status: "healthy" | "investigate" | "incomplete";
    topSignals: string[];
  };
};

type ParsedArgs = {
  behaviorLoops: number;
  latencyLoops: number;
  seed: number;
  outputDir: string;
};

type BehaviorRunResult = {
  parsed: any[];
  messageTypes: string[];
  turnStates: string[];
};

type LatencyScenarioRunResult = {
  parsed: any[];
  traces: LatencyTraceRecord[];
};

const METRIC_NAMES: MetricName[] = [
  "speech_end_to_stt_final",
  "stt_final_to_llm_first",
  "llm_first_to_tts_first",
  "tts_first_to_playback",
];

const MISCLASSIFICATION_CATEGORIES: MisclassificationCategory[] = [
  "false_early_release",
  "false_late_release",
  "noise_promotion",
  "resume_missed",
  "interrupt_missed",
  "state_stuck_or_duplicate",
];

function summarizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const compact = value.trim().replace(/\s+/g, " ");
  if (!compact) return null;
  return compact.length > 96 ? `${compact.slice(0, 93)}...` : compact;
}

function summarizeRelease(trace: Pick<
  LatencyTraceRecord,
  "releaseReason" | "releaseStableMs" | "prosodyApplied" | "usedNoVadFallback"
>): string | null {
  const parts = [
    trace.releaseReason ? `release=${trace.releaseReason}` : null,
    trace.releaseStableMs != null ? `stable=${trace.releaseStableMs}ms` : null,
    trace.prosodyApplied ? `prosody=${trace.prosodyApplied}` : null,
    trace.usedNoVadFallback ? "no_vad_fallback" : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

function extractSampleContext(parsed: any[]) {
  const turnMessages = parsed.filter(
    (msg) => msg && typeof msg === "object" && msg.type === "turn_state",
  );
  const sttFinal = parsed.find((msg) => msg && typeof msg === "object" && msg.type === "stt_final");
  const preview =
    turnMessages
      .map((msg: any) => summarizeText(msg.preview))
      .filter(Boolean)
      .slice(-1)[0] ?? null;
  const finalSummary = summarizeText(sttFinal?.content);
  const interruptionType =
    turnMessages
      .map((msg: any) => (typeof msg.interruptionType === "string" ? msg.interruptionType : null))
      .filter(Boolean)
      .slice(-1)[0] ?? null;
  return {
    previewSummary: preview,
    finalSummary,
    interruptionType,
    turnStates: turnMessages.map((msg: any) => String(msg.state)),
  };
}

function expectedScenarioBehavior(scenario: string): string {
  switch (scenario) {
    case "voice_roundtrip_baseline":
      return "single voice turn should produce one complete trace";
    case "speech_resume_before_gap_commit":
      return "short pause should merge into one voice turn";
    case "interrupt_then_new_turn":
      return "interrupt should hand off to a complete new turn";
    case "sparseClickNoise":
    case "strictNoPreviewNoise":
    case "fallbackLongHumNoise":
      return "noise should not promote to assistant";
    default:
      return "turn-taking should stay stable";
  }
}

function scenarioMinimumTraceCount(name: string): number {
  return name === "voice_roundtrip_baseline" ? 50 : 30;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function parseCliArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    behaviorLoops: 100,
    latencyLoops: 50,
    seed: 20260409,
    outputDir: path.resolve(process.cwd(), "artifacts/soak"),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];
    switch (token) {
      case "--behavior-loops":
        args.behaviorLoops = parsePositiveInt(next, args.behaviorLoops);
        i += 1;
        break;
      case "--latency-loops":
        args.latencyLoops = parsePositiveInt(next, args.latencyLoops);
        i += 1;
        break;
      case "--seed":
        args.seed = parsePositiveInt(next, args.seed);
        i += 1;
        break;
      case "--output-dir":
        if (next?.trim()) {
          args.outputDir = path.resolve(process.cwd(), next.trim());
          i += 1;
        }
        break;
      default:
        break;
    }
  }

  return args;
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timestampSlug(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "_",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function normalizeMessages(ws: any) {
  const parsed = ws.parsedMessages();
  const messageTypes = parsed
    .map((msg: any) => (msg && typeof msg === "object" ? msg.type : null))
    .filter(Boolean);
  const turnStates = parsed
    .filter((msg: any) => msg && typeof msg === "object" && msg.type === "turn_state")
    .map((msg: any) => msg.state);
  return { parsed, messageTypes, turnStates };
}

function emptyAnomalies(): BehaviorAnomalies {
  return {
    unexpected_interrupt_count: 0,
    noise_promoted_to_assistant_count: 0,
    missing_stt_final_count: 0,
    duplicate_stt_final_count: 0,
    duplicate_assistant_entering_count: 0,
    missing_chat_end_count: 0,
    stuck_turn_state_count: 0,
  };
}

function addHistogram(target: Record<string, number>, values: string[]): void {
  for (const value of values) {
    target[value] = (target[value] ?? 0) + 1;
  }
}

function countOccurrences<T>(values: T[], target: T): number {
  return values.filter((value) => value === target).length;
}

async function runBehaviorScenario(def: {
  name: string;
  transcript: string;
  frames: Buffer[];
  mode: "noise" | "speech";
}): Promise<BehaviorRunResult> {
  const harness = loadSoakSessionHarness({
    transcript: def.transcript,
    scenarioKey: def.name,
  });
  try {
    emitDuplexStart(harness.ws);
    emitFrames(harness.ws, def.frames);
    emitDuplexStop(harness.ws);

    if (def.mode === "noise") {
      await sleep(140);
    } else {
      try {
        await waitFor(() => {
          const { messageTypes, turnStates } = normalizeMessages(harness.ws);
          return (
            messageTypes.includes("stt_final") &&
            messageTypes.includes("chat_end") &&
            turnStates.includes("assistant_speaking")
          );
        }, 1200);
      } catch {
        await sleep(80);
      }
    }

    const { parsed, messageTypes, turnStates } = normalizeMessages(harness.ws);
    return { parsed, messageTypes, turnStates };
  } finally {
    harness.restore();
  }
}

function createInterruptChatStream() {
  return async function* interruptChatStream(
    _ctx: any,
    message: string,
    _emotion: string,
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    if (message === "先开一轮") {
      yield "我";
      while (!signal?.aborted) {
        await sleep(10);
      }
      return;
    }
    if (signal?.aborted) return;
    yield "新的回复已经接上了。";
  };
}

function toTraceRecord(log: any): LatencyTraceRecord {
  return {
    traceId: log.traceId,
    connId: log.connId,
    scenarioKey: log.scenarioKey ?? null,
    sessionId: log.sessionId ?? null,
    generationId: log.generationId,
    source: log.source,
    releaseReason: log.releaseReason ?? null,
    releaseStableMs: log.releaseStableMs ?? null,
    prosodyApplied: log.prosodyApplied ?? null,
    usedNoVadFallback: log.usedNoVadFallback ?? false,
    previewText: log.previewText ?? null,
    finalTranscript: log.finalTranscript ?? null,
    interruptionType: log.interruptionType ?? null,
    turnStateTransitions: Array.isArray(log.turnStateTransitions) ? log.turnStateTransitions : [],
    metrics: log.metrics,
    timestamps: log.timestamps,
  };
}

async function runLatencyVoiceRoundtrip(): Promise<LatencyScenarioRunResult> {
  const harness = loadSoakSessionHarness({
    transcript: "你好，我在这里。",
    scenarioKey: "voice_roundtrip_baseline",
  });
  try {
    const frames = [
      ...repeatFrames(makeSineFrame(0.18), 14),
      ...repeatFrames(makeBroadbandNoiseFrame(0.05, 320, 11), 2),
      ...repeatFrames(makeSineFrame(0.18), 4),
    ];
    emitDuplexStart(harness.ws);
    emitFrames(harness.ws, frames);
    emitDuplexStop(harness.ws);

    await waitFor(
      () =>
        harness.latencyLogs.some(
          (log: any) => log.metrics.tts_first_to_playback !== null,
        ),
      1500,
    );

    return {
      parsed: harness.ws.parsedMessages(),
      traces: harness.latencyLogs.map((log: any) => toTraceRecord(log)),
    };
  } finally {
    harness.restore();
  }
}

async function runLatencySpeechResumeBeforeGapCommit(): Promise<LatencyScenarioRunResult> {
  const harness = loadSoakSessionHarness({
    transcript: "我停一下然后接着说完。",
    scenarioKey: "speech_resume_before_gap_commit",
  });
  try {
    const frames = [
      ...repeatFrames(makeSineFrame(0.18), 6),
      ...repeatFrames(makeSilenceFrame(), 12),
      ...repeatFrames(makeSineFrame(0.18), 6),
    ];
    emitDuplexStart(harness.ws);
    emitFrames(harness.ws, frames);
    emitDuplexStop(harness.ws);

    await waitFor(
      () =>
        harness.latencyLogs.some(
          (log: any) => log.metrics.tts_first_to_playback !== null,
        ),
      1500,
    );

    return {
      parsed: harness.ws.parsedMessages(),
      traces: harness.latencyLogs.map((log: any) => toTraceRecord(log)),
    };
  } finally {
    harness.restore();
  }
}

async function runLatencyInterruptThenNewTurn(): Promise<LatencyScenarioRunResult> {
  const chatStreamImpl = createInterruptChatStream();
  const harness = loadSoakSessionHarness({
    chatStreamImpl,
    transcript: "你好，我在这里。",
    scenarioKey: "interrupt_then_new_turn",
  });

  try {
    harness.ws.emitMessage(
      JSON.stringify({
        type: "chat",
        content: "先开一轮",
      }),
    );

    await waitFor(() => {
      const { parsed } = normalizeMessages(harness.ws);
      return parsed.some(
        (msg: any) => msg && msg.type === "chat_chunk" && msg.generationId === 1,
      );
    }, 1000);

    emitDuplexStart(harness.ws);
    emitFrames(harness.ws, [
      ...repeatFrames(makeSineFrame(0.18), 10),
      ...repeatFrames(makeBroadbandNoiseFrame(0.05, 320, 13), 2),
      ...repeatFrames(makeSineFrame(0.18), 4),
    ]);
    emitDuplexStop(harness.ws);

    await waitFor(
      () =>
        harness.latencyLogs.some(
          (log: any) =>
            log.generationId === 2 && log.metrics.tts_first_to_playback !== null,
        ),
      1500,
    );

    return {
      parsed: harness.ws.parsedMessages(),
      traces: harness.latencyLogs.map((log: any) => toTraceRecord(log)),
    };
  } finally {
    harness.restore();
  }
}

function metricSummary(values: number[]): MetricSummary {
  if (values.length === 0) {
    return { count: 0, min: null, p50: null, p95: null, max: null };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))];
  return {
    count: sorted.length,
    min: sorted[0],
    p50: pick(0.5),
    p95: pick(0.95),
    max: sorted[sorted.length - 1],
  };
}

function aggregateLatencyScenario(
  name: string,
  loops: number,
  traces: LatencyTraceRecord[],
): LatencyScenarioSummary {
  const requiredTraceCount = scenarioMinimumTraceCount(name);
  const completeTraces = traces.filter(
    (trace) => trace.metrics.tts_first_to_playback !== null,
  );
  const metricSummaries = Object.fromEntries(
    METRIC_NAMES.map((metric) => {
      const values = completeTraces
        .map((trace) => trace.metrics[metric])
        .filter((value): value is number => typeof value === "number");
      return [metric, metricSummary(values)];
    }),
  ) as Record<MetricName, MetricSummary>;
  const incompleteReasons: string[] = [];
  if (completeTraces.length < requiredTraceCount) {
    incompleteReasons.push(
      `trace_count ${completeTraces.length} < required ${requiredTraceCount}`,
    );
  }

  return {
    name,
    loops,
    traceCount: completeTraces.length,
    requiredTraceCount,
    meetsMinimumTraceCount: completeTraces.length >= requiredTraceCount,
    incompleteReasons,
    metricSummaries,
  };
}

export function buildSoakReport(input: {
  config: SoakRunConfig;
  behaviorScenarios: BehaviorScenarioSummary[];
  latencyScenarios: LatencyScenarioSummary[];
  sampleRows: SampleRow[];
  failures: FailureRecord[];
}): SoakReport {
  const totals = emptyAnomalies();
  for (const scenario of input.behaviorScenarios) {
    for (const [key, value] of Object.entries(scenario.anomalies)) {
      totals[key as keyof BehaviorAnomalies] += value;
    }
  }

  const warnings: WarningRecord[] = [];
  const baseline = input.latencyScenarios.find(
    (scenario) => scenario.name === "voice_roundtrip_baseline",
  );
  if (baseline) {
    for (const scenario of input.latencyScenarios) {
      if (scenario.name === baseline.name) continue;
      for (const metric of METRIC_NAMES) {
        const baseP95 = baseline.metricSummaries[metric].p95;
        const currentP95 = scenario.metricSummaries[metric].p95;
        if (baseP95 == null || currentP95 == null || baseP95 <= 0) continue;
        const driftPct = ((currentP95 - baseP95) / baseP95) * 100;
        if (driftPct > 25) {
          warnings.push({
            scenario: scenario.name,
            metric,
            baselineP95: baseP95,
            scenarioP95: currentP95,
            driftPct: Number(driftPct.toFixed(2)),
          });
        }
      }
    }
  }

  const latencyIncompleteReasons = input.latencyScenarios.flatMap((scenario) =>
    scenario.incompleteReasons.map((reason) => `${scenario.name}: ${reason}`),
  );
  if (input.config.dataSource !== "browser_capture") {
    latencyIncompleteReasons.unshift(
      `data_source=${input.config.dataSource} is not a real browser capture`,
    );
  }

  const badSamples = input.sampleRows.filter((row) => row.kind === "bad" && row.category);
  const misclassificationSummary = {
    totalBadSamples: badSamples.length,
    categories: MISCLASSIFICATION_CATEGORIES.map((category) => {
      const rows = badSamples.filter((row) => row.category === category);
      return {
        category,
        count: rows.length,
        ratio:
          badSamples.length > 0 ? Number((rows.length / badSamples.length).toFixed(4)) : 0,
        sampleIds: rows.slice(0, 3).map((row) => row.sampleId),
      };
    }),
  };

  const topSignals: string[] = [];
  if (input.config.dataSource !== "browser_capture") {
    topSignals.push("当前报告来自 synthetic harness，只能验证回归口径，不能作为真实浏览器 duplex 验收结论。");
  }
  if (totals.noise_promoted_to_assistant_count > 0) {
    topSignals.push("噪音场景出现 assistant_entering，说明 VAD/turn 链路存在误提升。");
  }
  if (totals.duplicate_stt_final_count > 0 || totals.duplicate_assistant_entering_count > 0) {
    topSignals.push("存在重复 stt_final / assistant_entering，说明会话状态或 gap 提交可能有竞态。");
  }
  const dominantMisclassifications = misclassificationSummary.categories
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 2);
  for (const entry of dominantMisclassifications) {
    if (entry.category === "false_early_release") {
      topSignals.push("false_early_release 已出现，优先检查 release 判定和 prosody 旁路是否过早放行。");
    }
    if (entry.category === "resume_missed") {
      topSignals.push("resume_missed 已出现，说明短停顿续说仍可能被切成新回合。");
    }
    if (entry.category === "interrupt_missed") {
      topSignals.push("interrupt_then_new_turn 场景仍存在漏接，新回合承接还不够稳。");
    }
  }
  if (warnings.length > 0) {
    topSignals.push("部分 latency p95 相对基线漂移超过 25%，需要进一步检查长会话下的性能稳定性。");
  }
  if (topSignals.length === 0) {
    topSignals.push("当前 soak 未发现严重异常，底线稳定性可接受，可继续推进下一轮体验优化。");
  }

  return {
    runConfig: input.config,
    behaviorSummary: {
      totals,
      scenarios: input.behaviorScenarios,
    },
    latencySummary: {
      scenarios: input.latencyScenarios,
      warnings,
      readiness: latencyIncompleteReasons.length === 0 ? "complete" : "incomplete",
      incompleteReasons: latencyIncompleteReasons,
    },
    misclassificationSummary,
    sampleRows: input.sampleRows,
    failures: input.failures,
    recommendedAction: {
      status:
        latencyIncompleteReasons.length > 0
          ? "incomplete"
          : input.failures.length > 0 ||
        totals.noise_promoted_to_assistant_count > 0 ||
        totals.duplicate_stt_final_count > 0 ||
        totals.duplicate_assistant_entering_count > 0
          ? "investigate"
          : "healthy",
      topSignals,
    },
  };
}

export function renderMarkdownReport(report: SoakReport): string {
  const behaviorLines = report.behaviorSummary.scenarios.map((scenario) => {
    return [
      `- ${scenario.name}: loops=${scenario.loops}, pass=${scenario.passCount}, fail=${scenario.failureCount}`,
      `  anomalies=${JSON.stringify(scenario.anomalies)}`,
    ].join("\n");
  });

  const latencyLines = report.latencySummary.scenarios.map((scenario) => {
    const metrics = METRIC_NAMES.map((metric) => {
      const summary = scenario.metricSummaries[metric];
      return `${metric}: count=${summary.count}, min=${summary.min}, p50=${summary.p50}, p95=${summary.p95}, max=${summary.max}`;
    }).join(" | ");
    return `- ${scenario.name}: traces=${scenario.traceCount}, required=${scenario.requiredTraceCount}, meets_minimum=${scenario.meetsMinimumTraceCount}\n  ${metrics}`;
  });

  const failureLines =
    report.failures.length > 0
      ? report.failures.map(
          (failure) =>
            `- [${failure.category}] ${failure.scenario}#${failure.loop}: ${failure.reason}`,
        )
      : ["- none"];

  const warningLines =
    report.latencySummary.warnings.length > 0
      ? report.latencySummary.warnings.map(
          (warning) =>
            `- ${warning.scenario} ${warning.metric}: baseline p95=${warning.baselineP95}, scenario p95=${warning.scenarioP95}, drift=${warning.driftPct}%`,
        )
      : ["- none"];

  const incompleteLines =
    report.latencySummary.incompleteReasons.length > 0
      ? report.latencySummary.incompleteReasons.map((reason) => `- ${reason}`)
      : ["- none"];

  const misclassificationLines = report.misclassificationSummary.categories.map((entry) => {
    return `- ${entry.category}: count=${entry.count}, ratio=${entry.ratio}, sample_ids=${entry.sampleIds.join(",") || "none"}`;
  });

  const sampleLines =
    report.sampleRows.length > 0
      ? report.sampleRows.map((row) =>
          `- ${row.sampleId} [${row.kind}${row.category ? `/${row.category}` : ""}] ${row.scenario}: expected=${row.expected}; actual=${row.actual}; preview=${row.previewSummary ?? "null"}; final=${row.finalSummary ?? "null"}; release=${row.releaseSummary ?? "null"}; impact=${row.userImpact}`,
        )
      : ["- none"];

  return [
    "# 1. Run Config",
    "",
    `- behavior_loops: ${report.runConfig.behaviorLoops}`,
    `- latency_loops: ${report.runConfig.latencyLoops}`,
    `- seed: ${report.runConfig.seed}`,
    `- generated_at: ${report.runConfig.generatedAt}`,
    `- data_source: ${report.runConfig.dataSource}`,
    "",
    "# 2. Behavior Summary",
    "",
    ...behaviorLines,
    "",
    "# 3. Latency Summary",
    "",
    ...latencyLines,
    "",
    "Warnings:",
    ...warningLines,
    "",
    `Readiness: ${report.latencySummary.readiness}`,
    ...incompleteLines,
    "",
    "# 4. Misclassification Review",
    "",
    ...misclassificationLines,
    "",
    "Sample Rows:",
    ...sampleLines,
    "",
    "# 5. Failures / Anomalies",
    "",
    ...failureLines,
    "",
    "# 6. Recommended Action",
    "",
    `- status: ${report.recommendedAction.status}`,
    ...report.recommendedAction.topSignals.map((signal) => `- ${signal}`),
    "",
  ].join("\n");
}

async function runBehaviorLoops(
  loops: number,
  seed: number,
): Promise<{ scenarios: BehaviorScenarioSummary[]; failures: FailureRecord[]; sampleRows: SampleRow[] }> {
  const scenarioDefs = [
    {
      name: "sparseClickNoise",
      transcript: "词曲 李宗盛",
      frames: Array.from({ length: 12 }, () => makeSparseClickFrame()),
      mode: "noise" as const,
    },
    {
      name: "strictNoPreviewNoise",
      transcript: "词曲 李宗盛",
      frames: [
        ...Array.from({ length: 3 }, () => makeSineFrame(0.08)),
        ...Array.from({ length: 12 }, () => makeSineFrame(0.028)),
      ],
      mode: "noise" as const,
    },
    {
      name: "fallbackLongHumNoise",
      transcript: "请不吝点赞 订阅 转发 打赏支持明镜与点点栏目",
      frames: Array.from({ length: 140 }, () => makeSineFrame(0.03)),
      mode: "noise" as const,
    },
    {
      name: "humanSpeech",
      transcript: "你好，我在这里。",
      frames: [
        ...repeatFrames(makeSineFrame(0.18), 14),
        ...repeatFrames(makeBroadbandNoiseFrame(0.05, 320, 11), 2),
        ...repeatFrames(makeSineFrame(0.18), 4),
      ],
      mode: "speech" as const,
    },
    {
      name: "speechWithShortInternalSilence",
      transcript: "我中间停一下再继续。",
      frames: [
        ...repeatFrames(makeSineFrame(0.18), 6),
        ...repeatFrames(makeSilenceFrame(), 6),
        ...repeatFrames(makeSineFrame(0.18), 6),
      ],
      mode: "speech" as const,
    },
    {
      name: "speechResumeBeforeGapCommit",
      transcript: "我停一下然后接着说完。",
      frames: [
        ...repeatFrames(makeSineFrame(0.18), 6),
        ...repeatFrames(makeSilenceFrame(), 12),
        ...repeatFrames(makeSineFrame(0.18), 6),
      ],
      mode: "speech" as const,
    },
  ];

  const scenarioMap = new Map<string, BehaviorScenarioSummary>();
  for (const def of scenarioDefs) {
    scenarioMap.set(def.name, {
      name: def.name,
      loops,
      passCount: 0,
      failureCount: 0,
      anomalies: emptyAnomalies(),
      messageTypeHistogram: {},
      turnStateHistogram: {},
    });
  }

  const failures: FailureRecord[] = [];
  const sampleRows: SampleRow[] = [];
  const rng = mulberry32(seed);

  for (let loop = 0; loop < loops; loop += 1) {
    for (const def of shuffle(scenarioDefs, rng)) {
      const summary = scenarioMap.get(def.name)!;
      try {
        const result = await runBehaviorScenario(def);
        const sample = extractSampleContext(result.parsed);
        const sttFinalCount = countOccurrences(result.messageTypes, "stt_final");
        const chatEndCount = countOccurrences(result.messageTypes, "chat_end");
        const interruptCount = countOccurrences(result.messageTypes, "interrupt");
        const assistantEnteringCount = countOccurrences(
          result.turnStates,
          "assistant_entering",
        );
        const finalTurnState = result.turnStates[result.turnStates.length - 1] ?? "none";

        addHistogram(summary.messageTypeHistogram, result.messageTypes);
        addHistogram(summary.turnStateHistogram, result.turnStates);

        if (!sampleRows.some((row) => row.kind === "control" && row.scenario === def.name)) {
          sampleRows.push({
            sampleId: `${def.name}#control`,
            kind: "control",
            scenario: def.name,
            expected: expectedScenarioBehavior(def.name),
            actual: `messageTypes=${result.messageTypes.join(",") || "none"}; turnStates=${result.turnStates.join(",") || "none"}`,
            previewSummary: sample.previewSummary,
            finalSummary: sample.finalSummary,
            releaseSummary: null,
            userImpact: "control sample for comparison",
          });
        }

        if (interruptCount > 0) {
          summary.anomalies.unexpected_interrupt_count += interruptCount;
          failures.push({
            category: "behavior",
            scenario: def.name,
            loop,
            reason: "unexpected interrupt emitted during soak",
            misclassification: "state_stuck_or_duplicate",
            sample: {
              sampleId: `${def.name}#${loop}:unexpected_interrupt`,
              category: "state_stuck_or_duplicate",
              scenario: def.name,
              expected: expectedScenarioBehavior(def.name),
              actual: `unexpected interrupt count=${interruptCount}`,
              previewSummary: sample.previewSummary,
              finalSummary: sample.finalSummary,
              releaseSummary: null,
              userImpact: "assistant state transitions become unstable or duplicated",
            },
            details: { interruptCount },
          });
        }

        if (def.mode === "noise") {
          if (assistantEnteringCount > 0) {
            summary.anomalies.noise_promoted_to_assistant_count += assistantEnteringCount;
            failures.push({
              category: "behavior",
              scenario: def.name,
              loop,
              reason: "noise promoted to assistant_entering",
              misclassification: "noise_promotion",
              sample: {
                sampleId: `${def.name}#${loop}:assistant_promotion`,
                category: "noise_promotion",
                scenario: def.name,
                expected: expectedScenarioBehavior(def.name),
                actual: `assistant_entering count=${assistantEnteringCount}`,
                previewSummary: sample.previewSummary,
                finalSummary: sample.finalSummary,
                releaseSummary: null,
                userImpact: "ambient noise can falsely wake the assistant and break turn-taking trust",
              },
              details: { assistantEnteringCount },
            });
          }
          if (sttFinalCount > 0) {
            summary.anomalies.duplicate_stt_final_count += sttFinalCount;
            failures.push({
              category: "behavior",
              scenario: def.name,
              loop,
              reason: "noise emitted stt_final",
              misclassification: "noise_promotion",
              sample: {
                sampleId: `${def.name}#${loop}:noise_stt_final`,
                category: "noise_promotion",
                scenario: def.name,
                expected: expectedScenarioBehavior(def.name),
                actual: `stt_final count=${sttFinalCount}`,
                previewSummary: sample.previewSummary,
                finalSummary: sample.finalSummary,
                releaseSummary: null,
                userImpact: "noise can become a fake user turn and trigger an unwanted reply",
              },
              details: { sttFinalCount },
            });
          }
          if (
            finalTurnState === "listening_active" ||
            finalTurnState === "listening_hold" ||
            finalTurnState === "likely_end" ||
            finalTurnState === "assistant_entering" ||
            finalTurnState === "assistant_speaking"
          ) {
            summary.anomalies.stuck_turn_state_count += 1;
          }
        } else {
          if (sttFinalCount === 0) {
            summary.anomalies.missing_stt_final_count += 1;
            failures.push({
              category: "behavior",
              scenario: def.name,
              loop,
              reason: "speech scenario missing stt_final",
              misclassification:
                def.name === "speechResumeBeforeGapCommit"
                  ? "resume_missed"
                  : "false_late_release",
              sample: {
                sampleId: `${def.name}#${loop}:missing_stt_final`,
                category:
                  def.name === "speechResumeBeforeGapCommit"
                    ? "resume_missed"
                    : "false_late_release",
                scenario: def.name,
                expected: expectedScenarioBehavior(def.name),
                actual: "no stt_final emitted",
                previewSummary: sample.previewSummary,
                finalSummary: sample.finalSummary,
                releaseSummary: null,
                userImpact:
                  def.name === "speechResumeBeforeGapCommit"
                    ? "short pause continuation gets lost and breaks the user's sentence"
                    : "assistant keeps holding after the user already finished speaking",
              },
            });
          }
          if (sttFinalCount > 1) {
            summary.anomalies.duplicate_stt_final_count += sttFinalCount - 1;
            failures.push({
              category: "behavior",
              scenario: def.name,
              loop,
              reason: "duplicate stt_final detected",
              misclassification:
                def.name === "speechResumeBeforeGapCommit"
                  ? "resume_missed"
                  : "state_stuck_or_duplicate",
              sample: {
                sampleId: `${def.name}#${loop}:duplicate_stt_final`,
                category:
                  def.name === "speechResumeBeforeGapCommit"
                    ? "resume_missed"
                    : "state_stuck_or_duplicate",
                scenario: def.name,
                expected: expectedScenarioBehavior(def.name),
                actual: `stt_final count=${sttFinalCount}`,
                previewSummary: sample.previewSummary,
                finalSummary: sample.finalSummary,
                releaseSummary: null,
                userImpact:
                  def.name === "speechResumeBeforeGapCommit"
                    ? "one sentence gets split into multiple replies after a short pause"
                    : "turn lifecycle duplicates create unstable assistant behavior",
              },
              details: { sttFinalCount },
            });
          }
          if (assistantEnteringCount > 1) {
            summary.anomalies.duplicate_assistant_entering_count += assistantEnteringCount - 1;
            failures.push({
              category: "behavior",
              scenario: def.name,
              loop,
              reason: "duplicate assistant_entering detected",
              misclassification:
                def.name === "speechResumeBeforeGapCommit"
                  ? "resume_missed"
                  : "state_stuck_or_duplicate",
              sample: {
                sampleId: `${def.name}#${loop}:duplicate_assistant_entering`,
                category:
                  def.name === "speechResumeBeforeGapCommit"
                    ? "resume_missed"
                    : "state_stuck_or_duplicate",
                scenario: def.name,
                expected: expectedScenarioBehavior(def.name),
                actual: `assistant_entering count=${assistantEnteringCount}`,
                previewSummary: sample.previewSummary,
                finalSummary: sample.finalSummary,
                releaseSummary: null,
                userImpact:
                  def.name === "speechResumeBeforeGapCommit"
                    ? "assistant cuts in twice around one user sentence"
                    : "assistant state transition duplicates make turn-taking feel broken",
              },
              details: { assistantEnteringCount },
            });
          }
          if (chatEndCount === 0) {
            summary.anomalies.missing_chat_end_count += 1;
            failures.push({
              category: "behavior",
              scenario: def.name,
              loop,
              reason: "response scenario missing chat_end",
              misclassification: "state_stuck_or_duplicate",
              sample: {
                sampleId: `${def.name}#${loop}:missing_chat_end`,
                category: "state_stuck_or_duplicate",
                scenario: def.name,
                expected: expectedScenarioBehavior(def.name),
                actual: "chat_end missing",
                previewSummary: sample.previewSummary,
                finalSummary: sample.finalSummary,
                releaseSummary: null,
                userImpact: "assistant can enter speaking state but never complete the turn cleanly",
              },
            });
          }
          if (
            finalTurnState === "listening_active" ||
            finalTurnState === "listening_hold" ||
            finalTurnState === "likely_end" ||
            finalTurnState === "assistant_entering"
          ) {
            summary.anomalies.stuck_turn_state_count += 1;
          }
        }

        summary.passCount += 1;
      } catch (err) {
        summary.failureCount += 1;
        failures.push({
          category: "behavior",
          scenario: def.name,
          loop,
          reason: (err as Error).message,
        });
      }
    }
  }

  return {
    scenarios: scenarioDefs.map((def) => scenarioMap.get(def.name)!),
    failures,
    sampleRows,
  };
}

async function runLatencyLoops(
  loops: number,
): Promise<{ scenarios: LatencyScenarioSummary[]; failures: FailureRecord[]; sampleRows: SampleRow[] }> {
  const latencyDefs = [
    {
      name: "voice_roundtrip_baseline",
      run: runLatencyVoiceRoundtrip,
    },
    {
      name: "speech_resume_before_gap_commit",
      run: runLatencySpeechResumeBeforeGapCommit,
    },
    {
      name: "interrupt_then_new_turn",
      run: runLatencyInterruptThenNewTurn,
    },
  ];

  const aggregated = new Map<string, LatencyTraceRecord[]>();
  const failures: FailureRecord[] = [];
  const sampleRows: SampleRow[] = [];
  for (const def of latencyDefs) {
    aggregated.set(def.name, []);
  }

  for (let loop = 0; loop < loops; loop += 1) {
    for (const def of latencyDefs) {
      try {
        const result = await def.run();
        aggregated.get(def.name)!.push(...result.traces);
        const sample = extractSampleContext(result.parsed);
        const primaryTrace =
          result.traces.find((trace) => trace.generationId === 2) ??
          result.traces[result.traces.length - 1] ??
          null;

        if (!sampleRows.some((row) => row.kind === "control" && row.scenario === def.name) && primaryTrace) {
          sampleRows.push({
            sampleId: `${def.name}#control`,
            kind: "control",
            scenario: def.name,
            expected: expectedScenarioBehavior(def.name),
            actual: `complete trace ${primaryTrace.traceId}`,
            previewSummary: primaryTrace.previewText ?? sample.previewSummary,
            finalSummary: primaryTrace.finalTranscript ?? sample.finalSummary,
            releaseSummary: summarizeRelease(primaryTrace),
            userImpact: "control sample for comparison",
          });
        }

        if (def.name === "interrupt_then_new_turn") {
          const hasCompleteNewTurn = result.traces.some(
            (trace) =>
              trace.generationId === 2 && trace.metrics.tts_first_to_playback !== null,
          );
          if (!hasCompleteNewTurn) {
            failures.push({
              category: "latency",
              scenario: def.name,
              loop,
              reason: "new generation did not produce a complete playback trace",
              misclassification: "interrupt_missed",
              sample: {
                sampleId: `${def.name}#${loop}:missing_new_turn`,
                category: "interrupt_missed",
                scenario: def.name,
                expected: expectedScenarioBehavior(def.name),
                actual: "generation 2 missing complete playback trace",
                previewSummary: primaryTrace?.previewText ?? sample.previewSummary,
                finalSummary: primaryTrace?.finalTranscript ?? sample.finalSummary,
                releaseSummary: primaryTrace ? summarizeRelease(primaryTrace) : null,
                userImpact: "user interrupt does not hand off cleanly to the new turn",
              },
            });
          }
        }
        if (def.name === "speech_resume_before_gap_commit") {
          const enteringCount = countOccurrences(sample.turnStates, "assistant_entering");
          const sttFinalCount = result.parsed.filter((msg: any) => msg?.type === "stt_final").length;
          if (enteringCount > 1 || sttFinalCount > 1) {
            failures.push({
              category: "latency",
              scenario: def.name,
              loop,
              reason: "short-pause resume emitted multiple promotions or finals",
              misclassification: "resume_missed",
              sample: {
                sampleId: `${def.name}#${loop}:split_resume_turn`,
                category: "resume_missed",
                scenario: def.name,
                expected: expectedScenarioBehavior(def.name),
                actual: `assistant_entering=${enteringCount}, stt_final=${sttFinalCount}`,
                previewSummary: primaryTrace?.previewText ?? sample.previewSummary,
                finalSummary: primaryTrace?.finalTranscript ?? sample.finalSummary,
                releaseSummary: primaryTrace ? summarizeRelease(primaryTrace) : null,
                userImpact: "short pause continuation gets split into multiple turns",
              },
            });
          }
        }
        if (primaryTrace?.releaseReason && primaryTrace.previewText && primaryTrace.finalTranscript) {
          const previewLength = primaryTrace.previewText.length;
          const finalLength = primaryTrace.finalTranscript.length;
          const openTail = /[，,；;：:]$|然后$|但是$|因为$|我想$|就是说$/u.test(primaryTrace.previewText);
          if (openTail && finalLength >= previewLength + 4) {
            failures.push({
              category: "latency",
              scenario: def.name,
              loop,
              reason: "release happened while preview still looked incomplete",
              misclassification: "false_early_release",
              sample: {
                sampleId: `${def.name}#${loop}:false_early_release`,
                category: "false_early_release",
                scenario: def.name,
                expected: expectedScenarioBehavior(def.name),
                actual: `preview expanded from ${previewLength} to ${finalLength} chars after release`,
                previewSummary: primaryTrace.previewText,
                finalSummary: primaryTrace.finalTranscript,
                releaseSummary: summarizeRelease(primaryTrace),
                userImpact: "assistant can cut in before the user finishes the clause",
              },
            });
          }
          const speechEndToFinal = primaryTrace.metrics.speech_end_to_stt_final;
          if (
            def.name === "voice_roundtrip_baseline" &&
            typeof speechEndToFinal === "number" &&
            speechEndToFinal > 1200 &&
            primaryTrace.releaseStableMs != null &&
            primaryTrace.releaseStableMs > 900
          ) {
            failures.push({
              category: "latency",
              scenario: def.name,
              loop,
              reason: "release waited too long after a semantically complete baseline turn",
              misclassification: "false_late_release",
              sample: {
                sampleId: `${def.name}#${loop}:false_late_release`,
                category: "false_late_release",
                scenario: def.name,
                expected: expectedScenarioBehavior(def.name),
                actual: `speech_end_to_stt_final=${speechEndToFinal}ms`,
                previewSummary: primaryTrace.previewText,
                finalSummary: primaryTrace.finalTranscript,
                releaseSummary: summarizeRelease(primaryTrace),
                userImpact: "user finishes speaking but the assistant still waits awkwardly long",
              },
            });
          }
        }
      } catch (err) {
        failures.push({
          category: "latency",
          scenario: def.name,
          loop,
          reason: (err as Error).message,
        });
      }
    }
  }

  return {
    scenarios: latencyDefs.map((def) =>
      aggregateLatencyScenario(def.name, loops, aggregated.get(def.name)!),
    ),
    failures,
    sampleRows,
  };
}

async function writeReportFiles(report: SoakReport, outputDir: string): Promise<void> {
  fs.mkdirSync(outputDir, { recursive: true });
  const base = `duplex_soak_${timestampSlug()}`;
  const jsonPath = path.join(outputDir, `${base}.json`);
  const mdPath = path.join(outputDir, `${base}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(mdPath, renderMarkdownReport(report), "utf8");
  console.log(`SOAK_REPORT_JSON ${jsonPath}`);
  console.log(`SOAK_REPORT_MD ${mdPath}`);
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const config: SoakRunConfig = {
    behaviorLoops: args.behaviorLoops,
    latencyLoops: args.latencyLoops,
    seed: args.seed,
    outputDir: args.outputDir,
    generatedAt: new Date().toISOString(),
    dataSource: "synthetic_harness",
  };

  const behavior = await runBehaviorLoops(args.behaviorLoops, args.seed);
  const latency = await runLatencyLoops(args.latencyLoops);
  const report = buildSoakReport({
    config,
    behaviorScenarios: behavior.scenarios,
    latencyScenarios: latency.scenarios,
    sampleRows: [
      ...behavior.sampleRows,
      ...latency.sampleRows,
      ...behavior.failures
        .filter((failure) => failure.sample)
        .map((failure) => ({ kind: "bad" as const, ...failure.sample! })),
      ...latency.failures
        .filter((failure) => failure.sample)
        .map((failure) => ({ kind: "bad" as const, ...failure.sample! })),
    ],
    failures: [...behavior.failures, ...latency.failures],
  });

  await writeReportFiles(report, args.outputDir);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  });
}
