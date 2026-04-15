const fs = require("fs");
const path = require("path");

function fileExists(target) {
  try {
    fs.accessSync(target, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function statOrNull(target) {
  if (!fileExists(target)) return null;
  const stat = fs.statSync(target);
  return {
    path: target,
    sizeBytes: stat.size,
    mtimeMs: stat.mtimeMs,
  };
}

function main() {
  const repoRoot = process.cwd();
  const candidateLogs = [
    "rem-ai.log",
    "codex-turn-log.log",
    "codex-stage1.log",
    "codex-stage2.log",
    "codex-stage2b.log",
    "rem-ai-restart.log",
    "rem-ai-service-fix.log",
    "rem-ai-tts-fix.log",
    "rem-ai-whitescreen-fix.log",
  ].map((name) => path.resolve(repoRoot, name));

  const manifest = {
    generatedAt: new Date().toISOString(),
    repoRoot,
    status: "daily_logs_ready",
    purpose:
      "Stable entrypoint for an agent reading day-to-day runtime logs before diagnosing behavior, regressions, or operational issues.",
    quickStart: {
      doc: path.resolve(repoRoot, "docs/LOG_DATA_ANALYSIS_ENTRY.md"),
      command: "npm run logs:data-entry",
    },
    logFiles: candidateLogs.map(statOrNull).filter(Boolean),
    primaryLogs: [
      path.resolve(repoRoot, "rem-ai.log"),
      path.resolve(repoRoot, "codex-turn-log.log"),
    ].filter(fileExists),
    highSignalTags: [
      "[Latency]",
      "[TurnTaking]",
      "[TurnState]",
      "[TurnTiming]",
      "[Duplex]",
      "[DuplexRx]",
      "[VAD]",
      "[STT]",
      "[pipeline]",
      "[session]",
    ],
    sourceFiles: {
      logger: path.resolve(repoRoot, "infra/logger.ts"),
      latencyTracer: path.resolve(repoRoot, "infra/latency_tracer.ts"),
      session: path.resolve(repoRoot, "server/session/index.ts"),
      pipeline: path.resolve(repoRoot, "server/pipeline/runner.ts"),
      voiceSubmit: path.resolve(repoRoot, "server/session/voice_submit.ts"),
      textChat: path.resolve(repoRoot, "server/session/text_chat.ts"),
    },
    suggestedCommands: [
      "npm run logs:data-entry",
      "rg -n \"\\[Latency\\]|\\[TurnTaking\\]|\\[TurnState\\]|\\[TurnTiming\\]|\\[Duplex\\]|\\[VAD\\]|\\[STT\\]\" rem-ai.log codex-turn-log.log",
      "tail -n 200 rem-ai.log",
      "tail -n 200 codex-turn-log.log",
      "npm run duplex:data-entry",
    ],
    triageOrder: [
      "Read current focus and tasks first if the issue may touch memory/session/voice critical path.",
      "Start from primary logs and high-signal tags before reading old archive logs.",
      "If the question is specifically about voice latency, duplex, or turn-taking, pivot to npm run duplex:data-entry after initial log scan.",
      "Do not claim production validation from synthetic reports alone.",
    ],
  };

  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

main();
