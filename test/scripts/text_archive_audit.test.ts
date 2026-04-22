const assert = require("assert").strict;
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const {
  appendTextArchiveEntry,
} = require("../../cold_layer/text_archive_ledger");

const {
  parseArgs,
  runTextArchiveAudit,
  renderTextArchiveAuditReport,
  buildJsonReport,
} = require("../../scripts/text_archive_audit");

describe("text archive audit", () => {
  it("parses json and limit flags", () => {
    const parsed = parseArgs(["--limit", "3", "--json"]);
    assert.equal(parsed.limit, 3);
    assert.equal(parsed.json, true);
  });

  it("reads real ledger entries and renders an audit report", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "text-archive-audit-"));
    const ledgerPath = path.join(tempDir, "archive.jsonl");
    const originalEnabled = process.env.REMI_TEXT_ARCHIVE_LEDGER_ENABLED;
    const originalPath = process.env.REMI_TEXT_ARCHIVE_LEDGER_PATH;
    process.env.REMI_TEXT_ARCHIVE_LEDGER_ENABLED = "1";
    process.env.REMI_TEXT_ARCHIVE_LEDGER_PATH = ledgerPath;

    try {
      await appendTextArchiveEntry({
        kind: "text_archive",
        stage: "prompt",
        recordedAt: new Date("2026-04-22T03:30:00.000Z").toISOString(),
        turnId: "turn-a",
        connId: "conn-1",
        userId: "user-1",
        inputSource: "text",
        systemTriggered: false,
        userMessage: "你好呀",
        memoryWrites: [],
        prompt: {
          memoryKeys: ["名字"],
          strategyHints: "hint",
          currentContext: "",
          slowBrainContext: "",
          deliberationBudget: "text_normal",
          reasoningEffort: "",
        },
        workingMemory: null,
        repairState: null,
      });

      const report = await runTextArchiveAudit(5);
      const text = renderTextArchiveAuditReport(report);
      const json = buildJsonReport(report);

      assert.equal(report.kind, "text_archive_audit");
      assert.equal(report.syntheticOnly, false);
      assert.equal(report.entryCount, 1);
      assert.equal(report.groupedTurns.length, 1);
      assert.equal(report.groupedTurns[0].turnId, "turn-a");
      assert.ok(text.includes("Text Archive Audit:"));
      assert.ok(text.includes("prompt"));
      assert.equal(json.entries.length, 1);
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
