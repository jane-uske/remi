import fs from "fs";

import { createLogger } from "./logger";
import { resolveVolcTtsConfig } from "../voice/tts_volc";

const logger = createLogger("startup");

type DiagnosticLevel = "info" | "warn";

function emit(level: DiagnosticLevel, message: string, data?: Record<string, unknown>): void {
  if (level === "warn") {
    logger.warn(message, data);
    return;
  }
  logger.info(message, data);
}

function filePresence(pathValue: string | undefined): "missing" | "exists" | "not_found" {
  if (!pathValue?.trim()) return "missing";
  return fs.existsSync(pathValue) ? "exists" : "not_found";
}

export function logStartupDiagnostics(): void {
  const llmConfigured = Boolean(
    process.env.key?.trim() &&
      process.env.base_url?.trim() &&
      process.env.model?.trim(),
  );
  emit("info", "[Startup] Runtime summary", {
    nodeEnv: process.env.NODE_ENV ?? "development",
    port: process.env.PORT ?? 3000,
    llmConfigured,
    sttProvider: process.env.stt_provider || "openai",
    ttsProvider: process.env.tts_provider || "edge",
    dbConfigured: Boolean(process.env.DATABASE_URL?.trim()),
    redisConfigured: Boolean(process.env.REDIS_URL?.trim()),
  });

  const whisperModelPath = process.env.whisper_model;
  const whisperModelStatus = filePresence(whisperModelPath);
  if ((process.env.stt_provider || "openai").toLowerCase() === "whisper-cpp") {
    emit(
      whisperModelStatus === "exists" ? "info" : "warn",
      "[Startup] whisper.cpp model check",
      {
        path: whisperModelPath ?? null,
        status: whisperModelStatus,
      },
    );
  }

  const piperModelPath = process.env.piper_model;
  const piperModelStatus = filePresence(piperModelPath);
  const ttsProvider = (process.env.tts_provider || "edge").toLowerCase();
  if (ttsProvider === "piper") {
    emit(
      piperModelStatus === "exists" ? "info" : "warn",
      "[Startup] Piper model check",
      {
        path: piperModelPath ?? null,
        status: piperModelStatus,
      },
    );
  } else if (ttsProvider === "volc") {
    const volc = resolveVolcTtsConfig();
    emit(
      volc ? "info" : "warn",
      "[Startup] Volc TTS config check",
      volc
        ? {
            resourceId: volc.resourceId,
            voiceType: volc.voiceType,
            baseUrl: volc.baseUrl,
          }
        : {
            missing: ["VOLC_TTS_API_KEY", "VOLC_TTS_RESOURCE_ID", "VOLC_TTS_VOICE_TYPE"],
          },
    );
  }

  const wsUrl = process.env.NEXT_PUBLIC_WS_URL?.trim();
  if (wsUrl && !/^(ws|wss):\/\//i.test(wsUrl)) {
    emit("warn", "[Startup] NEXT_PUBLIC_WS_URL should include ws:// or wss://", {
      value: wsUrl,
    });
  }
}
