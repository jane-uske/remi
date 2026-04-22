const assert = require("assert").strict;
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const {
  resolveTextArchiveLedgerPath,
  isTextArchiveLedgerEnabled,
  appendTextArchiveLedgerEntry,
  readTextArchiveLedgerEntries,
} = require("../../../storage/cold_layer/text_archive_ledger");

describe("text archive ledger", () => {
  it("resolves the default ledger path under artifacts/cold_layer", () => {
    const resolved = resolveTextArchiveLedgerPath({});

    assert.equal(
      resolved,
      path.resolve(process.cwd(), "artifacts", "cold_layer", "text_archive_ledger.jsonl"),
    );
  });

  it("allows overriding the ledger path with an env var", () => {
    const resolved = resolveTextArchiveLedgerPath({
      REMI_TEXT_ARCHIVE_LEDGER_PATH: "/tmp/remi-custom-ledger.jsonl",
    });

    assert.equal(resolved, "/tmp/remi-custom-ledger.jsonl");
  });

  it("stays disabled in test env unless explicitly enabled", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "remi-ledger-disabled-"));
    const ledgerPath = path.join(tmpDir, "disabled", "ledger.jsonl");
    const entry = {
      stage: "prompt",
      recordedAt: "2026-04-22T00:00:00.000Z",
      sessionId: "session-disabled",
      promptPayload: {
        memoryKeys: ["当前主线"],
      },
    };

    assert.equal(isTextArchiveLedgerEnabled({ NODE_ENV: "test" }), false);

    const appended = await appendTextArchiveLedgerEntry(entry, {
      env: {
        NODE_ENV: "test",
        REMI_TEXT_ARCHIVE_LEDGER_PATH: ledgerPath,
      },
    });

    assert.equal(appended, false);

    await assert.rejects(fs.access(ledgerPath));
  });

  it("creates parent directories, appends one json object per line, and reads entries back", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "remi-ledger-enabled-"));
    const ledgerPath = path.join(tmpDir, "nested", "text_archive_ledger.jsonl");
    const env = {
      NODE_ENV: "test",
      REMI_TEXT_ARCHIVE_LEDGER_ENABLED: "1",
      REMI_TEXT_ARCHIVE_LEDGER_PATH: ledgerPath,
    };
    const promptEntry = {
      stage: "prompt",
      recordedAt: "2026-04-22T00:00:00.000Z",
      sessionId: "session-1",
      turnId: "turn-1",
      promptPayload: {
        memoryKeys: ["当前主线", "不要乱猜"],
        strategyHints: ["先接住再回答"],
        currentContext: "用户刚刚补充了房租压力",
      },
    };
    const slowBrainEntry = {
      stage: "slow_brain",
      recordedAt: "2026-04-22T00:00:10.000Z",
      sessionId: "session-1",
      turnId: "turn-1",
      repairState: "trust_drop",
      slowBrainPayload: {
        summary: "用户对 Remi 的安慰能力不满",
        extractedMemoryCount: 1,
        extractedEpisodeCount: 1,
      },
    };

    assert.equal(isTextArchiveLedgerEnabled(env), true);

    const appendedPrompt = await appendTextArchiveLedgerEntry(promptEntry, { env });
    const appendedSlowBrain = await appendTextArchiveLedgerEntry(slowBrainEntry, { env });

    assert.equal(appendedPrompt, true);
    assert.equal(appendedSlowBrain, true);

    const raw = await fs.readFile(ledgerPath, "utf8");
    const lines = raw.trim().split("\n");

    assert.equal(lines.length, 2);
    assert.deepEqual(JSON.parse(lines[0]), promptEntry);
    assert.deepEqual(JSON.parse(lines[1]), slowBrainEntry);

    const entries = await readTextArchiveLedgerEntries({ env });

    assert.deepEqual(entries, [promptEntry, slowBrainEntry]);
  });
});
