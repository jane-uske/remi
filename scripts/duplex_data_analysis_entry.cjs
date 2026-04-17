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

function listLatestSyntheticReports(soakDir) {
  if (!fileExists(soakDir)) return [];
  return fs
    .readdirSync(soakDir)
    .filter((name) => /^duplex_soak_.*\.json$/.test(name))
    .map((name) => {
      const json = path.resolve(soakDir, name);
      const markdownCandidate = json.replace(/\.json$/, ".md");
      const stat = fs.statSync(json);
      return {
        json,
        markdown: fileExists(markdownCandidate) ? markdownCandidate : null,
        mtimeMs: stat.mtimeMs,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, 5);
}

function listLatestLiveLogs(repoRoot) {
  const liveDir = path.resolve(repoRoot, "artifacts/live");
  if (!fileExists(liveDir)) return [];
  return fs
    .readdirSync(liveDir)
    .filter((name) => /^dev_server_.*\.log$/.test(name))
    .map((name) => path.resolve(liveDir, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    .slice(0, 5);
}

function main() {
  const repoRoot = process.cwd();
  const soakDir = path.resolve(repoRoot, "artifacts/soak");
  const liveLogs = listLatestLiveLogs(repoRoot);
  const browserLogs = [
    ...liveLogs,
    path.resolve(repoRoot, "rem-ai.log"),
    path.resolve(repoRoot, "codex-turn-log.log"),
  ].filter(fileExists);

  const manifest = {
    generatedAt: new Date().toISOString(),
    repoRoot,
    status: "synthetic_ready_browser_pending",
    purpose:
      "Stable entrypoint for a data-analysis agent inspecting duplex latency, turn-taking traces, and misclassification samples.",
    quickStart: {
      doc: path.resolve(repoRoot, "docs/DUPLEX_DATA_ANALYSIS_ENTRY.md"),
      command: "npm run duplex:data-entry",
    },
    directories: {
      syntheticReports: soakDir,
      browserLogs,
    },
    latestSyntheticReports: listLatestSyntheticReports(soakDir),
    logTags: ["[Latency]", "[TurnTaking]", "[TurnState]", "[TurnTiming]"],
    reportFields: [
      "latencySummary.scenarios",
      "latencySummary.warnings",
      "latencySummary.readiness",
      "latencySummary.incompleteReasons",
      "misclassificationSummary",
      "sampleRows",
    ],
    scenarios: [
      "voice_roundtrip_baseline",
      "speech_resume_before_gap_commit",
      "interrupt_then_new_turn",
    ],
    sourceFiles: {
      reportBuilder: path.resolve(repoRoot, "scripts/duplex_soak_report.ts"),
      traceSchema: path.resolve(repoRoot, "infra/latency_tracer.ts"),
      voiceSession: path.resolve(repoRoot, "server/session/index.ts"),
      voiceSubmit: path.resolve(repoRoot, "server/session/voice_submit.ts"),
      textChat: path.resolve(repoRoot, "server/session/text_chat.ts"),
    },
    suggestedCommands: [
      "npm run duplex:data-entry",
      "node -e \"const fs=require('fs');const p=process.argv[1];console.log(JSON.stringify(JSON.parse(fs.readFileSync(p,'utf8')).latencySummary,null,2));\" /abs/path/to/latest.json",
      "rg -n \"\\[Latency\\]|\\[TurnTaking\\]|\\[TurnState\\]|\\[TurnTiming\\]\" artifacts/live/dev_server_*.log rem-ai.log codex-turn-log.log",
      "rg -n \"false_early_release|resume_missed|interrupt_missed|state_stuck_or_duplicate\" artifacts/soak/*.md artifacts/soak/*.json",
    ],
    caveats: [
      "Synthetic soak reports are machine-generated regression evidence, not final browser-duplex validation.",
      "Real browser-duplex evidence still lives in structured service logs until a dedicated browser-capture exporter is added.",
      "If latencySummary.readiness is incomplete or dataSource is synthetic_harness, do not present the result as production-ready validation.",
    ],
  };

  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

main();
