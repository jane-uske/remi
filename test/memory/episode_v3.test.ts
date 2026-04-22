import test from "node:test";
import assert from "node:assert/strict";

import {
  toEpisodeV3StorageFields,
  toEpisodeV3View,
  summarizeEpisodeV3View,
} from "../../memory/episode_v3";
import type { DbEpisode } from "../../storage/repositories/episode_repository";

function makeEpisode(overrides: Partial<DbEpisode> = {}): DbEpisode {
  return {
    id: "ep-1",
    user_id: "user-1",
    title: "base",
    summary: "base summary",
    topics: [],
    mood: "neutral",
    kind: "note",
    salience: 0.4,
    recurrence_count: 1,
    unresolved: true,
    first_seen_at: new Date("2026-04-22T00:00:00.000Z"),
    last_seen_at: new Date("2026-04-22T01:00:00.000Z"),
    last_referenced_at: null,
    centroid_embedding: [],
    origin_moment_summaries: [],
    relationship_weight: 0.4,
    status: "active",
    v3_domain: null,
    v3_pressure_source: null,
    v3_relational_impact: null,
    v3_user_stance: null,
    v3_unresolved_level: null,
    v3_event_summary: null,
    v3_evidence_turns: [],
    v3_last_user_position: null,
    ...overrides,
  };
}

test("maps money episodes into a structured warm-layer view", () => {
  const view = toEpisodeV3View(
    makeEpisode({
      title: "房租和账单",
      summary: "这个月房租和信用卡账单都要一起处理，我有点压力",
      topics: ["房租", "账单", "钱"],
      origin_moment_summaries: [
        "我得先把房租付了",
        "信用卡账单也快到期了",
      ],
      unresolved: true,
      status: "active",
      salience: 0.8,
    }),
  );

  assert.equal(view.domain, "money");
  assert.equal(view.pressureSource, "financial");
  assert.equal(view.relationalImpact, "medium");
  assert.equal(view.userStance, "concerned");
  assert.equal(view.unresolvedLevel >= 2, true);
  assert.equal(view.evidenceTurns.length, 2);
  assert.equal(view.lastUserPosition, "信用卡账单也快到期了");
  assert.equal(view.layer, "warm");
  assert.match(summarizeEpisodeV3View(view), /money/);
  assert.match(summarizeEpisodeV3View(view), /financial/);
});

test("maps work episodes into a structured warm-layer view", () => {
  const view = toEpisodeV3View(
    makeEpisode({
      title: "工作和项目进度",
      summary: "老板催项目进度，我今天还要开会和补材料",
      topics: ["工作", "项目", "老板"],
      origin_moment_summaries: [
        "老板又问了进度",
        "我今天得把材料补完",
      ],
      unresolved: true,
      status: "cooling",
      salience: 0.7,
    }),
  );

  assert.equal(view.domain, "work");
  assert.equal(view.pressureSource, "workload");
  assert.equal(view.relationalImpact, "medium");
  assert.equal(view.userStance, "committed");
  assert.equal(view.unresolvedLevel >= 2, true);
  assert.equal(view.lastUserPosition, "我今天得把材料补完");
  assert.equal(view.status, "cooling");
  assert.match(summarizeEpisodeV3View(view), /work/);
  assert.match(summarizeEpisodeV3View(view), /workload/);
});

test("maps pet episodes into a structured warm-layer view", () => {
  const view = toEpisodeV3View(
    makeEpisode({
      title: "小猫生病了",
      summary: "我在担心猫今天不太吃东西，要不要带去看医生",
      topics: ["猫", "宠物"],
      origin_moment_summaries: [
        "它今天没怎么吃饭",
        "我想尽快带它去看医生",
      ],
      unresolved: true,
      status: "active",
      salience: 0.6,
    }),
  );

  assert.equal(view.domain, "pet");
  assert.equal(view.pressureSource, "caretaking");
  assert.equal(view.relationalImpact, "low");
  assert.equal(view.userStance, "concerned");
  assert.equal(view.unresolvedLevel >= 2, true);
  assert.equal(view.lastUserPosition, "我想尽快带它去看医生");
  assert.match(summarizeEpisodeV3View(view), /pet/);
  assert.match(summarizeEpisodeV3View(view), /caretaking/);
});

test("maps relationship-with-remi episodes into a structured warm-layer view", () => {
  const view = toEpisodeV3View(
    makeEpisode({
      title: "想和你多待一会儿",
      summary: "今天有点累，只想你陪我安静聊一会儿",
      topics: ["Remi", "陪伴"],
      origin_moment_summaries: [
        "我现在不想处理别的事",
        "只想你陪我说会儿话",
      ],
      unresolved: true,
      status: "active",
      salience: 0.9,
    }),
  );

  assert.equal(view.domain, "relationship_with_remi");
  assert.equal(view.pressureSource, "relational");
  assert.equal(view.relationalImpact, "high");
  assert.equal(view.userStance, "seeking_support");
  assert.equal(view.unresolvedLevel, 3);
  assert.equal(view.lastUserPosition, "只想你陪我说会儿话");
  assert.match(summarizeEpisodeV3View(view), /relationship_with_remi/);
  assert.match(summarizeEpisodeV3View(view), /relational/);
});

test("exports EpisodeV3 storage fields and prefers them on read when present", () => {
  const storageFields = toEpisodeV3StorageFields(
    makeEpisode({
      title: "点点闯祸后的赔偿和你没接住我",
      summary: "我现在最烦的是你刚刚没有先站我这边，还一直让我重复讲那次赔偿。",
      topics: ["宠物", "赔偿", "Remi"],
      origin_moment_summaries: [
        "你刚刚没有先站我这边",
        "还一直让我重复讲那次赔偿",
      ],
      unresolved: true,
      status: "active",
      salience: 0.9,
      recurrence_count: 4,
    }),
  );

  assert.equal(storageFields.v3Domain, "relationship_with_remi");
  assert.equal(storageFields.v3PressureSource, "relational");
  assert.equal(storageFields.v3RelationalImpact, "high");
  assert.equal(storageFields.v3UserStance, "seeking_support");
  assert.equal(storageFields.v3UnresolvedLevel, 3);
  assert.deepEqual(storageFields.v3EvidenceTurns, [
    "你刚刚没有先站我这边",
    "还一直让我重复讲那次赔偿",
  ]);

  const view = toEpisodeV3View(
    makeEpisode({
      title: "宠物",
      summary: "宠物：旧 summary",
      topics: ["宠物"],
      v3_domain: storageFields.v3Domain,
      v3_pressure_source: storageFields.v3PressureSource,
      v3_relational_impact: storageFields.v3RelationalImpact,
      v3_user_stance: storageFields.v3UserStance,
      v3_unresolved_level: storageFields.v3UnresolvedLevel,
      v3_event_summary: storageFields.v3EventSummary,
      v3_evidence_turns: storageFields.v3EvidenceTurns,
      v3_last_user_position: storageFields.v3LastUserPosition,
    }),
  );

  assert.equal(view.domain, "relationship_with_remi");
  assert.equal(view.pressureSource, "relational");
  assert.equal(view.relationalImpact, "high");
  assert.equal(view.userStance, "seeking_support");
  assert.equal(view.unresolvedLevel, 3);
  assert.deepEqual(view.evidenceTurns, storageFields.v3EvidenceTurns);
  assert.equal(view.lastUserPosition, storageFields.v3LastUserPosition);
});
