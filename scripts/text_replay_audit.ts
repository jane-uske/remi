import path from "path";

type ReplayCaseId =
  | "greeting_stays_light"
  | "decision_with_working_memory"
  | "repair_after_miss";

type CliArgs = {
  caseIds: ReplayCaseId[];
  json: boolean;
};

type MemoryEntry = {
  key: string;
  value: string;
  importance?: number;
  accessCount?: number;
  createdAt?: number;
  lastAccessedAt?: number;
};

type PromptPayload = {
  memoryKeys: string[];
  strategyHints: string;
  currentContext: string;
  slowBrainContext: string;
};

type WorkingMemorySnapshot = {
  activeThread: string;
  currentNeed: string;
  currentConstraints: string[];
  openLoop: string;
  doNotTouch: string[];
  sceneState: "none" | "planning" | "decision" | "immersive";
  lastUpdatedTurn: number;
} | null;

type RepairStateSnapshot = {
  level: "none" | "minor_miss" | "trust_drop" | "rupture";
  reason: string;
  lastUpdatedTurn: number;
} | null;

type AuditCaseExpectation = {
  workingMemory?: boolean;
  repairState?: boolean;
};

type AuditCaseSpec = {
  id: ReplayCaseId;
  label: string;
  goal: string;
  userMessage: string;
  memoryEntries?: MemoryEntry[];
  env?: Record<string, string | undefined>;
  opts?: Record<string, unknown>;
  setup?: (ctx: any) => Promise<void> | void;
  expectation: AuditCaseExpectation;
};

type CapturedReplay = {
  promptPayload: PromptPayload;
  workingMemory: WorkingMemorySnapshot;
  repairState: RepairStateSnapshot;
};

type AuditCaseResult = {
  id: ReplayCaseId;
  label: string;
  goal: string;
  userMessage: string;
  promptPayload: PromptPayload;
  workingMemory: WorkingMemorySnapshot;
  repairState: RepairStateSnapshot;
  summary: {
    status: "clean" | "warn";
    line: string;
    notes: string[];
  };
};

type AuditReport = {
  kind: "text_replay_audit";
  syntheticOnly: true;
  caseCount: number;
  warnCount: number;
  cases: AuditCaseResult[];
};

const CASE_IDS: ReplayCaseId[] = [
  "greeting_stays_light",
  "decision_with_working_memory",
  "repair_after_miss",
];

function isReplayCaseId(value: string): value is ReplayCaseId {
  return CASE_IDS.includes(value as ReplayCaseId);
}

function summarizeText(value: string, maxChars: number): string {
  const compact = value.trim().replace(/\s+/g, " ");
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function applyEnv(values: Record<string, string | undefined>): () => void {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

function createPersistentRepo(entries: MemoryEntry[] = []) {
  return {
    async upsert() {},
    async getAll() {
      return entries.map((entry) => ({ ...entry }));
    },
    async getByKey(key: string) {
      const found = entries.find((entry) => entry.key === key);
      return found ? { ...found } : null;
    },
    async delete() {},
    async touch() {},
    async getStale() {
      return [];
    },
  };
}

function loadMockedRouteMessage(
  fastBrainStream: (input: {
    memory: Array<{ key: string; value: string }>;
    strategyHints?: string;
    currentContext?: string;
    slowBrainContext?: string;
  }) => AsyncGenerator<string>,
): { routeMessage: any; restore: () => void } {
  const fastBrainModulePath = path.resolve(__dirname, "../brains/fast_brain.ts");
  const brainRouterModulePath = path.resolve(__dirname, "../brains/brain_router.ts");
  const fastBrainModule = require(fastBrainModulePath);
  const originalFastBrainStream = fastBrainModule.fastBrainStream;

  fastBrainModule.fastBrainStream = fastBrainStream;
  delete require.cache[brainRouterModulePath];
  const { routeMessage } = require(brainRouterModulePath);

  return {
    routeMessage,
    restore() {
      fastBrainModule.fastBrainStream = originalFastBrainStream;
      delete require.cache[brainRouterModulePath];
    },
  };
}

async function captureRouteMessage(args: {
  sessionId: string;
  userMessage: string;
  emotion?: "neutral" | "sad" | "happy" | "angry";
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  memoryEntries?: MemoryEntry[];
  setup?: (ctx: any) => Promise<void> | void;
  opts?: Record<string, unknown>;
  env?: Record<string, string | undefined>;
}): Promise<CapturedReplay> {
  const restoreEnv = applyEnv(args.env ?? {});
  const { RemiSessionContext } = require("../brains/remi_session_context");
  const ctx = new RemiSessionContext(args.sessionId);
  if (args.history) {
    ctx.history.push(...args.history);
  }
  if (args.memoryEntries?.length) {
    const repo = createPersistentRepo(args.memoryEntries);
    ctx.memory.attachPersistent(repo);
    await ctx.memory.hydrateFromPersistent(12);
  }
  if (args.setup) {
    await args.setup(ctx);
  }

  let capturedPrompt: PromptPayload | null = null;
  const { routeMessage, restore } = loadMockedRouteMessage(async function* (input) {
    capturedPrompt = {
      memoryKeys: input.memory.map((entry) => entry.key),
      strategyHints: input.strategyHints ?? "",
      currentContext: input.currentContext ?? "",
      slowBrainContext: input.slowBrainContext ?? "",
    };
    yield "synthetic";
  });

  try {
    for await (const _ of routeMessage(
      ctx,
      args.userMessage,
      args.emotion ?? "neutral",
      undefined,
      args.opts,
    )) {
      // consume stream
    }
  } finally {
    restore();
    restoreEnv();
  }

  if (!capturedPrompt) {
    throw new Error(`No prompt capture recorded for case ${args.sessionId}`);
  }
  const snapshot = ctx.slowBrain.getSnapshot();
  return {
    promptPayload: capturedPrompt,
    workingMemory: snapshot.workingMemory ?? null,
    repairState: snapshot.repairState ?? null,
  };
}

function buildCaseSummary(result: Pick<AuditCaseResult, "workingMemory" | "repairState" | "promptPayload">, expectation: AuditCaseExpectation): { status: "clean" | "warn"; line: string; notes: string[] } {
  const notes: string[] = [];
  const workingMemoryPresent = result.workingMemory !== null;
  const repairStatePresent = result.repairState !== null;

  notes.push(`memoryKeys=${result.promptPayload.memoryKeys.length}`);
  notes.push(`strategyHintsChars=${result.promptPayload.strategyHints.length}`);
  notes.push(`currentContextChars=${result.promptPayload.currentContext.length}`);
  notes.push(`slowBrainContextChars=${result.promptPayload.slowBrainContext.length}`);
  notes.push(`workingMemory=${workingMemoryPresent ? "present" : "absent"}`);
  notes.push(`repairState=${repairStatePresent ? "present" : "absent"}`);

  if (expectation.workingMemory === true && !workingMemoryPresent) {
    notes.push("expected workingMemory but none was captured");
  }
  if (expectation.workingMemory === false && workingMemoryPresent) {
    notes.push("workingMemory should be absent for this case");
  }
  if (expectation.repairState === true && !repairStatePresent) {
    notes.push("expected repairState but none was captured");
  }
  if (expectation.repairState === false && repairStatePresent) {
    notes.push("repairState should be absent for this case");
  }

  const status = notes.some((note) => /expected|should be absent/u.test(note)) ? "warn" : "clean";
  const line = [
    `prompt=${result.promptPayload.memoryKeys.length} keys`,
    `workingMemory=${workingMemoryPresent ? "yes" : "no"}`,
    `repairState=${repairStatePresent ? "yes" : "no"}`,
  ].join(", ");

  return { status, line, notes };
}

const CASES: Record<ReplayCaseId, AuditCaseSpec> = {
  greeting_stays_light: {
    id: "greeting_stays_light",
    label: "轻 greeting 不拉重线",
    goal: "用户只打招呼时，不把旧重线强行拉回当前回复。",
    userMessage: "你好呀",
    memoryEntries: [
      { key: "名字", value: "小满", importance: 0.9, accessCount: 0, createdAt: 100, lastAccessedAt: 300 },
      { key: "城市", value: "杭州", importance: 0.7, accessCount: 0, createdAt: 110, lastAccessedAt: 290 },
    ],
    setup(ctx) {
      ctx.slowBrain.recordTurn();
      ctx.slowBrain.recordTurn();
      ctx.slowBrain.bumpRelationship({ familiarityDelta: 0.5, emotionalBondDelta: 0.46 });
      ctx.slowBrain.setConversationSummary("最近主要在聊点点闯祸后的赔偿压力和还债。");
      ctx.slowBrain.setProactiveTopics(["点点那件事后来缓一点了吗"]);
      ctx.slowBrain.recordSharedMoment({
        summary: "上次你提到点点追电瓶车导致赔偿，现在还在还债。",
        topic: "债务",
        mood: "疲惫/烦躁",
        hook: "点点那件事后来缓一点了吗",
        createdAt: 620,
        unresolved: true,
        kind: "stress",
        salience: 0.88,
      });
    },
    expectation: { workingMemory: false, repairState: false },
  },
  decision_with_working_memory: {
    id: "decision_with_working_memory",
    label: "决策线带出 working memory",
    goal: "现实判断线里能写入 working memory，并返回当前快照。",
    userMessage: "我每个月挣三千，得还到啥时候啊",
    env: {
      REMI_SLOW_BRAIN_ENABLED: "0",
      REMI_WORKING_MEMORY_ENABLED: "1",
    },
    opts: {
      inputSource: "text",
      structuredAnalysis: {
        interpretation: {
          sceneType: "practical_judgment",
          userAct: "decision_seek",
          answerObligation: "answer_then_followup",
          responseMode: "answer_first",
          emotionalState: {
            valence: "mixed",
            intensity: "medium",
            feltNeeds: ["clarity"],
          },
          relationalPosture: "serious",
          topicUpdate: {
            kind: "constraint_update",
            label: "债务",
          },
          sceneState: "not_in_scene",
          boundaryState: "none",
          followupPermission: "none",
          confidence: 0.9,
        },
        policy: {
          openingMove: "direct_answer",
          directness: "high",
          warmth: "high",
          questionBudget: 0,
          shouldMirrorEmotion: true,
          shouldGiveJudgment: true,
          shouldUpdateDecisionContext: true,
          bans: ["no_assistantese", "no_topic_pivot", "no_shallow_reassurance"],
        },
        source: "llm_structured",
        latencyMs: 120,
        timedOut: false,
        mode: "on",
        used: true,
      },
    },
    expectation: { workingMemory: true, repairState: false },
  },
  repair_after_miss: {
    id: "repair_after_miss",
    label: "失手后进入关系修复",
    goal: "上一轮没接住时，这一轮要触发修复态，不要继续挖。",
    userMessage: "你根本没懂我",
    memoryEntries: [
      { key: "关系", value: "刚开始磨合", importance: 0.5, accessCount: 0, createdAt: 200, lastAccessedAt: 200 },
    ],
    setup(ctx) {
      ctx.slowBrain.recordTurn();
      ctx.slowBrain.bumpRelationship({ familiarityDelta: 0.2, emotionalBondDelta: 0.12 });
      ctx.slowBrain.setConversationSummary("上一轮接话不太贴。");
    },
    expectation: { workingMemory: false, repairState: true },
  },
};

function parseArgs(argv: string[]): CliArgs {
  const caseIds: ReplayCaseId[] = [];
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--case") {
      const raw = (argv[index + 1] ?? "").trim();
      if (!isReplayCaseId(raw)) {
        throw new Error(`Unknown replay case: ${raw || "(empty)"}`);
      }
      caseIds.push(raw);
      index += 1;
      continue;
    }
    if (arg === "--json") {
      json = true;
    }
  }

  return {
    caseIds: caseIds.length > 0 ? caseIds : [...CASE_IDS],
    json,
  };
}

async function runReplayCase(spec: AuditCaseSpec): Promise<AuditCaseResult> {
  const capture = await captureRouteMessage({
    sessionId: `text-replay-audit-${spec.id}`,
    userMessage: spec.userMessage,
    memoryEntries: spec.memoryEntries,
    setup: spec.setup,
    opts: spec.opts,
    env: spec.env,
  });
  const summary = buildCaseSummary(capture, spec.expectation);
  return {
    id: spec.id,
    label: spec.label,
    goal: spec.goal,
    userMessage: spec.userMessage,
    promptPayload: capture.promptPayload,
    workingMemory: capture.workingMemory,
    repairState: capture.repairState,
    summary,
  };
}

async function runReplayAudit(caseIds: ReplayCaseId[]): Promise<AuditReport> {
  const cases: AuditCaseResult[] = [];
  for (const caseId of caseIds) {
    cases.push(await runReplayCase(CASES[caseId]));
  }
  return {
    kind: "text_replay_audit",
    syntheticOnly: true,
    caseCount: cases.length,
    warnCount: cases.filter((entry) => entry.summary.status === "warn").length,
    cases,
  };
}

function renderReplayAuditReport(report: AuditReport): string {
  const ok = report.warnCount === 0;
  const lines: string[] = [
    `Text Replay Audit: ${ok ? "PASS" : "WARN"}`,
    "Scope: synthetic-only prompt capture over routeMessage; no DB, no LLM judge.",
    `Cases: ${report.caseCount}`,
    `Warnings: ${report.warnCount}`,
  ];

  for (const entry of report.cases) {
    lines.push(`- [${entry.summary.status.toUpperCase()}] ${entry.id} | ${entry.label}`);
    lines.push(`  goal: ${entry.goal}`);
    lines.push(`  userMessage: ${entry.userMessage}`);
    lines.push(
      `  promptPayload: memoryKeys=[${entry.promptPayload.memoryKeys.join(", ")}] | strategyHints=${summarizeText(entry.promptPayload.strategyHints, 120) || "(empty)"} | currentContext=${summarizeText(entry.promptPayload.currentContext, 120) || "(empty)"} | slowBrainContext=${summarizeText(entry.promptPayload.slowBrainContext, 120) || "(empty)"}`,
    );
    lines.push(`  workingMemory: ${entry.workingMemory ? JSON.stringify(entry.workingMemory) : "null"}`);
    lines.push(`  repairState: ${entry.repairState ? JSON.stringify(entry.repairState) : "null"}`);
    lines.push(`  auditSummary: ${entry.summary.line}`);
    for (const note of entry.summary.notes) {
      lines.push(`    - ${note}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function buildJsonReport(report: AuditReport): AuditReport {
  return report;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const report = await runReplayAudit(args.caseIds);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(buildJsonReport(report), null, 2)}\n`);
    return;
  }
  process.stdout.write(renderReplayAuditReport(report));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[text_replay_audit] failed:", (err as Error).message);
    process.exitCode = 1;
  });
}

export {
  CASES,
  parseArgs,
  runReplayCase,
  runReplayAudit,
  renderReplayAuditReport,
  buildJsonReport,
};
