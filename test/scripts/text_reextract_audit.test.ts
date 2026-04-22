const assert = require("assert").strict;

const {
  parseArgs,
  runReextractAudit,
  renderReextractAuditReport,
  buildJsonReport,
} = require("../../scripts/text_reextract_audit");

describe("text re-extract audit", () => {
  it("parses repeated --case flags and json output", () => {
    const parsed = parseArgs([
      "--case",
      "greeting_no_episode",
      "--case",
      "debt_pressure_episode",
      "--json",
    ]);

    assert.deepEqual(parsed.caseIds, [
      "greeting_no_episode",
      "debt_pressure_episode",
    ]);
    assert.equal(parsed.json, true);
  });

  it("re-extracts current slow-brain moments and EpisodeV3 previews from built-in transcripts", async () => {
    const report = await runReextractAudit([
      "debt_pressure_episode",
      "comfort_failure_episode",
    ]);

    assert.equal(report.kind, "text_reextract_audit");
    assert.equal(report.caseCount, 2);
    assert.equal(report.warnCount, 0);
    assert.equal(report.cases[0].extractedMoments.length > 0, true);
    assert.equal(report.cases[0].episodeViews[0].domain, "money");
    assert.equal(
      report.cases[1].episodeViews.some((view) => view.domain === "relationship_with_remi"),
      true,
    );
  });

  it("renders a text report and a json-compatible report shape", async () => {
    const report = await runReextractAudit([
      "greeting_no_episode",
      "debt_pressure_episode",
    ]);
    const text = renderReextractAuditReport(report);
    const json = buildJsonReport(report);

    assert.ok(text.includes("Text Re-extract Audit:"));
    assert.ok(text.includes("extractedMoments:"));
    assert.ok(text.includes("episodeViews:"));
    assert.ok(text.includes("auditSummary:"));
    assert.equal(json.kind, "text_reextract_audit");
    assert.equal(json.syntheticOnly, true);
    assert.equal(json.caseCount, 2);
    assert.equal(Array.isArray(json.cases), true);
  });
});
