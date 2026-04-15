import os from "node:os";
import v8 from "node:v8";

const MB = 1024 * 1024;

export type MemorySnapshot = {
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  heapLimitBytes: number;
  externalBytes: number;
  arrayBuffersBytes: number;
  systemTotalBytes: number;
  systemFreeBytes: number;
  rssMb: number;
  heapUsedMb: number;
  heapTotalMb: number;
  heapLimitMb: number;
  externalMb: number;
  arrayBuffersMb: number;
  systemTotalMb: number;
  systemFreeMb: number;
  heapFillRatio: number;
  heapLimitRatio: number;
  rssSystemRatio: number;
};

export type MemoryAlertLevel = "normal" | "warn" | "critical";

export type MemoryAlert = {
  level: MemoryAlertLevel;
  reasons: string[];
};

export type ResourceMonitorConfig = {
  warnRssBytes: number;
  criticalRssBytes: number;
  warnHeapLimitRatio: number;
  criticalHeapLimitRatio: number;
  alertCooldownMs: number;
};

export type MemoryAlertState = {
  level: MemoryAlertLevel;
  signature: string;
  lastLoggedAt: number;
};

function toMb(bytes: number): number {
  return Math.round((bytes / MB) * 10) / 10;
}

function parsePositiveNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseRatio(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : fallback;
}

export function resolveResourceMonitorConfig(
  env: NodeJS.ProcessEnv = process.env,
): ResourceMonitorConfig {
  return {
    warnRssBytes: parsePositiveNumber(env.REMI_MEMORY_WARN_RSS_MB, 1024) * MB,
    criticalRssBytes: parsePositiveNumber(env.REMI_MEMORY_CRITICAL_RSS_MB, 1536) * MB,
    warnHeapLimitRatio: parseRatio(env.REMI_MEMORY_WARN_HEAP_LIMIT_RATIO, 0.7),
    criticalHeapLimitRatio: parseRatio(env.REMI_MEMORY_CRITICAL_HEAP_LIMIT_RATIO, 0.85),
    alertCooldownMs: parsePositiveNumber(env.REMI_MEMORY_ALERT_COOLDOWN_MS, 300_000),
  };
}

export function collectMemorySnapshot(
  memoryUsage: NodeJS.MemoryUsage = process.memoryUsage(),
  heapStats: v8.HeapInfo = v8.getHeapStatistics(),
  systemTotalBytes: number = os.totalmem(),
  systemFreeBytes: number = os.freemem(),
): MemorySnapshot {
  const rssBytes = memoryUsage.rss;
  const heapUsedBytes = memoryUsage.heapUsed;
  const heapTotalBytes = memoryUsage.heapTotal;
  const heapLimitBytes = heapStats.heap_size_limit;
  const externalBytes = memoryUsage.external;
  const arrayBuffersBytes = memoryUsage.arrayBuffers;
  return {
    rssBytes,
    heapUsedBytes,
    heapTotalBytes,
    heapLimitBytes,
    externalBytes,
    arrayBuffersBytes,
    systemTotalBytes,
    systemFreeBytes,
    rssMb: toMb(rssBytes),
    heapUsedMb: toMb(heapUsedBytes),
    heapTotalMb: toMb(heapTotalBytes),
    heapLimitMb: toMb(heapLimitBytes),
    externalMb: toMb(externalBytes),
    arrayBuffersMb: toMb(arrayBuffersBytes),
    systemTotalMb: toMb(systemTotalBytes),
    systemFreeMb: toMb(systemFreeBytes),
    heapFillRatio: heapTotalBytes > 0 ? heapUsedBytes / heapTotalBytes : 0,
    heapLimitRatio: heapLimitBytes > 0 ? heapUsedBytes / heapLimitBytes : 0,
    rssSystemRatio: systemTotalBytes > 0 ? rssBytes / systemTotalBytes : 0,
  };
}

export function evaluateMemoryAlert(
  snapshot: MemorySnapshot,
  config: ResourceMonitorConfig,
): MemoryAlert {
  let level: MemoryAlertLevel = "normal";
  const reasons: string[] = [];

  if (snapshot.rssBytes >= config.criticalRssBytes) {
    level = "critical";
    reasons.push(`rss=${snapshot.rssMb}MB >= ${toMb(config.criticalRssBytes)}MB`);
  } else if (snapshot.rssBytes >= config.warnRssBytes) {
    level = "warn";
    reasons.push(`rss=${snapshot.rssMb}MB >= ${toMb(config.warnRssBytes)}MB`);
  }

  if (snapshot.heapLimitRatio >= config.criticalHeapLimitRatio) {
    level = "critical";
    reasons.push(
      `heapUsed/heapLimit=${(snapshot.heapLimitRatio * 100).toFixed(1)}% >= ${(config.criticalHeapLimitRatio * 100).toFixed(0)}%`,
    );
  } else if (snapshot.heapLimitRatio >= config.warnHeapLimitRatio) {
    if (level === "normal") level = "warn";
    reasons.push(
      `heapUsed/heapLimit=${(snapshot.heapLimitRatio * 100).toFixed(1)}% >= ${(config.warnHeapLimitRatio * 100).toFixed(0)}%`,
    );
  }

  return { level, reasons };
}

export function shouldEmitMemoryAlert(
  previous: MemoryAlertState | null,
  next: MemoryAlert,
  now: number,
  cooldownMs: number,
): boolean {
  if (next.level === "normal") {
    return previous?.level !== "normal";
  }

  const signature = `${next.level}:${next.reasons.join("|")}`;
  if (!previous) return true;
  if (previous.level !== next.level) return true;
  if (previous.signature !== signature) return true;
  return now - previous.lastLoggedAt >= cooldownMs;
}
