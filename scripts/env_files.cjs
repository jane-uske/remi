#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");

function resolveCandidate(file) {
  return path.resolve(ROOT_DIR, file);
}

function firstExisting(paths) {
  for (const candidate of paths) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return paths[0];
}

function resolveDevEnvFile() {
  const preferred = process.env.REMI_DEV_ENV_FILE?.trim() || ".env.localhost";
  return firstExisting([
    resolveCandidate(preferred),
    resolveCandidate(".env"),
  ]);
}

function resolveProdEnvFile() {
  const preferred = process.env.REMI_PROD_ENV_FILE?.trim() || ".env.local-prod";
  return firstExisting([
    resolveCandidate(preferred),
    resolveCandidate(".env"),
  ]);
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

module.exports = {
  ROOT_DIR,
  resolveDevEnvFile,
  resolveProdEnvFile,
  resolveEnvFile,
  resolveDevPort,
  resolveProdPort,
};

if (require.main === module) {
  const mode = process.argv[2] === "prod" ? "prod" : "dev";
  process.stdout.write(resolveEnvFile(mode));
}
