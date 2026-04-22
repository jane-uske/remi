import {
  readTextArchiveEntries,
  resolveTextArchiveLedgerPath,
  type TextArchiveLedgerEntry,
} from "../cold_layer/text_archive_ledger";

type CliArgs = {
  json: boolean;
  limit: number;
};

type ArchiveAuditReport = {
  kind: "text_archive_audit";
  syntheticOnly: false;
  ledgerPath: string;
  entryCount: number;
  entries: TextArchiveLedgerEntry[];
  groupedTurns: Array<{
    turnId: string;
    promptEntry: TextArchiveLedgerEntry | null;
    slowBrainEntry: TextArchiveLedgerEntry | null;
  }>;
};

const DEFAULT_LIMIT = 10;

export function parseArgs(argv: string[]): CliArgs {
  let json = false;
  let limit = DEFAULT_LIMIT;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--limit") {
      const next = argv[i + 1];
      if (!next) {
        throw new Error("--limit requires a numeric value");
      }
      const parsed = Number(next);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("--limit must be a positive number");
      }
      limit = Math.floor(parsed);
      i += 1;
    }
  }
  return { json, limit };
}

function summarizeEntry(entry: TextArchiveLedgerEntry): string {
  if (entry.stage === "prompt") {
    return [
      `prompt`,
      `turnId=${entry.turnId}`,
      `message=${entry.userMessage}`,
      `memoryKeys=${entry.prompt.memoryKeys.length}`,
      `memoryWrites=${entry.memoryWrites.length}`,
      `wm=${entry.workingMemory ? "yes" : "no"}`,
      `repair=${entry.repairState ? entry.repairState.level : "none"}`,
    ].join(" | ");
  }
  return [
    `slow_brain`,
    `turnId=${entry.turnId}`,
    `message=${entry.userMessage}`,
    `memoryWrites=${entry.memoryWrites.length}`,
    `moments=${entry.extractedMoments.length}`,
    `episodeViews=${entry.episodeViews.length}`,
  ].join(" | ");
}

function buildGroupedTurns(entries: TextArchiveLedgerEntry[]) {
  const grouped = new Map<
    string,
    { turnId: string; promptEntry: TextArchiveLedgerEntry | null; slowBrainEntry: TextArchiveLedgerEntry | null }
  >();
  for (const entry of entries) {
    const current =
      grouped.get(entry.turnId) ??
      {
        turnId: entry.turnId,
        promptEntry: null,
        slowBrainEntry: null,
      };
    if (entry.stage === "prompt") {
      current.promptEntry = entry;
    } else {
      current.slowBrainEntry = entry;
    }
    grouped.set(entry.turnId, current);
  }
  return [...grouped.values()];
}

export async function runTextArchiveAudit(limit = DEFAULT_LIMIT): Promise<ArchiveAuditReport> {
  const ledgerPath = resolveTextArchiveLedgerPath();
  const allEntries = await readTextArchiveEntries(ledgerPath);
  const entries = allEntries.slice(-limit);
  return {
    kind: "text_archive_audit",
    syntheticOnly: false,
    ledgerPath,
    entryCount: entries.length,
    entries,
    groupedTurns: buildGroupedTurns(entries),
  };
}

export function renderTextArchiveAuditReport(report: ArchiveAuditReport): string {
  const lines = [
    "Text Archive Audit:",
    `- ledgerPath: ${report.ledgerPath}`,
    `- entryCount: ${report.entryCount}`,
  ];
  for (const entry of report.entries) {
    lines.push(`- ${entry.recordedAt} ${summarizeEntry(entry)}`);
  }
  if (report.groupedTurns.length > 0) {
    lines.push("- groupedTurns:");
    for (const turn of report.groupedTurns) {
      lines.push(
        `  - ${turn.turnId} prompt=${turn.promptEntry ? "yes" : "no"} slow_brain=${turn.slowBrainEntry ? "yes" : "no"}`,
      );
    }
  }
  return lines.join("\n");
}

export function buildJsonReport(report: ArchiveAuditReport): ArchiveAuditReport {
  return report;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const report = await runTextArchiveAudit(args.limit);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(buildJsonReport(report), null, 2)}\n`);
    return;
  }
  process.stdout.write(`${renderTextArchiveAuditReport(report)}\n`);
}

if (require.main === module) {
  void main().catch((err) => {
    console.error("[text_archive_audit] failed:", (err as Error).message);
    process.exitCode = 1;
  });
}
