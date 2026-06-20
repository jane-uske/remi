import path from "node:path";

import dotenv from "dotenv";

function resolveEnvFile(): string {
  const configured =
    process.env.DOTENV_CONFIG_PATH?.trim() ||
    process.env.REMI_ACTIVE_ENV_FILE?.trim();
  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.resolve(process.cwd(), configured);
  }

  return path.resolve(process.cwd(), ".env.localhost");
}

/** Load env before schema validation. Dev uses `.env.localhost` only. */
export function loadEnvFile(): string {
  const file = resolveEnvFile();
  // Env file wins over stale shell exports (e.g. legacy `model=qwen/qwen3.6-35b-a3b`).
  dotenv.config({ path: file, quiet: true, override: true });
  process.env.REMI_ACTIVE_ENV_FILE = file;
  return file;
}