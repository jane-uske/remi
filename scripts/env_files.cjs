#!/usr/bin/env node

const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");

function resolveCandidate(file) {
  return path.resolve(ROOT_DIR, file);
}

function resolveDevEnvFile() {
  const preferred = process.env.REMI_DEV_ENV_FILE?.trim() || ".env.localhost";
  return resolveCandidate(preferred);
}

function resolveProdEnvFile() {
  const preferred = process.env.REMI_PROD_ENV_FILE?.trim() || ".env.local-prod";
  return resolveCandidate(preferred);
}

function resolveEnvFile(mode) {
  if (mode === "prod") return resolveProdEnvFile();
  return resolveDevEnvFile();
}

function parsePort(value, fallback) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0 && parsed < 65536) {
    return Math.floor(parsed);
  }
  return fallback;
}

function resolveDevPort(env = process.env) {
  return parsePort(env.PORT, 3001);
}

function resolveProdPort(env = process.env) {
  return parsePort(env.PORT, 3000);
}

function resolveComposeProjectName(mode, env = process.env) {
  const key = mode === "prod" ? "REMI_PROD_COMPOSE_PROJECT" : "REMI_DEV_COMPOSE_PROJECT";
  const configured = env[key]?.trim();
  if (configured) return configured;
  return mode === "prod" ? "remi-ai-local-prod" : "remi-ai-dev";
}

function resolveDevVolumeNames(env = process.env) {
  return [
    env.REMI_DEV_PG_VOLUME?.trim() || "remi-ai_rem_pgdata",
    env.REMI_DEV_REDIS_VOLUME?.trim() || "remi-ai_rem_redisdata",
    env.REMI_DEV_ROOT_NODE_MODULES_VOLUME?.trim() || "remi-ai_rem_root_node_modules",
    env.REMI_DEV_WEB_NODE_MODULES_VOLUME?.trim() || "remi-ai_rem_web_node_modules",
    env.REMI_DEV_CODE_SERVER_CONFIG_VOLUME?.trim() || "remi-ai_rem_code_server_config",
  ];
}

function resolveProdVolumeNames(env = process.env) {
  return [
    env.REMI_LOCAL_PROD_PG_VOLUME?.trim() || "remi-ai_rem_local_prod_pgdata",
    env.REMI_LOCAL_PROD_REDIS_VOLUME?.trim() || "remi-ai_rem_local_prod_redisdata",
  ];
}

module.exports = {
  ROOT_DIR,
  resolveDevEnvFile,
  resolveProdEnvFile,
  resolveEnvFile,
  resolveDevPort,
  resolveProdPort,
  resolveComposeProjectName,
  resolveDevVolumeNames,
  resolveProdVolumeNames,
};

if (require.main === module) {
  const mode = process.argv[2] === "prod" ? "prod" : "dev";
  process.stdout.write(resolveEnvFile(mode));
}
