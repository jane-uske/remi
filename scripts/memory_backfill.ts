// ── Memory Backfill ─────────────────────────────────────────────────────────
// 离线重放历史会话，把早期未被慢脑消化的对话炼成 episodes + KV facts。
//
// 复用现有慢脑管线（brains/background_analysis.runSlowBrain，真实本地 LLM），
// 通过 require.cache 注入拦截 episode_store.ingest：
//   - dry-run：收集 moments，做只读 merge/create 预测（embed + findSimilarEpisodes
//     只查不写 + 内存虚拟 episode 集），facts 进 InMemoryRepository —— 全程零写库。
//   - apply：moments 转发到真实 ingest 并带上该批消息的真实时间范围
//     （IngestTimestamps），facts 走 PgMemoryRepository（(user_id,key) 唯一键幂等）。
//
// 明确不回放（两种模式都不写）：
//   - 关系数值 familiarity/turnCount/emotionalBond、moodTrajectory、
//     conversationSummary（REMI_RELATIONSHIP_STATE_ENABLED=0 强制关闭持久化；
//     SlowBrainStore 为一次性内存实例，跑完即弃）
//   - project memory（REMI_PROJECT_MEMORY_ENABLED=0）
//   - 冷层 text archive ledger（REMI_TEXT_ARCHIVE_LEDGER_ENABLED=0）
//
// 用法（必须显式二选一 --dry-run / --apply，防止误写）：
//   node -r ts-node/register/transpile-only scripts/memory_backfill.ts \
//     --user <uuid> --dry-run [--since 2026-05-31] [--until 2026-06-19] \
//     [--chunk-size 30] [--max-sessions N] [--sessions id1,id2] [--json]
//
// 环境：脚本自己 loadEnvFile()（默认 .env.localhost，可用 DOTENV_CONFIG_PATH 覆盖），
// 与线上服务只共享 LM Studio（串行、单请求在飞，低压）。

import { loadEnvFile } from "../server/config/load_env";
import { resetConfig } from "../server/config";
import {
  initDatabase,
  closeDatabase,
  query,
} from "../storage/database";
import { getSessionMessages } from "../storage/repositories/message_repository";
import {
  findSimilarEpisodes,
  type DbEpisode,
} from "../storage/repositories/episode_repository";
import {
  ingest as realIngest,
  cosineSimilarity,
  type IngestTimestamps,
  type MomentInput,
} from "../memory/episode_store";
import { InMemoryRepository } from "../memory/memory_store";
import { SlowBrainStore } from "../brains/background_analysis_store";
import { isLightAcknowledgementTurn } from "../memory/prompt_memory_support";
import { embed, checkEmbeddingHealth } from "../llm/embedding_client";
import { hasLlmConfig } from "../llm/qwen_client";
import type { PromptMessage } from "../brain/prompt_builder";
import type { DbMessage } from "../storage/types";
import type {
  MemoryRepository,
  MemoryEntry,
  UpsertOptions,
} from "../memory/memory_repository";

// ── 常量 ──

const MERGE_THRESHOLD = 0.85; // 与 memory/episode_store.ts 保持一致（预测用）
const CHUNK_LLM_TIMEOUT_MS = 180_000;
const DEFAULT_CHUNK_SIZE = 30;

/** 指示性时间词（存进永久记忆会随时间腐坏的表达） */
const STRONG_DEICTIC_RE =
  /今天|明天|昨天|后天|前天|今晚|明晚|昨晚|今早|明早|今夜|凌晨|待会儿?|一会儿?|回头再?|马上|等下|等会儿?|现在|此刻|刚才|刚刚|周[一二三四五六日天]|礼拜[一二三四五六日天]|下+周|这周|本周|上+周|下个?月|这个?月|本月|月底|年底|今年|明年|这几天|这两天/u;

const QUOTED_SPAN_RE = /「[^」]{4,}」/u;

// ── CLI ──

type CliArgs = {
  userId: string;
  since: Date | null;
  until: Date | null;
  mode: "dry-run" | "apply";
  json: boolean;
  chunkSize: number;
  maxSessions: number | null;
  sessionFilter: Set<string> | null;
};

function usage(): string {
  return [
    "Usage: node -r ts-node/register/transpile-only scripts/memory_backfill.ts",
    "  --user <uuid>            (required)",
    "  --dry-run | --apply      (exactly one required; dry-run never writes)",
    "  [--since <ISO date>]     inclusive lower bound on message time (UTC)",
    "  [--until <ISO date>]     exclusive upper bound on message time (UTC)",
    "  [--chunk-size <n>]       messages per analysis batch (default 30)",
    "  [--max-sessions <n>]     stop after N sessions (testing)",
    "  [--sessions <id,id>]     only these session ids (rerun failed batches)",
    "  [--json]                 machine-readable report on stdout",
  ].join("\n");
}

function parseIsoDate(raw: string, flag: string): Date {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`${flag} is not a valid ISO date: ${raw}\n${usage()}`);
  }
  return d;
}

function parseArgs(argv: string[]): CliArgs {
  let userId = "";
  let since: Date | null = null;
  let until: Date | null = null;
  let dryRun = false;
  let apply = false;
  let json = false;
  let chunkSize = DEFAULT_CHUNK_SIZE;
  let maxSessions: number | null = null;
  let sessionFilter: Set<string> | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--user" || arg === "--user-id") {
      userId = (argv[i + 1] ?? "").trim();
      i += 1;
    } else if (arg === "--since") {
      since = parseIsoDate((argv[i + 1] ?? "").trim(), "--since");
      i += 1;
    } else if (arg === "--until") {
      until = parseIsoDate((argv[i + 1] ?? "").trim(), "--until");
      i += 1;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--apply") {
      apply = true;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--chunk-size") {
      const n = Number(argv[i + 1]);
      if (Number.isFinite(n) && n >= 4) chunkSize = Math.floor(n);
      i += 1;
    } else if (arg === "--max-sessions") {
      const n = Number(argv[i + 1]);
      if (Number.isFinite(n) && n > 0) maxSessions = Math.floor(n);
      i += 1;
    } else if (arg === "--sessions") {
      const ids = (argv[i + 1] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (ids.length > 0) sessionFilter = new Set(ids);
      i += 1;
    }
  }

  if (!userId) throw new Error(`--user is required\n${usage()}`);
  if (dryRun === apply) {
    throw new Error(`exactly one of --dry-run / --apply is required\n${usage()}`);
  }
  return {
    userId,
    since,
    until,
    mode: dryRun ? "dry-run" : "apply",
    json,
    chunkSize,
    maxSessions,
    sessionFilter,
  };
}

// ── 质量标记 ──

function momentQualityFlags(
  moment: MomentInput,
  storedSummaryPreview: string,
): string[] {
  const flags: string[] = [];
  if (QUOTED_SPAN_RE.test(moment.summary)) flags.push("bare_quote");
  if (
    moment.topic &&
    storedSummaryPreview.startsWith(`${moment.topic}：${moment.topic}：`)
  ) {
    flags.push("double_topic_prefix");
  }
  if (STRONG_DEICTIC_RE.test(moment.summary)) flags.push("deictic_time");
  if (moment.topic && (moment.topic || moment.summary).slice(0, 30) === moment.topic) {
    flags.push("topic_only_title");
  }
  return flags;
}

function factQualityFlags(key: string, value: string): string[] {
  const flags: string[] = [];
  if (STRONG_DEICTIC_RE.test(value)) flags.push("deictic_time_value");
  if (STRONG_DEICTIC_RE.test(key)) flags.push("deictic_time_key");
  return flags;
}

// ── 记录仓库包装（观察 facts 写入，不改变行为） ──

type FactEvent = {
  key: string;
  value: string;
  importance: number;
};

class RecordingMemoryRepo implements MemoryRepository {
  constructor(
    private readonly inner: MemoryRepository,
    private readonly onUpsert: (event: FactEvent) => void,
  ) {}

  async upsert(
    key: string,
    value: string,
    importance?: number,
    options?: UpsertOptions,
  ): Promise<void> {
    this.onUpsert({ key, value, importance: importance ?? 0.5 });
    return this.inner.upsert(key, value, importance, options);
  }

  getAll(): Promise<MemoryEntry[]> {
    return this.inner.getAll();
  }
  getByKey(key: string): Promise<MemoryEntry | null> {
    return this.inner.getByKey(key);
  }
  delete(key: string): Promise<void> {
    return this.inner.delete(key);
  }
  touch(key: string): Promise<void> {
    return this.inner.touch(key);
  }
  getStale(maxAge: number, minImportance: number): Promise<MemoryEntry[]> {
    return this.inner.getStale(maxAge, minImportance);
  }
}

// ── runSlowBrain 加载（拦截 episode_store.ingest） ──

type IngestInterceptor = (moment: MomentInput) => Promise<DbEpisode>;

function loadPatchedRunSlowBrain(interceptor: IngestInterceptor): {
  runSlowBrain: (input: unknown) => Promise<void>;
  restore: () => void;
} {
  const backgroundAnalysisPath = require.resolve("../brains/background_analysis");
  const episodeStorePath = require.resolve("../memory/episode_store");

  // 确保原模块已加载，保留其余导出（类型之外还有 findRelevant 等被别处引用）
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const originalExports = require(episodeStorePath);
  const originalCacheEntry = require.cache[episodeStorePath];

  delete require.cache[backgroundAnalysisPath];
  require.cache[episodeStorePath] = {
    id: episodeStorePath,
    filename: episodeStorePath,
    loaded: true,
    exports: { ...originalExports, ingest: interceptor },
  } as NodeModule;

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { runSlowBrain } = require(backgroundAnalysisPath);

  return {
    runSlowBrain,
    restore() {
      delete require.cache[backgroundAnalysisPath];
      if (originalCacheEntry) {
        require.cache[episodeStorePath] = originalCacheEntry;
      } else {
        delete require.cache[episodeStorePath];
      }
    },
  };
}

// ── 数据读取 ──

type SessionRow = {
  id: string;
  firstMsgAt: Date;
  lastMsgAt: Date;
  msgCount: number;
};

async function listSessionsWithMessages(
  userId: string,
  since: Date | null,
  until: Date | null,
): Promise<SessionRow[]> {
  const res = await query(
    `SELECT s.id,
            min(m.created_at) AS first_msg_at,
            max(m.created_at) AS last_msg_at,
            count(*)::int AS msg_count
     FROM sessions s
     JOIN messages m ON m.session_id = s.id
     WHERE s.user_id = $1
       AND ($2::timestamptz IS NULL OR m.created_at >= $2)
       AND ($3::timestamptz IS NULL OR m.created_at < $3)
     GROUP BY s.id
     ORDER BY min(m.created_at) ASC`,
    [userId, since, until],
  );
  return res.rows.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: row.id as string,
      firstMsgAt: row.first_msg_at as Date,
      lastMsgAt: row.last_msg_at as Date,
      msgCount: Number(row.msg_count),
    };
  });
}

async function loadExistingMemories(userId: string): Promise<Map<string, string>> {
  const res = await query(
    `SELECT key, value FROM memories WHERE user_id = $1`,
    [userId],
  );
  const map = new Map<string, string>();
  for (const r of res.rows) {
    const row = r as Record<string, unknown>;
    map.set(row.key as string, row.value as string);
  }
  return map;
}

// ── 分块与焦点轮选择 ──

type Turn = { user: DbMessage; assistant: DbMessage };

type Chunk = {
  sessionId: string;
  chunkIndex: number;
  messages: DbMessage[];
  firstAt: Date;
  lastAt: Date;
  focal: Turn | null;
  focalIsLight: boolean;
};

function buildTurns(messages: DbMessage[]): Turn[] {
  const turns: Turn[] = [];
  let pendingUser: DbMessage | null = null;
  for (const msg of messages) {
    if (msg.role === "user") {
      pendingUser = msg; // 连续多条 user 取最后一条
    } else if (msg.role === "assistant" && pendingUser) {
      turns.push({ user: pendingUser, assistant: msg });
      pendingUser = null;
    }
  }
  return turns;
}

function isMeaningfulUserMessage(content: string): boolean {
  const trimmed = content.trim();
  return trimmed.length >= 8 && !isLightAcknowledgementTurn(trimmed);
}

function chunkSession(
  sessionId: string,
  messages: DbMessage[],
  chunkSize: number,
): Chunk[] {
  const chunks: Chunk[] = [];
  for (let start = 0; start < messages.length; start += chunkSize) {
    const slice = messages.slice(start, start + chunkSize);
    const turns = buildTurns(slice);
    let focal: Turn | null = null;
    let focalIsLight = false;
    for (let t = turns.length - 1; t >= 0; t -= 1) {
      if (isMeaningfulUserMessage(turns[t].user.content)) {
        focal = turns[t];
        break;
      }
    }
    if (!focal && turns.length > 0) {
      focal = turns[turns.length - 1];
      focalIsLight = true;
    }
    chunks.push({
      sessionId,
      chunkIndex: chunks.length,
      messages: slice,
      firstAt: slice[0].created_at,
      lastAt: slice[slice.length - 1].created_at,
      focal,
      focalIsLight,
    });
  }
  return chunks;
}

// ── dry-run 虚拟 episode 集（merge/create 预测，含本次运行内互并） ──

type VirtualEpisode = {
  title: string;
  topics: string[];
  centroid: number[];
  count: number;
  momentCount: number;
  firstAt: Date;
  lastAt: Date;
};

type MergePrediction = {
  action: "merge_db" | "merge_virtual" | "create" | "unknown";
  targetTitle?: string;
  cosine?: number;
  note?: string;
};

function buildEmbeddingTextLike(moment: MomentInput): string {
  return [moment.summary, moment.topic, moment.mood]
    .map((p) => p.trim())
    .filter(Boolean)
    .join(" ");
}

function updateCentroid(
  centroid: number[],
  count: number,
  vec: number[],
): number[] {
  const dims = Math.max(centroid.length, vec.length);
  const next: number[] = [];
  for (let i = 0; i < dims; i += 1) {
    next.push((((centroid[i] ?? 0) * count) + (vec[i] ?? 0)) / (count + 1));
  }
  return next;
}

class DryRunEpisodePredictor {
  private virtual: VirtualEpisode[] = [];

  constructor(private readonly userId: string) {}

  get virtualEpisodes(): VirtualEpisode[] {
    return this.virtual;
  }

  async predict(moment: MomentInput, chunk: Chunk): Promise<MergePrediction> {
    let momentEmbedding: number[];
    try {
      momentEmbedding = await embed(buildEmbeddingTextLike(moment));
    } catch (err) {
      return {
        action: "unknown",
        note: `embed failed: ${(err as Error).message}`,
      };
    }

    let best: { kind: "db" | "virtual"; title: string; cosine: number; index: number } | null =
      null;

    try {
      const dbSimilar = await findSimilarEpisodes(this.userId, momentEmbedding, 3);
      for (const ep of dbSimilar) {
        const c = cosineSimilarity(momentEmbedding, ep.centroid_embedding);
        if (!best || c > best.cosine) {
          best = { kind: "db", title: ep.title, cosine: c, index: -1 };
        }
      }
    } catch (err) {
      return {
        action: "unknown",
        note: `findSimilarEpisodes failed: ${(err as Error).message}`,
      };
    }

    for (let i = 0; i < this.virtual.length; i += 1) {
      const v = this.virtual[i];
      const c = cosineSimilarity(momentEmbedding, v.centroid);
      if (!best || c > best.cosine) {
        best = { kind: "virtual", title: v.title, cosine: c, index: i };
      }
    }

    if (best && best.cosine >= MERGE_THRESHOLD) {
      if (best.kind === "virtual") {
        const v = this.virtual[best.index];
        v.centroid = updateCentroid(v.centroid, v.momentCount, momentEmbedding);
        v.momentCount += 1;
        if (moment.topic && !v.topics.includes(moment.topic)) v.topics.push(moment.topic);
        if (chunk.firstAt < v.firstAt) v.firstAt = chunk.firstAt;
        if (chunk.lastAt > v.lastAt) v.lastAt = chunk.lastAt;
        return { action: "merge_virtual", targetTitle: v.title, cosine: best.cosine };
      }
      return { action: "merge_db", targetTitle: best.title, cosine: best.cosine };
    }

    this.virtual.push({
      title: (moment.topic || moment.summary).slice(0, 30),
      topics: moment.topic ? [moment.topic] : [],
      centroid: momentEmbedding,
      count: 1,
      momentCount: 1,
      firstAt: chunk.firstAt,
      lastAt: chunk.lastAt,
    });
    return {
      action: "create",
      cosine: best?.cosine,
      targetTitle: best?.title,
    };
  }
}

// ── 结果模型 ──

type MomentPreview = {
  sessionId: string;
  chunkIndex: number;
  firstAt: string;
  lastAt: string;
  focalUser: string;
  moment: {
    summary: string;
    topic: string;
    mood: string;
    kind: string;
    salience: number;
    unresolved: boolean;
    statusHint?: string;
  };
  storedTitlePreview: string;
  storedSummaryPreview: string;
  predicted: MergePrediction;
  qualityFlags: string[];
};

type FactPreview = {
  sessionId: string;
  chunkIndex: number;
  key: string;
  value: string;
  importance: number;
  dbState: "db_new" | "db_would_overwrite" | "db_same" | "run_overwrite";
  dbCurrentValue?: string;
  qualityFlags: string[];
};

type SessionResult = {
  sessionId: string;
  firstMsgAt: string;
  msgCount: number;
  chunkCount: number;
  momentCount: number;
  factCount: number;
  merged: number;
  created: number;
  skippedChunks: number;
  durationMs: number;
};

type FailedChunk = {
  sessionId: string;
  chunkIndex: number;
  firstAt: string;
  lastAt: string;
  error: string;
};

type BackfillReport = {
  kind: "memory_backfill";
  mode: "dry-run" | "apply";
  envFile: string;
  llmConfigured: boolean;
  embeddingStatus: string;
  userId: string;
  since: string | null;
  until: string | null;
  chunkSize: number;
  sessionsProcessed: number;
  chunksProcessed: number;
  chunksSkipped: number;
  momentsExtracted: number;
  factsExtracted: number;
  episodesMerged: number;
  episodesCreated: number;
  failedChunks: FailedChunk[];
  durationMs: number;
  sessions: SessionResult[];
  moments: MomentPreview[];
  facts: FactPreview[];
  qualityStats: Record<string, number>;
};

function clip(text: string, max: number): string {
  const compact = text.trim().replace(/\s+/g, " ");
  return compact.length <= max ? compact : `${compact.slice(0, max - 1)}…`;
}

// ── 主流程 ──

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const isJson = args.json;
  const progress = (line: string) => {
    if (isJson) process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  };

  // 1. 环境：先加载 env 文件，再打回填安全开关，再让 config 重新校验。
  const envFile = loadEnvFile();
  process.env.REMI_EPISODE_MEMORY_ENABLED = "1"; // moment 记录必须开
  process.env.REMI_RELATIONSHIP_STATE_ENABLED = "0"; // 不回放关系数值
  process.env.REMI_PROJECT_MEMORY_ENABLED = "0"; // 不回放 project memory
  process.env.REMI_TEXT_ARCHIVE_LEDGER_ENABLED = "0"; // 不污染冷层 ledger
  resetConfig();

  const llmConfigured = hasLlmConfig();
  const embeddingHealth = await checkEmbeddingHealth();

  progress(`[memory_backfill] mode=${args.mode} env=${envFile}`);
  progress(
    `[memory_backfill] llmConfigured=${llmConfigured} embedding=${embeddingHealth.status}`,
  );
  if (!llmConfigured) {
    progress(
      "[memory_backfill] WARN: LLM 未配置，深度分析将被跳过，仅本地启发式（facts 将为空）",
    );
  }
  if (args.mode === "apply") {
    progress("[memory_backfill] *** APPLY MODE: 将写入 episodes + memories ***");
  }

  await initDatabase();

  const t0 = Date.now();
  const report: BackfillReport = {
    kind: "memory_backfill",
    mode: args.mode,
    envFile,
    llmConfigured,
    embeddingStatus: embeddingHealth.status,
    userId: args.userId,
    since: args.since ? args.since.toISOString() : null,
    until: args.until ? args.until.toISOString() : null,
    chunkSize: args.chunkSize,
    sessionsProcessed: 0,
    chunksProcessed: 0,
    chunksSkipped: 0,
    momentsExtracted: 0,
    factsExtracted: 0,
    episodesMerged: 0,
    episodesCreated: 0,
    failedChunks: [],
    durationMs: 0,
    sessions: [],
    moments: [],
    facts: [],
    qualityStats: {},
  };
  const bumpQuality = (flag: string) => {
    report.qualityStats[flag] = (report.qualityStats[flag] ?? 0) + 1;
  };

  try {
    let sessions = await listSessionsWithMessages(args.userId, args.since, args.until);
    if (args.sessionFilter) {
      sessions = sessions.filter((s) => args.sessionFilter!.has(s.id));
    }
    if (args.maxSessions !== null) {
      sessions = sessions.slice(0, args.maxSessions);
    }
    progress(
      `[memory_backfill] user=${args.userId} sessions=${sessions.length} range=[${
        report.since ?? "-∞"
      }, ${report.until ?? "+∞"})`,
    );

    const existingMemories = args.mode === "dry-run"
      ? await loadExistingMemories(args.userId)
      : new Map<string, string>();
    const runSeenFactKeys = new Set<string>();
    const predictor = args.mode === "dry-run" ? new DryRunEpisodePredictor(args.userId) : null;

    // apply 模式的持久化 facts 仓库（懒加载，避免 dry-run 无谓加载）
    let pgRepo: MemoryRepository | null = null;
    if (args.mode === "apply") {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { PgMemoryRepository } = require("../storage/repositories/pg_memory_repository");
      pgRepo = new PgMemoryRepository(args.userId);
    }

    for (let si = 0; si < sessions.length; si += 1) {
      const session = sessions[si];
      const sessionStart = Date.now();
      const sessionStore = new SlowBrainStore();

      let allMessages = await getSessionMessages(session.id);
      allMessages = allMessages.filter(
        (m) =>
          (m.role === "user" || m.role === "assistant") &&
          (!args.since || m.created_at >= args.since) &&
          (!args.until || m.created_at < args.until),
      );
      if (allMessages.length === 0) {
        continue;
      }
      const chunks = chunkSession(session.id, allMessages, args.chunkSize);

      const sessionResult: SessionResult = {
        sessionId: session.id,
        firstMsgAt: session.firstMsgAt.toISOString(),
        msgCount: allMessages.length,
        chunkCount: chunks.length,
        momentCount: 0,
        factCount: 0,
        merged: 0,
        created: 0,
        skippedChunks: 0,
        durationMs: 0,
      };

      for (const chunk of chunks) {
        if (!chunk.focal) {
          sessionResult.skippedChunks += 1;
          report.chunksSkipped += 1;
          continue;
        }

        const chunkFacts: FactEvent[] = [];
        const chunkMoments: MomentPreview[] = [];

        const interceptor: IngestInterceptor = async (moment) => {
          const storedTitlePreview = (moment.topic || moment.summary).slice(0, 30);
          const storedSummaryPreview = moment.topic
            ? `${moment.topic}：${moment.summary}`
            : moment.summary;

          let predicted: MergePrediction;
          let stored: DbEpisode | null = null;
          if (args.mode === "dry-run") {
            predicted = await predictor!.predict(moment, chunk);
          } else {
            stored = await realIngest(moment, {
              firstSeenAt: chunk.firstAt,
              lastSeenAt: chunk.lastAt,
            } satisfies IngestTimestamps);
            predicted = {
              action: stored.recurrence_count > 1 ? "merge_db" : "create",
              targetTitle: stored.title,
            };
          }

          if (predicted.action === "create") {
            sessionResult.created += 1;
            report.episodesCreated += 1;
          } else if (predicted.action !== "unknown") {
            sessionResult.merged += 1;
            report.episodesMerged += 1;
          }

          const flags = momentQualityFlags(moment, storedSummaryPreview);
          for (const f of flags) bumpQuality(f);

          chunkMoments.push({
            sessionId: chunk.sessionId,
            chunkIndex: chunk.chunkIndex,
            firstAt: chunk.firstAt.toISOString(),
            lastAt: chunk.lastAt.toISOString(),
            focalUser: clip(chunk.focal!.user.content, 80),
            moment: {
              summary: moment.summary,
              topic: moment.topic,
              mood: moment.mood,
              kind: moment.kind,
              salience: Number(moment.salience.toFixed(2)),
              unresolved: moment.unresolved,
              statusHint: moment.statusHint,
            },
            storedTitlePreview,
            storedSummaryPreview,
            predicted,
            qualityFlags: flags,
          });

          if (stored) return stored;
          // dry-run 伪返回（不落库），维持 runSlowBrain 后续流程
          return {
            id: `dryrun-${report.momentsExtracted + chunkMoments.length}`,
            user_id: moment.userId,
            title: storedTitlePreview,
            summary: storedSummaryPreview,
            topics: moment.topic ? [moment.topic] : [],
            mood: moment.mood,
            kind: moment.kind,
            salience: moment.salience,
            recurrence_count: 1,
            unresolved: moment.unresolved,
            first_seen_at: chunk.firstAt,
            last_seen_at: chunk.lastAt,
            last_referenced_at: null,
            centroid_embedding: [],
            origin_moment_summaries: [moment.summary],
            relationship_weight: moment.salience,
            status: moment.statusHint ?? (moment.unresolved ? "active" : "cooling"),
            v3_domain: null,
            v3_pressure_source: null,
            v3_relational_impact: null,
            v3_user_stance: null,
            v3_unresolved_level: null,
            v3_event_summary: null,
            v3_evidence_turns: [],
            v3_last_user_position: null,
          } as DbEpisode;
        };

        const innerRepo: MemoryRepository =
          args.mode === "dry-run" ? new InMemoryRepository() : pgRepo!;
        const recordingRepo = new RecordingMemoryRepo(innerRepo, (event) => {
          chunkFacts.push(event);
        });

        const { runSlowBrain, restore } = loadPatchedRunSlowBrain(interceptor);
        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), CHUNK_LLM_TIMEOUT_MS);
        try {
          const focalIdx = chunk.messages.indexOf(chunk.focal.user);
          const history: PromptMessage[] = chunk.messages
            .slice(0, focalIdx)
            .map((m) => ({ role: m.role, content: m.content }));

          await runSlowBrain({
            userId: args.userId,
            inputSource: "voice", // 规避 text-archive 记录路径（已双保险：flag 也关了）
            userMessage: chunk.focal.user.content,
            assistantReply: chunk.focal.assistant.content,
            history,
            slowBrain: sessionStore,
            memoryRepo: recordingRepo,
            relationshipRepo: null,
            signal: abort.signal,
            // 回放历史：观察日期锚到该批消息的事发当天，避免"明天/昨晚"按
            // 回填执行日换算、状态类事实标错日期（dry-run 实证过这个坑）。
            observationDateOverride: chunk.focal.user.created_at
              .toISOString()
              .slice(0, 10),
          });

          // 消费本 chunk 的产出
          for (const mp of chunkMoments) {
            report.moments.push(mp);
            report.momentsExtracted += 1;
            sessionResult.momentCount += 1;
          }
          for (const fe of chunkFacts) {
            const flags = factQualityFlags(fe.key, fe.value);
            for (const f of flags) bumpQuality(f);
            let dbState: FactPreview["dbState"];
            let dbCurrentValue: string | undefined;
            if (runSeenFactKeys.has(fe.key)) {
              dbState = "run_overwrite";
            } else if (existingMemories.has(fe.key)) {
              dbCurrentValue = existingMemories.get(fe.key);
              dbState = dbCurrentValue === fe.value ? "db_same" : "db_would_overwrite";
            } else {
              dbState = "db_new";
            }
            runSeenFactKeys.add(fe.key);
            report.facts.push({
              sessionId: chunk.sessionId,
              chunkIndex: chunk.chunkIndex,
              key: fe.key,
              value: fe.value,
              importance: fe.importance,
              dbState,
              dbCurrentValue,
              qualityFlags: flags,
            });
            report.factsExtracted += 1;
            sessionResult.factCount += 1;
          }
          report.chunksProcessed += 1;
        } catch (err) {
          report.failedChunks.push({
            sessionId: chunk.sessionId,
            chunkIndex: chunk.chunkIndex,
            firstAt: chunk.firstAt.toISOString(),
            lastAt: chunk.lastAt.toISOString(),
            error: (err as Error).message,
          });
        } finally {
          clearTimeout(timer);
          restore();
        }
      }

      sessionResult.durationMs = Date.now() - sessionStart;
      report.sessions.push(sessionResult);
      report.sessionsProcessed += 1;
      progress(
        `[${si + 1}/${sessions.length}] ${sessionResult.firstMsgAt.slice(0, 16)} ` +
          `session=${session.id.slice(0, 8)} msgs=${sessionResult.msgCount} ` +
          `chunks=${sessionResult.chunkCount} moments=${sessionResult.momentCount} ` +
          `facts=${sessionResult.factCount} merged=${sessionResult.merged} ` +
          `created=${sessionResult.created} ${(sessionResult.durationMs / 1000).toFixed(1)}s`,
      );
    }
  } finally {
    await closeDatabase().catch(() => {});
  }

  report.durationMs = Date.now() - t0;

  if (isJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  process.stdout.write(renderReport(report));
}

// ── 报告渲染 ──

function renderReport(report: BackfillReport): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(`# Memory Backfill Report (${report.mode})`);
  lines.push(`- env: ${report.envFile}`);
  lines.push(`- llmConfigured: ${report.llmConfigured}  embedding: ${report.embeddingStatus}`);
  lines.push(`- user: ${report.userId}`);
  lines.push(`- range: [${report.since ?? "-∞"}, ${report.until ?? "+∞"}) (UTC)`);
  lines.push(
    `- sessions=${report.sessionsProcessed} chunks=${report.chunksProcessed} ` +
      `skipped=${report.chunksSkipped} failed=${report.failedChunks.length} ` +
      `duration=${(report.durationMs / 1000).toFixed(1)}s`,
  );
  lines.push(
    `- moments=${report.momentsExtracted} facts=${report.factsExtracted} ` +
      `episodes: merged=${report.episodesMerged} created=${report.episodesCreated}` +
      (report.mode === "dry-run"
        ? "（预测值：仅余弦阈值 0.85 近似，未含 shouldMergeIntoExisting 锚点检查，真实合并率 ≤ 此值）"
        : ""),
  );

  lines.push("");
  lines.push("## Moments 预览");
  if (report.moments.length === 0) lines.push("(none)");
  for (let i = 0; i < report.moments.length; i += 1) {
    const m = report.moments[i];
    lines.push(
      `${i + 1}. [${m.firstAt.slice(0, 16)} ~ ${m.lastAt.slice(11, 16)}] ` +
        `session=${m.sessionId.slice(0, 8)}#${m.chunkIndex} ` +
        `topic=${m.moment.topic || "(无)"} kind=${m.moment.kind} mood=${m.moment.mood} ` +
        `salience=${m.moment.salience} unresolved=${m.moment.unresolved}`,
    );
    lines.push(`   focal: ${m.focalUser}`);
    lines.push(`   title: ${m.storedTitlePreview}`);
    lines.push(
      `   summary: ${m.storedSummaryPreview}` +
        (m.qualityFlags.length ? `   [${m.qualityFlags.join("][")}]` : ""),
    );
    const p = m.predicted;
    lines.push(
      `   predicted: ${p.action}` +
        (p.targetTitle ? ` → ${p.targetTitle}` : "") +
        (p.cosine !== undefined ? ` (cos=${p.cosine.toFixed(3)})` : "") +
        (p.note ? ` note=${p.note}` : ""),
    );
  }

  lines.push("");
  lines.push("## Facts 预览");
  if (report.facts.length === 0) lines.push("(none)");
  for (const f of report.facts) {
    lines.push(
      `- ${f.key} = ${clip(f.value, 60)}  (imp=${f.importance}, ${f.dbState}` +
        (f.dbCurrentValue !== undefined ? `, db="${clip(f.dbCurrentValue, 40)}"` : "") +
        `)` +
        (f.qualityFlags.length ? `  [${f.qualityFlags.join("][")}]` : "") +
        `  @${f.sessionId.slice(0, 8)}#${f.chunkIndex}`,
    );
  }

  lines.push("");
  lines.push("## 质量标记统计");
  const entries = Object.entries(report.qualityStats).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) lines.push("(none)");
  for (const [flag, count] of entries) {
    lines.push(`- ${flag}: ${count}`);
  }

  if (report.failedChunks.length > 0) {
    lines.push("");
    lines.push("## 失败批次（可用 --sessions 重跑）");
    for (const fc of report.failedChunks) {
      lines.push(
        `- session=${fc.sessionId} chunk=${fc.chunkIndex} [${fc.firstAt} ~ ${fc.lastAt}]: ${fc.error}`,
      );
    }
    const ids = Array.from(new Set(report.failedChunks.map((f) => f.sessionId)));
    lines.push(`  rerun: --sessions ${ids.join(",")}`);
  }

  lines.push("");
  return lines.join("\n");
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[memory_backfill] failed:", (err as Error).message);
    process.exitCode = 1;
  });
}

export { parseArgs, chunkSession, buildTurns, momentQualityFlags, factQualityFlags };
