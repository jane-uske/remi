const assert = require("assert").strict;
const {
  buildEpisodeQualityAuditReport,
} = require("../../memory/episode_quality_audit");

function makeEpisode(overrides = {}) {
  return {
    id: "episode-1",
    user_id: "user-1",
    title: "睡眠",
    summary: "睡眠：最近还在失眠",
    topics: ["睡眠"],
    mood: "焦虑",
    kind: "stress",
    salience: 0.8,
    recurrence_count: 2,
    unresolved: true,
    first_seen_at: new Date("2026-04-01T00:00:00.000Z"),
    last_seen_at: new Date("2026-04-10T00:00:00.000Z"),
    last_referenced_at: null,
    centroid_embedding: [],
    origin_moment_summaries: ["最近还在失眠", "昨晚又没睡好"],
    relationship_weight: 0.8,
    status: "active",
    ...overrides,
  };
}

function makeMessage(id, role, content) {
  return {
    id,
    session_id: "session-1",
    role,
    content,
    created_at: new Date("2026-04-11T00:00:00.000Z"),
  };
}

describe("episode_quality_audit", () => {
  it("surfaces merge, duplicate, unresolved coverage, and repeated resurfacing suspects heuristically", () => {
    const episodes = [
      makeEpisode({
        id: "episode-sleep",
        title: "睡眠",
        origin_moment_summaries: ["最近还在失眠", "昨晚又没睡好"],
      }),
      makeEpisode({
        id: "episode-mixed",
        title: "最近状态",
        topics: ["工作", "睡眠", "家人"],
        summary: "最近状态：工作压力、睡眠和家里争执混在一起",
        origin_moment_summaries: ["老板今天又发火了", "昨晚睡不着", "跟妈妈又吵了一架"],
        recurrence_count: 3,
        unresolved: false,
      }),
      makeEpisode({
        id: "episode-work",
        title: "工作压力",
        summary: "工作压力：老板那边最近又压得很紧",
        topics: ["工作", "老板"],
        origin_moment_summaries: ["老板今天又发火了"],
        unresolved: false,
        recurrence_count: 1,
      }),
      makeEpisode({
        id: "episode-work-2",
        title: "工作压力线",
        summary: "工作压力线：老板那边这条工作压力最近一直在卡你",
        topics: ["工作", "老板"],
        origin_moment_summaries: ["老板那边这条工作线还是很卡"],
        unresolved: false,
        recurrence_count: 1,
      }),
    ];
    const messages = [
      makeMessage("m1", "user", "最近又开始失眠了"),
      makeMessage("m2", "assistant", "听起来你这几天又挺难熬的。"),
      makeMessage("m3", "user", "跟妈妈又吵了一架"),
      makeMessage("m4", "user", "我想换工作了"),
    ];
    const recallSamples = [
      {
        messageId: "m1",
        content: "最近又开始失眠了",
        topEpisodeId: "episode-sleep",
        topEpisodeTitle: "睡眠",
      },
      {
        messageId: "m3",
        content: "跟妈妈又吵了一架",
        topEpisodeId: "episode-sleep",
        topEpisodeTitle: "睡眠",
      },
      {
        messageId: "m4",
        content: "我想换工作了",
        topEpisodeId: "episode-sleep",
        topEpisodeTitle: "睡眠",
      },
    ];

    const report = buildEpisodeQualityAuditReport({
      episodes,
      messages,
      recallSamples,
    });

    assert.equal(report.suspects.merge.some((entry) => entry.episodeId === "episode-mixed"), true);
    assert.equal(
      report.suspects.duplicateLines.some(
        (entry) =>
          entry.leftEpisodeId === "episode-work" &&
          entry.rightEpisodeId === "episode-work-2",
      ),
      true,
    );
    assert.equal(report.suspects.repeatedResurface.some((entry) => entry.episodeId === "episode-sleep"), true);
    assert.equal(report.qualitySignals.unresolvedHitRate !== null, true);
    assert.equal(report.qualitySignals.repeatedResurfaceRate, 1);
    assert.equal(report.notes.some((note) => note.includes("heuristic")), true);
  });
});
