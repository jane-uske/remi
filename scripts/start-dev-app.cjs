#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execFileSync, spawn } = require("child_process");

try {
  require("dotenv").config({
    path: path.resolve(process.cwd(), ".env"),
    quiet: true,
  });
} catch {
  // Best-effort only; dev startup should still work without dotenv here.
}

const repoRoot = process.cwd();
const portValue = Number(process.env.PORT);
const port =
  Number.isFinite(portValue) && portValue > 0 && portValue < 65536
    ? Math.floor(portValue)
    : 3000;
const skipAutoKill =
  process.env.REMI_DEV_KILL_OLD === "0" ||
  process.env.REMI_DEV_SKIP_AUTO_KILL === "1";

function run(command, args) {
  return execFileSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function safeRun(command, args) {
  try {
    return run(command, args);
  } catch {
    return "";
  }
}

function listListeningPids(targetPort) {
  const output = safeRun("lsof", [
    "-nP",
    `-iTCP:${targetPort}`,
    "-sTCP:LISTEN",
    "-t",
  ]);
  return Array.from(
    new Set(
      output
        .split(/\s+/)
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value > 0),
    ),
  );
}

function readProcessInfo(pid) {
  const command = safeRun("ps", ["-o", "command=", "-p", String(pid)]).trim();
  const ppidValue = safeRun("ps", ["-o", "ppid=", "-p", String(pid)]).trim();
  const ppid = Number(ppidValue);
  return {
    pid,
    ppid: Number.isInteger(ppid) && ppid > 0 ? ppid : null,
    command,
  };
}

function isRepoOwnedProcess(info) {
  return Boolean(info.command) && info.command.includes(repoRoot);
}

function chooseKillTargets(listeningPid) {
  const listener = readProcessInfo(listeningPid);
  if (!isRepoOwnedProcess(listener)) {
    return {
      okayToKill: false,
      description: listener.command || `pid ${listeningPid}`,
      targets: [],
    };
  }

  const targets = new Set([listener.pid]);
  let cursor = listener;
  while (cursor.ppid && cursor.ppid > 1) {
    const parent = readProcessInfo(cursor.ppid);
    if (!parent.command || !isRepoOwnedProcess(parent)) break;
    targets.add(parent.pid);
    cursor = parent;
  }

  return {
    okayToKill: true,
    description: listener.command,
    targets: Array.from(targets).sort((a, b) => a - b),
  };
}

function pidExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function waitForExit(pids, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pids.every((pid) => !pidExists(pid))) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
  return pids.every((pid) => !pidExists(pid));
}

function stopExistingRepoServer() {
  const listeningPids = listListeningPids(port);
  if (listeningPids.length === 0) return;

  for (const pid of listeningPids) {
    const decision = chooseKillTargets(pid);
    if (!decision.okayToKill) {
      console.error(
        `[dev:app] port ${port} is already in use by a non-repo process; refusing to kill it automatically.`,
      );
      console.error(`[dev:app] owner: ${decision.description}`);
      process.exit(1);
    }

    console.log(
      `[dev:app] stopping existing repo dev server on port ${port}: ${decision.targets.join(", ")}`,
    );
    for (const target of [...decision.targets].reverse()) {
      try {
        process.kill(target, "SIGTERM");
      } catch {
        // Ignore already-exited processes.
      }
    }
    if (!waitForExit(decision.targets, 5000)) {
      for (const target of [...decision.targets].reverse()) {
        try {
          process.kill(target, "SIGKILL");
        } catch {
          // Ignore already-exited processes.
        }
      }
      if (!waitForExit(decision.targets, 2000)) {
        console.error(
          `[dev:app] failed to stop existing repo process(es): ${decision.targets.join(", ")}`,
        );
        process.exit(1);
      }
    }
  }
}

if (!skipAutoKill) {
  stopExistingRepoServer();
}

const nodemonBinary = path.resolve(repoRoot, "node_modules/.bin/nodemon");
if (!fs.existsSync(nodemonBinary)) {
  console.error("[dev:app] nodemon binary not found. Run npm install first.");
  process.exit(1);
}

const child = spawn(nodemonBinary, [], {
  cwd: repoRoot,
  stdio: "inherit",
});

function forwardSignal(signal) {
  if (!child.killed) {
    try {
      child.kill(signal);
    } catch {
      // Ignore when child already exited.
    }
  }
}

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
