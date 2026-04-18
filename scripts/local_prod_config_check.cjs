const fs = require("fs");
const path = require("path");

function readEnvFile(envPath) {
  const absolutePath = path.resolve(envPath);
  const raw = fs.readFileSync(absolutePath, "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    env[match[1]] = match[2].trim();
  }
  return env;
}

function isNonEmpty(value) {
  return typeof value === "string" && value.trim() !== "";
}

function parseDatabaseUrlPassword(value) {
  if (!isNonEmpty(value)) return null;
  try {
    const parsed = new URL(value);
    return parsed.password || null;
  } catch {
    return null;
  }
}

function inferAuthMode(env) {
  const explicit = env.REMI_AUTH_MODE?.trim().toLowerCase();
  if (explicit === "disabled" || explicit === "legacy_jwt" || explicit === "clerk") {
    return explicit;
  }
  if (isNonEmpty(env.JWT_SECRET)) {
    return "legacy_jwt";
  }
  return "disabled";
}

function evaluateLocalProdConfig(env) {
  const messages = [];
  let hasError = false;

  const requiredBaseKeys = ["key", "base_url", "model", "POSTGRES_PASSWORD"];
  for (const key of requiredBaseKeys) {
    if (!isNonEmpty(env[key])) {
      messages.push(`MISS env: ${key} is empty`);
      hasError = true;
    } else {
      messages.push(`OK   env: ${key} is set`);
    }
  }

  if (env.POSTGRES_PASSWORD?.trim() === "rem_password") {
    messages.push(
      "WARN env: POSTGRES_PASSWORD is the local default 'rem_password'; acceptable for isolated local-prod only",
    );
  }

  const dbUrlPassword = parseDatabaseUrlPassword(env.DATABASE_URL);
  if (isNonEmpty(env.DATABASE_URL) && dbUrlPassword == null) {
    messages.push("WARN env: DATABASE_URL is set but could not parse its password");
  } else if (
    dbUrlPassword != null &&
    isNonEmpty(env.POSTGRES_PASSWORD) &&
    dbUrlPassword !== env.POSTGRES_PASSWORD.trim()
  ) {
    messages.push(
      "MISS env: DATABASE_URL password does not match POSTGRES_PASSWORD; local-prod app/db credentials will drift",
    );
    hasError = true;
  }

  const authMode = inferAuthMode(env);
  if (!isNonEmpty(env.REMI_AUTH_MODE)) {
    messages.push(`WARN env: REMI_AUTH_MODE not set, inferred '${authMode}' from current variables`);
  } else {
    messages.push(`OK   env: REMI_AUTH_MODE=${authMode}`);
  }

  if (authMode === "disabled") {
    messages.push("MISS env: REMI_AUTH_MODE=disabled is not acceptable for local production; use 'legacy_jwt' or 'clerk'");
    hasError = true;
  }

  if (authMode === "legacy_jwt") {
    if (!isNonEmpty(env.JWT_SECRET)) {
      messages.push("MISS env: JWT_SECRET is empty for REMI_AUTH_MODE=legacy_jwt");
      hasError = true;
    } else {
      messages.push("OK   env: JWT_SECRET is set");
    }
    if (isNonEmpty(env.NEXT_PUBLIC_REMI_AUTH_MODE) && env.NEXT_PUBLIC_REMI_AUTH_MODE.trim().toLowerCase() === "clerk") {
      messages.push("MISS env: NEXT_PUBLIC_REMI_AUTH_MODE=clerk conflicts with REMI_AUTH_MODE=legacy_jwt");
      hasError = true;
    }
  }

  if (authMode === "clerk") {
    const requiredClerkKeys = [
      "CLERK_JWT_KEY",
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    ];
    for (const key of requiredClerkKeys) {
      if (!isNonEmpty(env[key])) {
        messages.push(`MISS env: ${key} is empty for REMI_AUTH_MODE=clerk`);
        hasError = true;
      } else {
        messages.push(`OK   env: ${key} is set`);
      }
    }

    if (!isNonEmpty(env.CLERK_SECRET_KEY)) {
      messages.push(
        "WARN env: CLERK_SECRET_KEY is empty; current runtime only needs CLERK_JWT_KEY, but future server-side Clerk API calls will require it",
      );
    } else {
      messages.push("OK   env: CLERK_SECRET_KEY is set");
    }

    if (env.NEXT_PUBLIC_REMI_AUTH_MODE?.trim().toLowerCase() !== "clerk") {
      messages.push("MISS env: NEXT_PUBLIC_REMI_AUTH_MODE must be 'clerk' when REMI_AUTH_MODE=clerk");
      hasError = true;
    } else {
      messages.push("OK   env: NEXT_PUBLIC_REMI_AUTH_MODE=clerk");
    }

    if (isNonEmpty(env.REMI_ACCESS_PASSWORD)) {
      messages.push("WARN gate: REMI_ACCESS_PASSWORD is set; main Clerk domain should not stack the shared-password gate");
    }
  }

  const sttProvider = env.stt_provider?.trim().toLowerCase() || "openai";
  if (sttProvider === "whisper-cpp") {
    const useServerRaw = (env.whisper_use_server ?? "1").trim().toLowerCase();
    const useServer = useServerRaw !== "0" && useServerRaw !== "false";
    const autostartRaw = (env.whisper_server_autostart ?? "1").trim().toLowerCase();
    const autostart = autostartRaw !== "0" && autostartRaw !== "false";
    const serverUrl = env.whisper_server_url?.trim() || "";
    const modelPath = env.whisper_model?.trim() || "";

    if (useServer && !autostart && !serverUrl) {
      messages.push(
        "MISS env: whisper_server_url is required when whisper-cpp local-prod disables autostart",
      );
      hasError = true;
    }

    if (useServer && autostart && !modelPath) {
      messages.push("MISS env: whisper_model is required when whisper-cpp local-prod autostarts the server");
      hasError = true;
    }
  }

  return { authMode, hasError, messages };
}

function main() {
  const envPath = process.argv[2] || path.join(process.cwd(), ".env");
  const env = readEnvFile(envPath);
  const result = evaluateLocalProdConfig(env);
  for (const message of result.messages) {
    console.log(message);
  }
  if (result.hasError) {
    console.error("Local production checks failed.");
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  evaluateLocalProdConfig,
  inferAuthMode,
  readEnvFile,
};
