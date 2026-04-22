const assert = require("assert").strict;
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const {
  appendTextArchiveEntry,
  readTextArchiveEntries,
  resolveTextArchiveLedgerPath,
  textArchiveLedgerEnabled,
} = require("../../cold_layer/text_archive_ledger");

describe("text archive ledger", () => {
  it("defaults to a cold-layer jsonl path under artifacts", () => {
    const original = process.env.REMI_TEXT_ARCHIVE_LEDGER_PATH;
    delete process.env.REMI_TEXT_ARCHIVE_LEDGER_PATH;
    try {
      const resolved = resolveTextArchiveLedgerPath();
      assert.match(resolved, /artifacts\/cold_layer\/text_archive_ledger\.jsonl$/);
    } finally {
      if (original === undefined) {
        delete process.env.REMI_TEXT_ARCHIVE_LEDGER_PATH;
      } else {
        process.env.REMI_TEXT_ARCHIVE_LEDGER_PATH = original;
      }
    }
  });

  it("stays disabled by default in tests", () => {
    const original = process.env.REMI_TEXT_ARCHIVE_LEDGER_ENABLED;
    delete process.env.REMI_TEXT_ARCHIVE_LEDGER_ENABLED;
    try {
      assert.equal(textArchiveLedgerEnabled(), false);
    } finally {
      if (original === undefined) {
        delete process.env.REMI_TEXT_ARCHIVE_LEDGER_ENABLED;
      } else {
        process.env.REMI_TEXT_ARCHIVE_LEDGER_ENABLED = original;
      }
    }
  });

  it("appends and reads jsonl entries when explicitly enabled", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "text-archive-ledger-"));
    const ledgerPath = path.join(tempDir, "archive.jsonl");
    const originalEnabled = process.env.REMI_TEXT_ARCHIVE_LEDGER_ENABLED;
    const originalPath = process.env.REMI_TEXT_ARCHIVE_LEDGER_PATH;
    process.env.REMI_TEXT_ARCHIVE_LEDGER_ENABLED = "1";
    process.env.REMI_TEXT_ARCHIVE_LEDGER_PATH = ledgerPath;

    try {
      await appendTextArchiveEntry({
        kind: "text_archive",
        stage: "prompt",
        recordedAt: new Date("2026-04-22T03:00:00.000Z").toISOString(),
        turnId: "turn-1",
        connId: "conn-1",
        userId: "user-1",
        inputSource: "text",
        systemTriggered: false,
        userMessage: "你好",
        memoryWrites: [{ key: "城市", value: "上海", source: "fast_extract" }],
        prompt: {
          memoryKeys: ["城市"],
          strategyHints: "hint",
          currentContext: "",
          slowBrainContext: "",
          deliberationBudget: "text_normal",
          reasoningEffort: "",
        },
        workingMemory: null,
        repairState: null,
      });

      await appendTextArchiveEntry({
        kind: "text_archive",
        stage: "slow_brain",
        recordedAt: new Date("2026-04-22T03:00:01.000Z").toISOString(),
        turnId: "turn-1",
        connId: "conn-1",
        userId: "user-1",
        inputSource: "text",
        systemTriggered: false,
        userMessage: "你好",
        assistantReply: "在呀",
        llmConfigured: false,
        llmAborted: false,
        memoryWrites: [],
        extractedMoments: [],
        episodeViews: [],
      });

      const entries = await readTextArchiveEntries(ledgerPath);
      assert.equal(entries.length, 2);
      assert.equal(entries[0].stage, "prompt");
      assert.equal(entries[1].stage, "slow_brain");
      assert.equal(entries[0].memoryWrites[0].source, "fast_extract");
      assert.equal(entries[0].turnId, "turn-1");
    } finally {
      if (originalEnabled === undefined) {
        delete process.env.REMI_TEXT_ARCHIVE_LEDGER_ENABLED;
      } else {
        process.env.REMI_TEXT_ARCHIVE_LEDGER_ENABLED = originalEnabled;
      }
      if (originalPath === undefined) {
        delete process.env.REMI_TEXT_ARCHIVE_LEDGER_PATH;
      } else {
        process.env.REMI_TEXT_ARCHIVE_LEDGER_PATH = originalPath;
      }
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
