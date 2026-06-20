import fs from "node:fs";
import path from "node:path";

import { createLogger } from "../../infra/logger";

const logger = createLogger("config_overlay");

/**
 * Runtime settings overlay.
 *
 * A small JSON file (`data/remi-settings.json` by default) that the user edits
 * through the in-app settings page. Its values are layered on top of
 * `process.env` *before* the env schema is parsed, so they win over `.env`.
 *
 * Goals:
 *  - Stop the user from hand-editing `.env` + restarting every session.
 *  - Hot-apply: writing the file + `resetConfig()` makes the next `getConfig()`
 *    pick up the change with no process restart.
 *  - Never touch the user's `.env`, and never expose secrets (LLM keys, JWT…).
 *    Only the whitelisted keys below are read from / written to the overlay.
 */
export const OVERLAY_WRITABLE_KEYS = [
  // ComfyUI image generation
  "COMFYUI_ENABLED",
  "REMI_IMAGE_INTENT_LLM_ENABLED",
  "REMI_IMAGE_INTENT_TIMEOUT_MS",
  "REMI_IMAGE_PROMPT_LLM_ENABLED",
  "REMI_IMAGE_PROMPT_TIMEOUT_MS",
  "REMI_IMAGE_PROMPT_MAX_TOKENS",
  "REMI_IMAGE_PROMPT_TEMPERATURE",
  "COMFYUI_BASE_URL",
  "COMFYUI_CHECKPOINT",
  "COMFYUI_NSFW_CHECKPOINT",
  "COMFYUI_NSFW_NEGATIVE",
  "COMFYUI_DEFAULT_WIDTH",
  "COMFYUI_DEFAULT_HEIGHT",
  "REMI_IMAGE_CHARACTER_STYLE",
  // Local MLX (Qwen3-TTS) voice
  "REMI_TTS_PROVIDER",
  "REMI_TTS_MLX_URL",
  "REMI_TTS_MLX_MODEL",
  "REMI_TTS_MLX_SPEAKER",
  "REMI_TTS_MLX_LANGUAGE",
  // Adult mode master switch
  "REMI_NSFW_ENABLED",
] as const;

export type OverlayKey = (typeof OVERLAY_WRITABLE_KEYS)[number];

const WRITABLE = new Set<string>(OVERLAY_WRITABLE_KEYS);

export function overlayFilePath(): string {
  const configured = process.env.REMI_SETTINGS_FILE?.trim();
  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.resolve(process.cwd(), configured);
  }
  return path.resolve(process.cwd(), "data", "remi-settings.json");
}

/**
 * Read the overlay file, keeping only whitelisted keys and coercing every
 * value to a string (env vars are strings; the zod schema coerces numbers
 * /booleans). Missing or malformed file → empty object (never throws).
 */
export function loadOverlay(): Record<string, string> {
  const file = overlayFilePath();
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    logger.warn("ignoring malformed settings overlay", {
      file,
      error: (err as Error).message,
    });
    return {};
  }
  if (!parsed || typeof parsed !== "object") return {};

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!WRITABLE.has(key)) continue;
    if (value === null || value === undefined) continue;
    out[key] = typeof value === "string" ? value : String(value);
  }
  return out;
}

/**
 * Layer the overlay onto an env object (mutates it). Overlay values overwrite
 * whatever `.env`/process already set, so the in-app settings always win.
 * Called from {@link validateEnv} before parsing.
 */
export function applyOverlayToEnv(env: NodeJS.ProcessEnv): void {
  const overlay = loadOverlay();
  for (const [key, value] of Object.entries(overlay)) {
    env[key] = value;
  }
}

/**
 * Merge a partial settings patch into the overlay file (atomic write) and
 * return the full saved overlay. Unknown keys are dropped; an explicit empty
 * string is allowed (it clears a field back to the schema default at parse
 * time only if the schema default is ""). Throws only on filesystem errors.
 */
export function saveOverlay(patch: Record<string, unknown>): Record<string, string> {
  const current = loadOverlay();
  for (const [key, value] of Object.entries(patch)) {
    if (!WRITABLE.has(key)) continue;
    if (value === null || value === undefined) {
      delete current[key];
      continue;
    }
    current[key] = typeof value === "string" ? value : String(value);
  }

  const file = overlayFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(current, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
  logger.info("settings overlay saved", { file, keys: Object.keys(current) });
  return current;
}
