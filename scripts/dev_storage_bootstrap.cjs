#!/usr/bin/env node

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function isNonEmpty(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isDisabledByEnv(env) {
  const autoStorage = env.REMI_DEV_AUTO_STORAGE?.trim().toLowerCase();
  const skipStorage = env.REMI_DEV_SKIP_STORAGE_BOOTSTRAP?.trim().toLowerCase();
  return autoStorage === "0" || autoStorage === "false" || skipStorage === "1" || skipStorage === "true";
}

function planDevStorageBootstrap(env = process.env) {
  if (isDisabledByEnv(env)) {
    return {
      enabled: false,
      services: [],
      reason: "disabled_by_env",
    };
  }

  const services = [];
  if (isNonEmpty(env.DATABASE_URL)) services.push("postgres");
  if (isNonEmpty(env.REDIS_URL)) services.push("redis");

  if (services.length === 0) {
    return {
      enabled: false,
      services,
      reason: "no_configured_storage",
    };
  }

  return {
    enabled: true,
    services,
    reason: "configured_storage",
  };
}

function loadBootstrapEnv(baseEnv = {}, envFile = null) {
  if (!envFile) return { ...baseEnv };
  const nextEnv = { ...baseEnv };
  const raw = fs.readFileSync(envFile, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    nextEnv[match[1]] = match[2].trim();
  }
  return nextEnv;
}

function ensureDevStorage(options = {}) {
  const envFile = options.envFile || null;
  const env = loadBootstrapEnv(options.env || process.env, envFile);
  const cwd = options.cwd || process.cwd();
  const stdio = options.stdio || "inherit";
  const composeFile = options.composeFile || "docker-compose.dev.yml";
  const plan = planDevStorageBootstrap(env);

  if (!plan.enabled) return plan;

  const args = ["compose"];
  if (envFile) {
    args.push("--env-file", envFile);
  }
  args.push("-f", composeFile, "up", "-d", ...plan.services);

  execFileSync("docker", args, {
    cwd,
    stdio,
  });

  return plan;
}

module.exports = {
  ensureDevStorage,
  loadBootstrapEnv,
  planDevStorageBootstrap,
};

if (require.main === module) {
  const envFileArg = process.argv[2] ? path.resolve(process.argv[2]) : null;
  const plan = ensureDevStorage({
    envFile: envFileArg,
  });
  if (plan.enabled) {
    console.log(`[dev:storage] ready: ${plan.services.join(", ")}`);
  } else {
    console.log(`[dev:storage] skipped: ${plan.reason}`);
  }
}
