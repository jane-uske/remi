import fs from "node:fs/promises";
import path from "node:path";

export interface PromptStageTextLedgerPayload {
  memoryKeys?: string[];
  strategyHints?: string[];
  currentContext?: string;
  slowBrainContext?: string;
  deliberationBudget?: string;
  reasoningEffort?: string;
}

export interface SlowBrainStageTextLedgerPayload {
  summary?: string;
  extractedMemoryCount?: number;
  extractedEpisodeCount?: number;
}

interface TextArchiveLedgerEntryBase {
  recordedAt: string;
  sessionId: string;
  turnId?: string;
}

export interface PromptStageTextLedgerEntry extends TextArchiveLedgerEntryBase {
  stage: "prompt";
  promptPayload: PromptStageTextLedgerPayload;
}

export interface SlowBrainStageTextLedgerEntry extends TextArchiveLedgerEntryBase {
  stage: "slow_brain";
  repairState?: string | null;
  slowBrainPayload: SlowBrainStageTextLedgerPayload;
}

export type TextArchiveLedgerEntry =
  | PromptStageTextLedgerEntry
  | SlowBrainStageTextLedgerEntry;

export interface TextArchiveLedgerOptions {
  env?: NodeJS.ProcessEnv;
  filePath?: string;
}

const DEFAULT_LEDGER_RELATIVE_PATH = path.join(
  "artifacts",
  "cold_layer",
  "text_archive_ledger.jsonl",
);

function parseBooleanFlag(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (normalized === "") return defaultValue;
  if (["0", "false", "off", "no"].includes(normalized)) return false;
  if (["1", "true", "on", "yes"].includes(normalized)) return true;
  return defaultValue;
}

export function resolveTextArchiveLedgerPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.REMI_TEXT_ARCHIVE_LEDGER_PATH?.trim();
  if (override) {
    return override;
  }
  return path.resolve(process.cwd(), DEFAULT_LEDGER_RELATIVE_PATH);
}

export function isTextArchiveLedgerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const defaultEnabled = env.NODE_ENV !== "test";
  return parseBooleanFlag(env.REMI_TEXT_ARCHIVE_LEDGER_ENABLED, defaultEnabled);
}

function resolveLedgerPath(options: TextArchiveLedgerOptions = {}): string {
  if (options.filePath?.trim()) {
    return options.filePath.trim();
  }
  return resolveTextArchiveLedgerPath(options.env);
}

export async function appendTextArchiveLedgerEntry(
  entry: TextArchiveLedgerEntry,
  options: TextArchiveLedgerOptions = {},
): Promise<boolean> {
  const env = options.env ?? process.env;
  if (!isTextArchiveLedgerEnabled(env)) {
    return false;
  }

  const ledgerPath = resolveLedgerPath(options);
  await fs.mkdir(path.dirname(ledgerPath), { recursive: true });
  await fs.appendFile(ledgerPath, `${JSON.stringify(entry)}\n`, "utf8");
  return true;
}

export async function readTextArchiveLedgerEntries(
  options: TextArchiveLedgerOptions = {},
): Promise<TextArchiveLedgerEntry[]> {
  const env = options.env ?? process.env;
  if (!isTextArchiveLedgerEnabled(env)) {
    return [];
  }

  const ledgerPath = resolveLedgerPath(options);

  try {
    const raw = await fs.readFile(ledgerPath, "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as TextArchiveLedgerEntry);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return [];
    }
    throw error;
  }
}
