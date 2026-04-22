import fs from "fs/promises";
import path from "path";

import { createLogger } from "../infra/logger";
import type { MomentInput } from "../memory/episode_store";
import type { EpisodeV3View } from "../memory/episode_v3";
import type { RepairState, WorkingMemory } from "../brains/slow_brain_store";

const logger = createLogger("text_archive_ledger");

const isTestProcess =
  process.env.NODE_ENV === "test" ||
  process.argv.some((arg) => /mocha|node:test/i.test(arg));

export type TextArchiveMemoryWriteSource = "fast_extract" | "slow_extract";

export interface TextArchiveMemoryWrite {
  key: string;
  value: string;
  source: TextArchiveMemoryWriteSource;
}

export interface TextArchivePromptPayload {
  memoryKeys: string[];
  strategyHints: string;
  currentContext: string;
  slowBrainContext: string;
  deliberationBudget: string;
  reasoningEffort: string;
}

interface TextArchiveBaseEntry {
  kind: "text_archive";
  recordedAt: string;
  turnId: string;
  connId?: string;
  userId: string;
  inputSource: "text" | "voice";
  systemTriggered: boolean;
  userMessage: string;
}

export interface TextArchivePromptEntry extends TextArchiveBaseEntry {
  stage: "prompt";
  prompt: TextArchivePromptPayload;
  workingMemory: WorkingMemory | null;
  repairState: RepairState | null;
  memoryWrites: TextArchiveMemoryWrite[];
}

export interface TextArchiveSlowBrainEntry extends TextArchiveBaseEntry {
  stage: "slow_brain";
  assistantReply: string;
  llmConfigured: boolean;
  llmAborted: boolean;
  memoryWrites: TextArchiveMemoryWrite[];
  extractedMoments: MomentInput[];
  episodeViews: EpisodeV3View[];
}

export type TextArchiveLedgerEntry =
  | TextArchivePromptEntry
  | TextArchiveSlowBrainEntry;

function parseBooleanFlag(raw: string | undefined): boolean | null {
  if (raw === undefined || raw === "") return null;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

export function textArchiveLedgerEnabled(): boolean {
  const configured = parseBooleanFlag(process.env.REMI_TEXT_ARCHIVE_LEDGER_ENABLED);
  if (configured !== null) return configured;
  if (isTestProcess) return false;
  return process.env.NODE_ENV !== "production";
}

export function resolveTextArchiveLedgerPath(): string {
  const configured = process.env.REMI_TEXT_ARCHIVE_LEDGER_PATH?.trim();
  if (configured) return path.resolve(configured);
  return path.resolve(process.cwd(), "artifacts/cold_layer/text_archive_ledger.jsonl");
}

async function ensureParentDir(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

export async function appendTextArchiveEntry(
  entry: TextArchiveLedgerEntry,
  filePath = resolveTextArchiveLedgerPath(),
): Promise<void> {
  if (!textArchiveLedgerEnabled()) return;
  await ensureParentDir(filePath);
  await fs.appendFile(filePath, `${JSON.stringify(entry)}\n`, "utf8");
}

export function recordTextArchiveEntry(entry: TextArchiveLedgerEntry): void {
  if (!textArchiveLedgerEnabled()) return;
  void appendTextArchiveEntry(entry).catch((err) => {
    logger.warn("text archive ledger append failed", {
      stage: entry.stage,
      error: (err as Error).message,
    });
  });
}

export async function readTextArchiveEntries(
  filePath = resolveTextArchiveLedgerPath(),
): Promise<TextArchiveLedgerEntry[]> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as TextArchiveLedgerEntry);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}
