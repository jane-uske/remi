import pino from "pino";

export interface Logger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  debug(message: string, data?: Record<string, unknown>): void;
}

const level = process.env.LOG_LEVEL || "info";
const isDev = process.env.NODE_ENV !== "production";

const baseLogger = pino({
  level,
  ...(isDev && {
    transport: {
      target: "pino-pretty",
      options: { colorize: true, translateTime: "SYS:HH:MM:ss" },
    },
  }),
});

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
