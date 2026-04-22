const assert = require("assert").strict;
const path = require("path");

function clearEpisodeRepositoryModule() {
  const modulePath = path.resolve(__dirname, "../../storage/repositories/episode_repository.ts");
  delete require.cache[modulePath];
}

describe("episode_repository", () => {
  const database = require("../../storage/database");
  let originalQuery;
  let calls;

  beforeEach(() => {
    originalQuery = database.query;
    calls = [];
    database.query = async (text, params) => {
      calls.push({ text, params });
      return {
        rows: [
          {
            id: "episode-1",
            user_id: "user-1",
            title: "title",
            summary: "summary",
            topics: ["sleep"],
            mood: "tired",
            kind: "support",
            salience: 0.8,
            recurrence_count: 1,
            unresolved: true,
            first_seen_at: new Date("2026-01-01T00:00:00.000Z"),
            last_seen_at: new Date("2026-01-02T00:00:00.000Z"),
            last_referenced_at: null,
            centroid_embedding: "[0.1,0.2]",
            origin_moment_summaries: ["summary"],
            relationship_weight: 0.6,
            status: "active",
            v3_domain: "money",
            v3_pressure_source: "financial",
            v3_relational_impact: "medium",
            v3_user_stance: "concerned",
            v3_unresolved_level: 3,
            v3_event_summary: "money summary",
            v3_evidence_turns: ["summary"],
            v3_last_user_position: "summary",
          },
        ],
      };
    };
    clearEpisodeRepositoryModule();
  });

  afterEach(() => {
    database.query = originalQuery;
    clearEpisodeRepositoryModule();
  });

  it("insertEpisode passes the expected SQL params", async () => {
    const { insertEpisode } = require("../../storage/repositories/episode_repository.ts");

    const row = await insertEpisode({
      userId: "user-1",
      title: "最近睡不太好",
      summary: "最近睡眠一直不好。",
      topics: ["sleep", "stress"],
      mood: "tired",
      kind: "support",
      salience: 0.9,
      unresolved: true,
      centroidEmbedding: [0.1, 0.2, 0.3],
      originMomentSummaries: ["昨晚又失眠了"],
      relationshipWeight: 0.7,
      v3Domain: "money",
      v3PressureSource: "financial",
      v3RelationalImpact: "medium",
      v3UserStance: "concerned",
      v3UnresolvedLevel: 3,
      v3EventSummary: "钱和压力",
      v3EvidenceTurns: ["昨晚又失眠了"],
      v3LastUserPosition: "昨晚又失眠了",
    });

    assert.equal(calls.length, 1);
    assert.match(calls[0].text, /INSERT INTO episodes/);
    assert.deepEqual(calls[0].params, [
      "user-1",
      "最近睡不太好",
      "最近睡眠一直不好。",
      ["sleep", "stress"],
      "tired",
      "support",
      0.9,
      true,
      "active",
      "[0.1,0.2,0.3]",
      ["昨晚又失眠了"],
      0.7,
      "money",
      "financial",
      "medium",
      "concerned",
      3,
      "钱和压力",
      ["昨晚又失眠了"],
      "昨晚又失眠了",
    ]);
    assert.deepEqual(row.centroid_embedding, [0.1, 0.2]);
  });

  it("findSimilarEpisodes uses cosine distance ordering", async () => {
    const { findSimilarEpisodes } = require("../../storage/repositories/episode_repository.ts");

    await findSimilarEpisodes("user-1", [0.2, 0.4], 3);

    assert.match(calls[0].text, /<=>/);
    assert.match(calls[0].text, /status <> 'archived'/);
    assert.deepEqual(calls[0].params, ["user-1", "[0.2,0.4]", 3]);
  });

  it("updateEpisode only updates provided fields", async () => {
    const { updateEpisode } = require("../../storage/repositories/episode_repository.ts");

    await updateEpisode("episode-1", {
      summary: "新的 summary",
      unresolved: false,
      centroidEmbedding: [0.4, 0.8],
      v3Domain: "work",
      v3EventSummary: "工作 summary",
    });

    assert.match(calls[0].text, /summary = \$1/);
    assert.match(calls[0].text, /unresolved = \$2/);
    assert.match(calls[0].text, /centroid_embedding = \$3::vector/);
    assert.match(calls[0].text, /v3_domain = \$4/);
    assert.match(calls[0].text, /v3_event_summary = \$5/);
    assert.doesNotMatch(calls[0].text, /topics =/);
    assert.deepEqual(calls[0].params, [
      "新的 summary",
      false,
      "[0.4,0.8]",
      "work",
      "工作 summary",
      "episode-1",
    ]);
  });

  it("getUnresolvedEpisodes filters on unresolved episodes", async () => {
    const { getUnresolvedEpisodes } = require("../../storage/repositories/episode_repository.ts");

    await getUnresolvedEpisodes("user-1");

    assert.match(calls[0].text, /WHERE user_id = \$1 AND unresolved = true AND status = 'active'/);
    assert.deepEqual(calls[0].params, ["user-1"]);
  });

  it("getEpisodesByUser excludes archived episodes by default", async () => {
    const { getEpisodesByUser } = require("../../storage/repositories/episode_repository.ts");

    await getEpisodesByUser("user-1");

    assert.match(calls[0].text, /status <> 'archived'/);
    assert.deepEqual(calls[0].params, ["user-1"]);
  });

  it("getEpisodesByUser can include archived episodes for hygiene tooling", async () => {
    const { getEpisodesByUser } = require("../../storage/repositories/episode_repository.ts");

    await getEpisodesByUser("user-1", undefined, { includeArchived: true });

    assert.doesNotMatch(calls[0].text, /status <> 'archived'/);
    assert.deepEqual(calls[0].params, ["user-1"]);
  });

  it("getEpisodesByUser can explicitly request archived status", async () => {
    const { getEpisodesByUser } = require("../../storage/repositories/episode_repository.ts");

    await getEpisodesByUser("user-1", "archived");

    assert.doesNotMatch(calls[0].text, /status <> 'archived'/);
    assert.match(calls[0].text, /AND status = \$2/);
    assert.deepEqual(calls[0].params, ["user-1", "archived"]);
  });
});
