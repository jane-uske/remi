import fs from "fs";
import path from "path";
import pino, { multistream } from "pino";
import pretty from "pino-pretty";

export interface Logger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  debug(message: string, data?: Record<string, unknown>): void;
}

const level = process.env.LOG_LEVEL || "info";
const isDev = process.env.NODE_ENV !== "production";
const isTestProcess =
  process.env.NODE_ENV === "test" ||
  process.argv.some((arg) => /mocha|node:test/i.test(arg));
const autoFileSinkEnabled =
  isDev &&
  !isTestProcess &&
  process.env.REMI_AUTO_LOG_FILE !== "0" &&
  process.env.REMI_DISABLE_AUTO_LOG_FILE !== "1";

function formatDatePart(value: number): string {
  return String(value).padStart(2, "0");
}

function buildDevLogFilePath(now = new Date()): string {
  const logDir = process.env.REMI_DEV_LOG_DIR
    ? path.resolve(process.env.REMI_DEV_LOG_DIR)
    : path.resolve(process.cwd(), "artifacts/live");
  const stamp = [
    now.getFullYear(),
    formatDatePart(now.getMonth() + 1),
    formatDatePart(now.getDate()),
  ].join("");
  const time = [
    formatDatePart(now.getHours()),
    formatDatePart(now.getMinutes()),
    formatDatePart(now.getSeconds()),
  ].join("");
  fs.mkdirSync(logDir, { recursive: true });
  return path.join(logDir, `dev_server_${stamp}_${time}.log`);
}

const activeDevLogFilePath = autoFileSinkEnabled ? buildDevLogFilePath() : null;

function createBaseLogger() {
  if (!isDev) {
    return pino({ level });
  }

  const streams = [
    {
      stream: pretty({
        colorize: true,
        translateTime: "SYS:HH:MM:ss",
      }),
    },
  ];

  if (activeDevLogFilePath) {
    streams.push({
      stream: pretty({
        colorize: false,
        translateTime: "SYS:HH:MM:ss",
        destination: activeDevLogFilePath,
      }),
    });
  }

  return pino({ level }, multistream(streams));
}

const baseLogger = createBaseLogger();

if (activeDevLogFilePath) {
  baseLogger.info(
    {
      path: activeDevLogFilePath,
    },
    "[Logger] Dev file sink enabled",
  );
}

export function createLogger(module: string): Logger {
  const child = baseLogger.child({ module });
  return {
    info: (msg, data) => child.info(data ?? {}, msg),
    warn: (msg, data) => child.warn(data ?? {}, msg),
    error: (msg, data) => child.error(data ?? {}, msg),
    debug: (msg, data) => child.debug(data ?? {}, msg),
  };
}

export const logger = createLogger("remi");

export function getActiveDevLogFilePath(): string | null {
  return activeDevLogFilePath;
}
