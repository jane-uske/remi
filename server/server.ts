import "dotenv/config";
import type { WebSocket } from "ws";
import type { IncomingMessage } from "http";

import { createLogger } from "../infra/logger";
import { setDbReady, setRedisReady } from "../infra/app_state";
import { startDecayTimer, stopDecayTimer } from "../memory/memory_decay";
import { getMemoryRepository, setMemoryRepository } from "../memory/memory_store";
import { initDatabase, closeDatabase } from "../storage/database";
import { initRedis, closeRedis } from "../storage/redis";
import { ensureDevUser } from "../storage/repositories/dev_identity";
import { getPgMemoryRepository } from "../storage/repositories/pg_memory_repository";
import { shutdownWhisperServer, warmWhisperServer } from "../voice/stt_stream";
import { warmupEdgeTtsConnections } from "../voice/tts";
import { createGateway, startServer, PORT } from "./gateway";
import { createSession } from "./session";
import {
  collectMemorySnapshot,
  evaluateMemoryAlert,
  resolveResourceMonitorConfig,
  shouldEmitMemoryAlert,
  type MemoryAlertState,
} from "./resource_monitor";

const logger = createLogger("server");

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

async function bootstrap() {
  let memoryRepo = getMemoryRepository();

  if (process.env.DATABASE_URL) {
    try {
      await initDatabase();
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
