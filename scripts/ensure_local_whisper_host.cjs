#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");

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

function flagEnabled(rawValue, fallback) {
  if (typeof rawValue !== "string" || rawValue.trim() === "") return fallback;
  const normalized = rawValue.trim().toLowerCase();
  if (normalized === "0" || normalized === "false") return false;
  if (normalized === "1" || normalized === "true") return true;
  return fallback;
}

function commandExists(command) {
  try {
    execFileSync("sh", ["-lc", `command -v ${command}`], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function spawnLockPath(host, port) {
  return path.join(require("os").tmpdir(), `rem-whisper-${host}-${port}.spawn.lock`);
}

function releaseSpawnLock(lockPath) {
  try {
    fs.unlinkSync(lockPath);
  } catch {
    // best effort
  }
}

async function acquireSpawnLock(host, port, timeoutMs) {
  const lockPath = spawnLockPath(host, port);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      fs.writeFileSync(lockPath, String(process.pid), { flag: "wx" });
      return () => releaseSpawnLock(lockPath);
    } catch (err) {
      if (err && err.code !== "EEXIST") throw err;
      try {
        const stat = fs.statSync(lockPath);
        if (Date.now() - stat.mtimeMs > timeoutMs) {
          releaseSpawnLock(lockPath);
          continue;
        }
      } catch {
        // race: lock disappeared, retry
      }
    }
    await sleep(120);
  }
  throw new Error("whisper-server spawn lock timeout");
}

async function isReady(baseUrl) {
  try {
    const res = await fetch(baseUrl, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

function normalizeLocalBaseUrl(rawUrl, host, port) {
  const fallbackUrl = `http://${host}:${port}`;
  if (!rawUrl) return fallbackUrl;
  try {
    const parsed = new URL(rawUrl);
    if (
      parsed.hostname === "host.docker.internal" ||
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1"
    ) {
      parsed.hostname = "127.0.0.1";
      return parsed.toString().replace(/\/+$/, "");
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return fallbackUrl;
  }
}

async function main() {
  const envPath = process.argv[2] || path.join(process.cwd(), ".env.local-prod");
  const env = readEnvFile(envPath);
  const sttProvider = (env.stt_provider || "openai").trim().toLowerCase();
  const useServer = flagEnabled(env.whisper_use_server, true);
  const autostart = flagEnabled(env.whisper_server_autostart, true);

  if (sttProvider !== "whisper-cpp" || !useServer || autostart) {
    console.log("[local-prod] host whisper bootstrap skipped");
    return;
  }

  const host = (env.whisper_server_host || "127.0.0.1").trim() || "127.0.0.1";
  const portRaw = Number(env.whisper_server_port || "8080");
  const port = Number.isFinite(portRaw) && portRaw > 0 ? Math.floor(portRaw) : 8080;
  const localBaseUrl = normalizeLocalBaseUrl(env.whisper_server_url, host, port);

  if (await isReady(localBaseUrl)) {
    console.log(`[local-prod] host whisper-server already ready at ${localBaseUrl}`);
    return;
  }

  const cmd = (env.whisper_server_cmd || "whisper-server").trim() || "whisper-server";
  if (!commandExists(cmd)) {
    throw new Error(`host whisper-server command not found: ${cmd}`);
  }

  const model = (env.whisper_model || "").trim();
  if (!model) {
    throw new Error("host whisper-server bootstrap requires whisper_model");
  }
  if (!fs.existsSync(model)) {
    throw new Error(`host whisper model not found: ${model}`);
  }

  const lang = (env.whisper_lang || "zh").trim() || "zh";
  const inferencePathRaw = (env.whisper_server_request_path || "/inference").trim();
  const inferencePath = inferencePathRaw.startsWith("/") ? inferencePathRaw : `/${inferencePathRaw}`;
  const prompt = (env.whisper_prompt || "").trim();
  const extraArgs = (env.whisper_server_extra_args || "").split(/\s+/).filter(Boolean);

  const args = [
    "-m",
    model,
    "-l",
    lang,
    "--host",
    host,
    "--port",
    String(port),
    "--inference-path",
    inferencePath,
    "--convert",
  ];
  if (prompt) {
    args.push("--prompt", prompt);
  }
  if (extraArgs.length > 0) {
    args.push(...extraArgs);
  }

  const releaseLock = await acquireSpawnLock(host, port, 15_000);
  try {
    if (await isReady(localBaseUrl)) {
      console.log(`[local-prod] host whisper-server already ready at ${localBaseUrl}`);
      return;
    }

    const logDir = path.join(process.cwd(), "artifacts", "live");
    fs.mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, "local_prod_whisper_server.log");
    const fd = fs.openSync(logPath, "a");
    const child = spawn(cmd, args, {
      detached: true,
      stdio: ["ignore", fd, fd],
    });
    child.unref();

    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (await isReady(localBaseUrl)) {
        console.log(`[local-prod] host whisper-server ready at ${localBaseUrl}`);
        return;
      }
      await sleep(250);
    }

    throw new Error(`host whisper-server failed to become ready at ${localBaseUrl}`);
  } finally {
    releaseLock();
  }
}

main().catch((err) => {
  console.error(
    `[local-prod] whisper bootstrap failed: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
