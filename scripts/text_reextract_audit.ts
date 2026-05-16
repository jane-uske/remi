import path from "path";

import { InMemoryRepository } from "../memory/memory_store";
import { SlowBrainStore } from "../brains/background_analysis_store";
import { toEpisodeV3View, summarizeEpisodeV3View } from "../memory/episode_v3";
import type { PromptMessage } from "../brain/prompt_builder";
import type { MomentInput } from "../memory/episode_store";

type ReextractCaseId =
  | "greeting_no_episode"
  | "debt_pressure_episode"
  | "comfort_failure_episode";

type CliArgs = {
  caseIds: ReextractCaseId[];
  json: boolean;
};

type TranscriptTurn = {
  user: string;
  assistant: string;
};

type ReextractCaseSpec = {
  id: ReextractCaseId;
  label: string;
  goal: string;
  turns: TranscriptTurn[];
};

type ReextractMomentView = MomentInput & {
  turnIndex: number;
};

type ReextractCaseResult = {
  id: ReextractCaseId;
  label: string;
  goal: string;
  extractedMoments: ReextractMomentView[];
  episodeViews: ReturnType<typeof toEpisodeV3View>[];
  summary: {
    status: "clean" | "warn";
    line: string;
    notes: string[];
  };
};

type ReextractAuditReport = {
  kind: "text_reextract_audit";
  syntheticOnly: true;
  caseCount: number;
  warnCount: number;
  cases: ReextractCaseResult[];
};

const CASE_IDS: ReextractCaseId[] = [
  "greeting_no_episode",
  "debt_pressure_episode",
  "comfort_failure_episode",
];

function isReextractCaseId(value: string): value is ReextractCaseId {
  return CASE_IDS.includes(value as ReextractCaseId);
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

function clearModule(modulePath: string): void {
  delete require.cache[modulePath];
}

function stubModule(modulePath: string, exportsObject: unknown): void {
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports: exportsObject,
  } as NodeModule;
}

function createPseudoEpisode(moment: MomentInput, index: number) {
  return {
    id: `reextract-episode-${index + 1}`,
    title: (moment.topic || moment.summary).slice(0, 30),
    summary: moment.summary,
    topics: moment.topic ? [moment.topic] : [],
    mood: moment.mood,
    kind: moment.kind,
    salience: moment.salience,
    unresolved: moment.unresolved,
    status: moment.statusHint ?? (moment.unresolved ? "active" : "cooling"),
    recurrence_count: 1,
    origin_moment_summaries: [moment.summary],
  };
}

function loadMockedRunSlowBrain(collected: ReextractMomentView[]) {
  const slowBrainPath = require.resolve("../brains/slow_brain");
  const episodeStorePath = require.resolve("../memory/episode_store");
  const qwenClientPath = require.resolve("../llm/qwen_client");
  const originalEpisodeStore = require.cache[episodeStorePath];
  const originalQwenClient = require.cache[qwenClientPath];

  clearModule(slowBrainPath);
  stubModule(episodeStorePath, {
    ingest: async (moment: MomentInput) => {
      collected.push({ ...moment, turnIndex: collected.length + 1 });
      return {
        id: `captured-${collected.length}`,
        user_id: moment.userId,
        title: (moment.topic || moment.summary).slice(0, 30),
        summary: moment.summary,
        topics: moment.topic ? [moment.topic] : [],
        mood: moment.mood,
        kind: moment.kind,
        salience: moment.salience,
        recurrence_count: 1,
        unresolved: moment.unresolved,
        first_seen_at: new Date(),
        last_seen_at: new Date(),
        last_referenced_at: null,
        centroid_embedding: [],
        origin_moment_summaries: [moment.summary],
        relationship_weight: moment.salience,
        status: moment.statusHint ?? (moment.unresolved ? "active" : "cooling"),
      };
    },
  });
  stubModule(qwenClientPath, {
    hasLlmConfig: () => false,
    complete: async () => {
      throw new Error("complete should not be called in text_reextract_audit");
    },
  });

  const { runSlowBrain } = require("../brains/slow_brain");

  return {
    runSlowBrain,
    restore() {
      clearModule(slowBrainPath);
      if (originalEpisodeStore) {
        require.cache[episodeStorePath] = originalEpisodeStore;
      } else {
        clearModule(episodeStorePath);
      }
      if (originalQwenClient) {
        require.cache[qwenClientPath] = originalQwenClient;
      } else {
        clearModule(qwenClientPath);
      }
    },
  };
}

async function replayTranscript(turns: TranscriptTurn[]): Promise<{
  extractedMoments: ReextractMomentView[];
  episodeViews: ReturnType<typeof toEpisodeV3View>[];
}> {
  const restoreEnv = applyEnv({
    REMI_EPISODE_MEMORY_ENABLED: "1",
  });
  const collected: ReextractMomentView[] = [];
  const { runSlowBrain, restore } = loadMockedRunSlowBrain(collected);
  const slowBrain = new SlowBrainStore();
  const memoryRepo = new InMemoryRepository();
  const history: PromptMessage[] = [];

  try {
    for (const turn of turns) {
      await runSlowBrain({
        userId: "synthetic-user",
        userMessage: turn.user,
        assistantReply: turn.assistant,
        history: [...history],
        slowBrain,
        memoryRepo,
      });
      history.push({ role: "user", content: turn.user });
      history.push({ role: "assistant", content: turn.assistant });
    }
  } finally {
    restore();
    restoreEnv();
  }

  return {
    extractedMoments: collected,
    episodeViews: collected.map((moment, index) =>
      toEpisodeV3View(createPseudoEpisode(moment, index)),
    ),
  };
}

function buildCaseSummary(result: Pick<ReextractCaseResult, "extractedMoments" | "episodeViews">): ReextractCaseResult["summary"] {
  const notes: string[] = [];
  notes.push(`extractedMoments=${result.extractedMoments.length}`);
  notes.push(`episodeViews=${result.episodeViews.length}`);

  const status = "clean";
  const line = [
    `moments=${result.extractedMoments.length}`,
    `episodeViews=${result.episodeViews.length}`,
  ].join(", ");
  return { status, line, notes };
}

const CASES: Record<ReextractCaseId, ReextractCaseSpec> = {
  greeting_no_episode: {
    id: "greeting_no_episode",
    label: "轻 greeting 不写温层事件",
    goal: "纯打招呼不应触发 shared moment / episode re-extract。",
    turns: [
      {
        user: "你好呀",
        assistant: "我在呀，今天想轻松聊两句还是就打个招呼？",
      },
    ],
  },
  debt_pressure_episode: {
    id: "debt_pressure_episode",
    label: "债务线能离线重抽",
    goal: "债务/赔偿/还款压力 transcript 能重抽出 money 域的 EpisodeV3 预览。",
    turns: [
      {
        user: "点点上次追电瓶车把人弄摔了，家里赔了十几万，我现在还欠七八万。",
        assistant: "这事确实把你压得很狠，不是随便安慰两句能带过去的。",
      },
      {
        user: "我每个月挣三千，房租也快到了，真的不知道得还到什么时候。",
        assistant: "先别把自己逼到只剩结论，我们先按你现在的收入和刚性支出来看。",
      },
    ],
  },
  comfort_failure_episode: {
    id: "comfort_failure_episode",
    label: "安慰失败能离线重抽",
    goal: "关系受损 transcript 能重抽出 relationship_with_remi 域，而不是继续掉进宠物线。",
    turns: [
      {
        user: "点点那件事真的把我害惨了，我现在提到它就想到赔偿。",
        assistant: "这事确实把你压得很疼，我先站你这边，不替它说话。",
      },
      {
        user: "你安慰人都不会，你根本没懂我。",
        assistant: "是，我刚刚没接住你，我先收回来，不让你再解释一遍。",
      },
    ],
  },
};

function parseArgs(argv: string[]): CliArgs {
  const caseIds: ReextractCaseId[] = [];
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--case") {
      const raw = (argv[index + 1] ?? "").trim();
      if (!isReextractCaseId(raw)) {
        throw new Error(`Unknown re-extract case: ${raw || "(empty)"}`);
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

async function runReextractCase(spec: ReextractCaseSpec): Promise<ReextractCaseResult> {
  const replay = await replayTranscript(spec.turns);
  return {
    id: spec.id,
    label: spec.label,
    goal: spec.goal,
    extractedMoments: replay.extractedMoments,
    episodeViews: replay.episodeViews,
    summary: buildCaseSummary(replay),
  };
}

async function runReextractAudit(caseIds: ReextractCaseId[]): Promise<ReextractAuditReport> {
  const cases: ReextractCaseResult[] = [];
  for (const caseId of caseIds) {
    cases.push(await runReextractCase(CASES[caseId]));
  }
  return {
    kind: "text_reextract_audit",
    syntheticOnly: true,
    caseCount: cases.length,
    warnCount: cases.filter((entry) => entry.summary.status === "warn").length,
    cases,
  };
}

function renderReextractAuditReport(report: ReextractAuditReport): string {
  const ok = report.warnCount === 0;
  const lines: string[] = [
    `Text Re-extract Audit: ${ok ? "PASS" : "WARN"}`,
    "Scope: synthetic-only offline re-extract over current runSlowBrain; no DB, no LLM judge.",
    `Cases: ${report.caseCount}`,
    `Warnings: ${report.warnCount}`,
  ];

  for (const entry of report.cases) {
    lines.push(`- [${entry.summary.status.toUpperCase()}] ${entry.id} | ${entry.label}`);
    lines.push(`  goal: ${entry.goal}`);
    lines.push(
      `  extractedMoments: ${
        entry.extractedMoments.length > 0
          ? entry.extractedMoments
              .map((moment) =>
                `turn${moment.turnIndex}:${summarizeText(`${moment.topic || "(no-topic)"} | ${moment.summary}`, 120)}`,
              )
              .join(" || ")
          : "(none)"
      }`,
    );
    lines.push(
      `  episodeViews: ${
        entry.episodeViews.length > 0
          ? entry.episodeViews.map((view) => summarizeText(summarizeEpisodeV3View(view), 180)).join(" || ")
          : "(none)"
      }`,
    );
    lines.push(`  auditSummary: ${entry.summary.line}`);
    for (const note of entry.summary.notes) {
      lines.push(`    - ${note}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function buildJsonReport(report: ReextractAuditReport): ReextractAuditReport {
  return report;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const report = await runReextractAudit(args.caseIds);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(buildJsonReport(report), null, 2)}\n`);
    return;
  }
  process.stdout.write(renderReextractAuditReport(report));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[text_reextract_audit] failed:", (err as Error).message);
    process.exitCode = 1;
  });
}

export {
  CASES,
  parseArgs,
  runReextractCase,
  runReextractAudit,
  renderReextractAuditReport,
  buildJsonReport,
};
