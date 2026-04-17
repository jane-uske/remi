const assert = require("assert").strict;
const { deriveRelationalStance } = require("../../brains/relational_stance");

function makeSnapshot(overrides = {}) {
  return {
    relationship: {
      familiarity: 0.4,
      emotionalBond: 0.3,
      turnCount: 6,
      preferredTopics: [],
    },
    moodTrajectory: [],
    sharedMoments: [],
    topicBoundaryState: null,
    proactiveStrategyState: {
      lastUserTurnAt: 0,
      lastProactiveAt: 0,
      lastUserReturnAfterProactiveAt: 0,
      consecutiveProactiveCount: 0,
      totalProactiveCount: 0,
      nudgesSinceLastUserTurn: 0,
      retreatLevel: 0,
      ignoredProactiveStreak: 0,
      cooldownUntilAt: 0,
      lastProactiveMode: "",
    },
    ...overrides,
  };
}

describe("relational_stance", () => {
  it("falls back to light presence when there is an active topic boundary", () => {
    const stance = deriveRelationalStance(
      makeSnapshot({
        topicBoundaryState: {
          blockedTopic: "工作",
          blockedKeywords: ["工作"],
          setAtTurn: 5,
          expiresAtTurn: 8,
        },
      }),
    );

    assert.equal(stance.mode, "light_presence");
    assert.equal(stance.proactiveCadence, "low");
  });

  it("uses anchored care for close negative threads", () => {
    const stance = deriveRelationalStance(
      makeSnapshot({
        relationship: {
          familiarity: 0.66,
          emotionalBond: 0.61,
          turnCount: 12,
          preferredTopics: ["睡眠"],
        },
        moodTrajectory: [
          { turn: 10, mood: "焦虑" },
          { turn: 11, mood: "委屈" },
          { turn: 12, mood: "疲惫" },
        ],
        sharedMoments: [
          {
            summary: "最近睡眠一直不好",
            topic: "睡眠",
            mood: "焦虑",
            hook: "",
            semanticKeywords: ["睡眠", "失眠"],
            kind: "stress",
            salience: 0.82,
            recurrenceCount: 3,
            unresolved: true,
            turn: 12,
            createdAt: Date.now(),
            firstSeenAt: Date.now(),
            lastReferencedAt: 0,
          },
        ],
      }),
    );

    assert.equal(stance.mode, "anchored_care");
    assert.equal(stance.expressionDirectness, "clear");
  });

  it("uses close warmth when the relationship is already close and recent mood is positive", () => {
    const stance = deriveRelationalStance(
      makeSnapshot({
        relationship: {
          familiarity: 0.78,
          emotionalBond: 0.72,
          turnCount: 18,
          preferredTopics: ["散步"],
        },
        moodTrajectory: [
          { turn: 16, mood: "平静" },
          { turn: 17, mood: "开心" },
          { turn: 18, mood: "放松" },
        ],
      }),
    );

    assert.equal(stance.mode, "close_warmth");
    assert.equal(stance.boundary, "close");
  });
});
