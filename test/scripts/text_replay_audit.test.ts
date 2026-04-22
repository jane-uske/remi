const assert = require("assert").strict;

const {
  parseArgs,
  runReplayAudit,
  renderReplayAuditReport,
  buildJsonReport,
} = require("../../scripts/text_replay_audit");

describe("text replay audit", () => {
  it("parses repeated --case flags and json output", () => {
    const parsed = parseArgs([
      "--case",
      "greeting_stays_light",
      "--case",
      "decision_with_working_memory",
      "--json",
    ]);

    assert.deepEqual(parsed.caseIds, [
      "greeting_stays_light",
      "decision_with_working_memory",
    ]);
    assert.equal(parsed.json, true);
  });

  it("captures prompt payload, working memory, and repair state from built-in cases", async () => {
    const report = await runReplayAudit([
      "decision_with_working_memory",
      "repair_after_miss",
    ]);

    assert.equal(report.kind, "text_replay_audit");
    assert.equal(report.caseCount, 2);
    assert.equal(report.warnCount, 0);
    assert.equal(report.cases[0].workingMemory !== null, true);
    assert.equal(report.cases[0].repairState, null);
    assert.equal(report.cases[1].repairState !== null, true);
    assert.ok(report.cases[0].promptPayload.currentContext.length > 0);
    assert.ok(report.cases[1].promptPayload.strategyHints.length > 0);
  });

  it("renders a text report and a json-compatible report shape", async () => {
    const report = await runReplayAudit([
      "greeting_stays_light",
      "decision_with_working_memory",
    ]);
    const text = renderReplayAuditReport(report);
    const json = buildJsonReport(report);

    assert.ok(text.includes("Text Replay Audit:"));
    assert.ok(text.includes("promptPayload:"));
    assert.ok(text.includes("workingMemory:"));
    assert.ok(text.includes("auditSummary:"));
    assert.equal(json.kind, "text_replay_audit");
    assert.equal(json.syntheticOnly, true);
    assert.equal(json.caseCount, 2);
    assert.equal(Array.isArray(json.cases), true);
  });
});
