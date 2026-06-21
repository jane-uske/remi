import { loadEnvFile } from "./config/load_env";
import { getConfig } from "./config";

const activeEnvFile = loadEnvFile();

// Validate environment at startup — fails fast with clear error
try {
  getConfig();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

// Warn loudly if embedding is not configured — memory system silently degrades
{
  const embeddingUrl =
    process.env.REMI_EMBEDDING_BASE_URL?.trim() ||
    process.env.REM_EMBEDDING_BASE_URL?.trim() ||
    process.env.EMBEDDING_BASE_URL?.trim();
  if (!embeddingUrl) {
    console.warn(
      "\n" +
      "╔══════════════════════════════════════════════════════════════╗\n" +
      "║  [WARN] REMI_EMBEDDING_BASE_URL 未配置                      ║\n" +
      "║                                                              ║\n" +
      "║  记忆系统的语义检索将不可用:                                  ║\n" +
      "║    - Episode 召回退化为关键词匹配                            ║\n" +
      "║    - 语义相似度搜索无法工作                                  ║\n" +
      "║    - Proactive prompt 无法按相关性排序                       ║\n" +
      "║                                                              ║\n" +
      "║  修复: 在 .env 中配置 Embedding (仅需 275MB 模型)            ║\n" +
      "║    REMI_EMBEDDING_API_KEY=ollama                             ║\n" +
      "║    REMI_EMBEDDING_BASE_URL=http://127.0.0.1:11434/v1        ║\n" +
      "║    REMI_EMBEDDING_MODEL=nomic-embed-text                    ║\n" +
      "║                                                              ║\n" +
      "║  详见: docs/guides/LOCAL_LLM.md                             ║\n" +
      "╚══════════════════════════════════════════════════════════════╝\n",
    );
  }
}

import type { WebSocket } from "ws";
import type { IncomingMessage } from "http";

import { createLogger } from "../infra/logger";
import { registerPlugin } from "../plugin/registry";
import type { RemiPlugin } from "../plugin/types";
import { setDbReady, setRedisReady } from "../infra/app_state";
import { startDecayTimer, stopDecayTimer } from "../memory/memory_decay";
import { getMemoryRepository, setMemoryRepository } from "../memory/memory_store";
import { initDatabase, closeDatabase } from "../storage/database";
import { ensureStorageSchema } from "../storage/schema_manager";
import { initRedis, closeRedis } from "../storage/redis";
import { ensureDevUser } from "../storage/repositories/dev_identity";
import { getPgMemoryRepository } from "../storage/repositories/pg_memory_repository";
import { shutdownWhisperServer, warmWhisperServer } from "../voice/stt_stream";
import { warmupEdgeTtsConnections } from "../voice/tts";
import { createGateway, startServer, PORT } from "./gateway";
import { createSession } from "./session";
import { SttStream } from "../voice/stt_stream";
import {
  collectMemorySnapshot,
  evaluateMemoryAlert,
  resolveResourceMonitorConfig,
  shouldEmitMemoryAlert,
  type MemoryAlertState,
} from "./resource_monitor";

const logger = createLogger("server");

// ── 全局错误兜底 ──────────────────────────────────────────────────────────
// 在此之前，任何未捕获的 Promise rejection / 异常都会让 Node 直接退出进程。
// 配合 docker `restart: unless-stopped`，单个请求的报错会拉垮整个实例 →
// 该实例上所有 WebSocket 全部断开 → 客户端集体重连（"短线重连接"）→
// 内存态会话状态（如按 connId 存的成人模式 Set）全部丢失（"切回普通模式"）。
//
// 这里改成「记录完整栈并继续服务」：单次失败只影响那一次请求，不再波及其他连接，
// 同时把崩溃栈打出来，方便定位真正的触发点（之前是静默崩溃重启，看不到任何栈）。
// 注意：uncaughtException 后进程理论上可能处于不一致状态；对聊天服务而言，
// 保活其余连接的收益远大于该风险。若日后发现某类异常确实需要重启，再按 name 精确退出。
process.on("unhandledRejection", (reason: unknown) => {
  const err = reason instanceof Error ? reason : undefined;
  logger.error("[Process] 未处理的 Promise rejection（已记录并继续，未退出进程）", {
    error: err?.message ?? String(reason),
    name: err?.name,
    stack: err?.stack,
  });
});

process.on("uncaughtException", (err: Error) => {
  logger.error("[Process] 未捕获异常（已记录并继续，未退出进程）", {
    error: err?.message ?? String(err),
    name: err?.name,
    stack: err?.stack,
  });
});

// 资源监控配置
const MONITOR_INTERVAL = 30_000; // 每30秒检查一次
const CONNECTIONS_WARNING_THRESHOLD = 20; // 20个连接警告

let dbInitialized = false;
let redisInitialized = false;
let sessionCount = 0;
let monitorInterval: NodeJS.Timeout | null = null;
let decayTimer: ReturnType<typeof startDecayTimer> | null = null;
let lastMemoryAlertState: MemoryAlertState | null = null;

// 资源监控函数
function startResourceMonitoring(): void {
  logger.info("资源监控已启动");
  const monitorConfig = resolveResourceMonitorConfig();

  monitorInterval = setInterval(() => {
    const snapshot = collectMemorySnapshot();
    const alert = evaluateMemoryAlert(snapshot, monitorConfig);
    const now = Date.now();

    // 会话数监控
    logger.debug("资源使用统计", {
      memory: {
        rss: `${snapshot.rssMb.toFixed(1)} MB`,
        heapUsed: `${snapshot.heapUsedMb.toFixed(1)} MB`,
        heapTotal: `${snapshot.heapTotalMb.toFixed(1)} MB`,
        heapLimit: `${snapshot.heapLimitMb.toFixed(1)} MB`,
        external: `${snapshot.externalMb.toFixed(1)} MB`,
        arrayBuffers: `${snapshot.arrayBuffersMb.toFixed(1)} MB`,
        heapFillPercent: `${(snapshot.heapFillRatio * 100).toFixed(1)}%`,
        heapLimitPercent: `${(snapshot.heapLimitRatio * 100).toFixed(1)}%`,
        rssPercentOfSystem: `${(snapshot.rssSystemRatio * 100).toFixed(1)}%`,
        systemFree: `${snapshot.systemFreeMb.toFixed(1)} MB`,
        systemTotal: `${snapshot.systemTotalMb.toFixed(1)} MB`,
      },
      sessions: sessionCount,
      timestamp: new Date().toISOString(),
    });

    if (shouldEmitMemoryAlert(lastMemoryAlertState, alert, now, monitorConfig.alertCooldownMs)) {
      if (alert.level === "normal") {
        logger.info("内存告警恢复", {
          previousLevel: lastMemoryAlertState?.level ?? "unknown",
          memory: {
            rss: `${snapshot.rssMb.toFixed(1)} MB`,
            heapUsed: `${snapshot.heapUsedMb.toFixed(1)} MB`,
            heapLimit: `${snapshot.heapLimitMb.toFixed(1)} MB`,
            heapLimitPercent: `${(snapshot.heapLimitRatio * 100).toFixed(1)}%`,
          },
        });
      } else {
        logger.warn("内存使用警告", {
          level: alert.level,
          reasons: alert.reasons,
          message: `进程内存达到 ${alert.level} 阈值`,
          memory: {
            rss: `${snapshot.rssMb.toFixed(1)} MB`,
            heapUsed: `${snapshot.heapUsedMb.toFixed(1)} MB`,
            heapLimit: `${snapshot.heapLimitMb.toFixed(1)} MB`,
            heapFillPercent: `${(snapshot.heapFillRatio * 100).toFixed(1)}%`,
            heapLimitPercent: `${(snapshot.heapLimitRatio * 100).toFixed(1)}%`,
            systemFree: `${snapshot.systemFreeMb.toFixed(1)} MB`,
          },
        });
      }
      lastMemoryAlertState = {
        level: alert.level,
        signature: `${alert.level}:${alert.reasons.join("|")}`,
        lastLoggedAt: now,
      };
    } else if (lastMemoryAlertState) {
      lastMemoryAlertState = {
        ...lastMemoryAlertState,
        level: alert.level,
        signature: `${alert.level}:${alert.reasons.join("|")}`,
      };
    }

    // 会话数警告
    if (sessionCount > CONNECTIONS_WARNING_THRESHOLD) {
      logger.warn("会话数警告", {
        message: `当前会话数已达 ${sessionCount}，接近限制`,
        sessions: sessionCount,
      });
    }
  }, MONITOR_INTERVAL);
}

function stopResourceMonitoring(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    logger.info("资源监控已停止");
  }
}

function printCapabilityBanner(): void {
  const cfg = getConfig();
  const check = "\x1b[32m\u2713\x1b[0m";
  const cross = "\x1b[33m\u2717\x1b[0m";

  const llm = cfg.REMI_LLM_API_KEY
    ? `${check} ${cfg.REMI_LLM_MODEL}`
    : `${cross} not configured`;
  const envFile = process.env.REMI_ACTIVE_ENV_FILE ?? activeEnvFile;
  const tts = `${check} ${cfg.REMI_TTS_PROVIDER} (no key needed)`;
  const stt = new SttStream().configured
    ? `${check} ${cfg.REMI_STT_PROVIDER}`
    : `${cross} not configured (voice input disabled)`;
  const memory = dbInitialized
    ? `${check} PostgreSQL`
    : `${cross} in-memory only (volatile)`;
  const redis = redisInitialized
    ? `${check} connected`
    : `${cross} disabled`;

  const url = `http://localhost:${PORT}`;
  console.log(
    "\n" +
    "\x1b[36m" +
    `  Remi ready on ${url}\n` +
    "\x1b[0m" +
    `  Env:    ${envFile}\n` +
    `  LLM:    ${llm}\n` +
    `  TTS:    ${tts}\n` +
    `  STT:    ${stt}\n` +
    `  Memory: ${memory}\n` +
    `  Redis:  ${redis}\n`,
  );
}

async function bootstrap() {
  // ── Load external plugins ────────────────────────────────────────
  const pluginPath = process.env.REMI_PLUGIN_PATH?.trim();
  if (pluginPath) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(pluginPath);
      const plugin: RemiPlugin = mod.default ?? mod;
      registerPlugin(plugin);
      logger.info("[Plugin] Loaded external plugin", {
        id: plugin.id,
        name: plugin.name,
        version: plugin.version,
        path: pluginPath,
      });
    } catch (err) {
      logger.warn("[Plugin] Failed to load external plugin", {
        path: pluginPath,
        error: (err as Error).message,
      });
    }
  }

  let memoryRepo = getMemoryRepository();

  if (process.env.DATABASE_URL) {
    try {
      await initDatabase();
      await ensureStorageSchema();
      dbInitialized = true;
      setDbReady(true);
      const devUserId = await ensureDevUser();
      const pgRepo = getPgMemoryRepository(devUserId);
      setMemoryRepository(pgRepo);
      memoryRepo = pgRepo;
      logger.info("[Storage] PostgreSQL initialized, using PG memory repo");
    } catch (err) {
      logger.warn("[Storage] PostgreSQL init failed (continuing without)", { error: err });
      dbInitialized = false;
    }
  } else {
    logger.info("[Storage] DATABASE_URL not set, using in-memory only");
  }

  decayTimer = startDecayTimer(memoryRepo);
  logger.info("[Memory] Decay timer started");

  if (process.env.REDIS_URL) {
    try {
      redisInitialized = await initRedis();
      setRedisReady(redisInitialized);
      if (redisInitialized) {
        logger.info("[Storage] Redis initialized");
      } else {
        logger.warn("[Storage] Redis init failed (continuing without)");
      }
    } catch (err) {
      logger.warn("[Storage] Redis init failed (continuing without)", { error: err });
      redisInitialized = false;
    }
  }

  await warmWhisperServer().catch((err) => {
    logger.warn("[STT] whisper-server warmup skipped", {
      error: err instanceof Error ? err.message : String(err),
    });
  });

  // 预热 Edge TTS 连接池，提前建立 2 个空闲连接
  await warmupEdgeTtsConnections(2).catch((err) => {
    logger.warn("[TTS] Edge TTS 连接预热跳过", {
      error: err instanceof Error ? err.message : String(err),
    });
  });
  logger.info("[TTS] Edge TTS 连接预热完成");

  let shuttingDown = false;
  const cleanupAndExitWrapper = async (signal: "SIGINT" | "SIGTERM") => {
    if (shuttingDown) return;
    shuttingDown = true;
    await cleanupAndExit(signal);
  };
  process.on("SIGINT", () => { void cleanupAndExitWrapper("SIGINT"); });
  process.on("SIGTERM", () => { void cleanupAndExitWrapper("SIGTERM"); });

  function onConnection(ws: WebSocket, req: IncomingMessage): void {
    sessionCount++;
    logger.debug("会话建立", { totalSessions: sessionCount });

    const session = createSession(ws, req);

    // 监听会话关闭
    ws.on("close", () => {
      sessionCount--;
      logger.debug("会话关闭", { totalSessions: sessionCount });
    });

    ws.on("error", () => {
      sessionCount--;
      logger.debug("会话异常关闭", { totalSessions: sessionCount });
    });
  }

  const server = await createGateway({ onConnection });
  startServer(server);

  printCapabilityBanner();

  // 启动资源监控
  startResourceMonitoring();

  logger.info("Remi AI 系统初始化完成");
}

async function cleanupAndExit(signal: "SIGINT" | "SIGTERM"): Promise<void> {
  logger.info(`[Shutdown] Received ${signal}, cleaning up resources...`);

  // 停止资源监控
  stopResourceMonitoring();

  // 停止所有定时器
  if (decayTimer) {
    stopDecayTimer(decayTimer);
  }

  // 关闭服务
  await shutdownWhisperServer().catch(() => {});
  if (dbInitialized) await closeDatabase().catch(() => {});
  if (redisInitialized) await closeRedis().catch(() => {});

  logger.info("所有资源清理完成，服务已停止");
  process.exit(0);
}

bootstrap().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  logger.error("[Remi AI] 启动失败", { err: message, stack });

  // 确保失败时也能正确清理
  if (monitorInterval) {
    clearInterval(monitorInterval);
  }

  process.exit(1);
});

export { PORT };
