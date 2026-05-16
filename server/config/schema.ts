import { z } from "zod";

const booleanString = z
  .union([z.literal("0"), z.literal("1"), z.literal("true"), z.literal("false"), z.literal("")])
  .optional()
  .transform((v) => v === "1" || v === "true");

const optionalUrl = z.string().url().optional().or(z.literal(""));

/**
 * Remi 环境变量 Schema — 启动时验证，失败则 exit(1)
 *
 * 命名规则：REMI_ 前缀 + 子系统 + 功能
 * 旧名通过 LEGACY_ALIASES 兼容
 */
export const envSchema = z.object({
  // ── LLM ──────────────────────────────────────────────────────────────────
  REMI_LLM_API_KEY: z.string().min(1, "LLM API key is required").default(""),
  REMI_LLM_BASE_URL: z.string().default("http://127.0.0.1:1234/v1"),
  REMI_LLM_MODEL: z.string().default("qwen2.5-14b-instruct"),
  REMI_FAST_BRAIN_MODEL: z.string().optional(),
  REMI_FAST_BRAIN_REASONING_EFFORT: z.string().optional(),

  // ── TTS ──────────────────────────────────────────────────────────────────
  REMI_TTS_PROVIDER: z.enum(["edge", "piper", "openai", "volc"]).default("edge"),
  REMI_TTS_VOICE: z.string().default("zh-CN-XiaoyiNeural"),
  VOLC_TTS_API_KEY: z.string().optional(),
  VOLC_TTS_RESOURCE_ID: z.string().optional(),
  VOLC_TTS_VOICE_TYPE: z.string().optional(),

  // ── STT ──────────────────────────────────────────────────────────────────
  REMI_STT_PROVIDER: z.enum(["openai", "whisper-cpp", "sherpa"]).default("openai"),
  REMI_STT_API_KEY: z.string().optional(),
  REMI_STT_BASE_URL: z.string().optional(),

  // ── Auth ─────────────────────────────────────────────────────────────────
  REMI_AUTH_MODE: z.enum(["disabled", "legacy_jwt", "clerk"]).default("disabled"),
  REMI_AUTH_JWT_SECRET: z.string().optional(),
  REMI_AUTH_ALLOW_LOOPBACK_BYPASS: booleanString.default("1"),
  CLERK_JWT_KEY: z.string().optional(),
  CLERK_SECRET_KEY: z.string().optional(),

  // ── Database ─────────────────────────────────────────────────────────────
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),

  // ── Server ───────────────────────────────────────────────────────────────
  REMI_PORT: z.coerce.number().int().positive().default(3001),
  REMI_LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // ── Features ─────────────────────────────────────────────────────────────
  REMI_SLOW_BRAIN_ENABLED: booleanString.default("1"),
  REMI_LOCAL_LLM_ENABLED: booleanString.default("1"),
  REMI_PERSISTENT_MEMORY_OVERLAY_ENABLED: booleanString.default("1"),
  REMI_AVATAR_INTENT_ENABLED: booleanString.default("1"),
  REMI_SILENCE_NUDGE_MS: z.coerce.number().int().nonnegative().default(0),
});

export type RemiEnv = z.infer<typeof envSchema>;

/**
 * Legacy env var name → new name mapping.
 * Old names still work but log a deprecation warning.
 */
const LEGACY_ALIASES: Record<string, string> = {
  key: "REMI_LLM_API_KEY",
  base_url: "REMI_LLM_BASE_URL",
  model: "REMI_LLM_MODEL",
  tts_provider: "REMI_TTS_PROVIDER",
  tts_voice: "REMI_TTS_VOICE",
  stt_provider: "REMI_STT_PROVIDER",
  stt_key: "REMI_STT_API_KEY",
  stt_base_url: "REMI_STT_BASE_URL",
  JWT_SECRET: "REMI_AUTH_JWT_SECRET",
  PORT: "REMI_PORT",
  LOG_LEVEL: "REMI_LOG_LEVEL",
};

function applyLegacyAliases(env: NodeJS.ProcessEnv): void {
  const warnings: string[] = [];
  for (const [oldName, newName] of Object.entries(LEGACY_ALIASES)) {
    if (env[oldName] && !env[newName]) {
      env[newName] = env[oldName];
      warnings.push(`  ${oldName} → ${newName}`);
    }
  }
  if (warnings.length > 0) {
    console.warn(
      `[remi:config] Deprecated env vars detected (still work, will be removed in future):\n${warnings.join("\n")}`,
    );
  }
}

/**
 * Validate all environment variables at startup.
 * Throws with a clear message listing all invalid/missing vars.
 */
export function validateEnv(): RemiEnv {
  applyLegacyAliases(process.env);

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `  ${issue.path.join(".")}: ${issue.message}`,
    );
    const msg = `[remi:config] Environment validation failed:\n${issues.join("\n")}\n\nSee .env.minimal for minimum required config.`;
    throw new Error(msg);
  }

  return result.data;
}
