const assert = require("assert").strict;

const {
  parseArgs,
  buildAcceptanceReport,
} = require("../../scripts/episode_acceptance");

describe("episode acceptance script", () => {
  it("parses scenario selection and keep-data flags", () => {
    const parsed = parseArgs([
      "--scenario",
      "debt_pressure",
      "--scenario",
      "pet_liability",
      "--keep-data",
    ]);

    assert.deepEqual(parsed.scenarios, ["debt_pressure", "pet_liability"]);
    assert.equal(parsed.keepData, true);
  });

  it("renders a failing report with explicit reasons when no episodes were written", () => {
    const report = buildAcceptanceReport({
      scenarios: ["debt_pressure"],
      embeddingStatus: "ok",
      createdEpisodes: [],
      totalEpisodesAfter: 0,
      failures: ["episodes did not increase", "no unresolved debt episode found"],
    });

    assert.ok(report.includes("FAIL"));
    assert.ok(report.includes("episodes did not increase"));
    assert.ok(report.includes("no unresolved debt episode found"));
  });
});
