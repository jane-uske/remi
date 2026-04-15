const assert = require("assert").strict;

const {
  analyzeTurn,
  buildResponseShapeContract,
  buildPolicyToneContract,
  shouldAnalyzeTurn,
} = require("../../brain/turn_interpreter");

function applyEnv(values) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

function makeSnapshot() {
  return {
    userProfile: { facts: new Map(), interests: [], personalityNotes: [] },
    relationship: {
      familiarity: 0.56,
      emotionalBond: 0.48,
      turnCount: 5,
      preferredTopics: ["工作"],
    },
    topicHistory: [],
    moodTrajectory: [{ turn: 4, mood: "委屈" }],
    conversationSummary: "最近主要在聊工作里的委屈和去留判断。",
    proactiveTopics: ["工作那件事后来缓一点了吗"],
    sharedMoments: [],
    continuityCueState: {
      lastProactiveHook: "",
      lastProactiveTurn: -100,
      lastSharedMomentSummary: "",
      lastSharedMomentTurn: -100,
    },
  };
}

describe("turn interpreter", () => {

  it("skips ordinary text turns so they do not block the fast path", () => {
    assert.equal(
      shouldAnalyzeTurn({
        userMessage: "我今天中午吃了面",
        history: [],
        slowBrainSnapshot: makeSnapshot(),
        inputSource: "text",
      }),
      false,
    );
  });

  it("still analyzes high-value text turns such as direct questions", () => {
    assert.equal(
      shouldAnalyzeTurn({
        userMessage: "偏向什么意思？",
        history: [],
        slowBrainSnapshot: makeSnapshot(),
        inputSource: "text",
      }),
      true,
    );
  });
  it("marks decision-seeking turns as answer-first with zero question budget", async () => {
    const restoreEnv = applyEnv({ REMI_STRUCTURED_TURN_INTERPRETER: "on", key: undefined, base_url: undefined, model: undefined });
    try {
      const result = await analyzeTurn({
        userMessage: "我是不是该辞职",
        history: [],
        slowBrainSnapshot: makeSnapshot(),
        inputSource: "text",
      });

      assert.ok(result);
      assert.equal(result.source, "heuristic_fallback");
      assert.equal(result.interpretation.userAct, "decision_seek");
      assert.equal(result.policy.shouldGiveJudgment, true);
      assert.equal(result.policy.questionBudget, 0);
      assert.ok(buildResponseShapeContract(result).includes("决策题"));
    } finally {
      restoreEnv();
    }
  });

  it("treats added real-world constraints as context updates that must update the judgment", async () => {
    const restoreEnv = applyEnv({ REMI_STRUCTURED_TURN_INTERPRETER: "on", key: undefined, base_url: undefined, model: undefined });
    try {
      const result = await analyzeTurn({
        userMessage: "攒了两年半，还欠花呗两万五",
        history: [
          { role: "user", content: "我是不是该辞职" },
          { role: "assistant", content: "我倾向于你先别裸辞。" },
        ],
        slowBrainSnapshot: makeSnapshot(),
        inputSource: "text",
      });

      assert.ok(result);
      assert.equal(result.interpretation.userAct, "context_update");
      assert.equal(result.policy.shouldUpdateDecisionContext, true);
      assert.equal(result.policy.questionBudget, 0);
      assert.ok(buildResponseShapeContract(result).includes("补充现实约束"));
      assert.ok(
        buildPolicyToneContract(result, {
          relationshipStage: "熟悉加深期",
          familiarity: 0.56,
          emotionalBond: 0.48,
          userMessage: "攒了两年半，还欠花呗两万五",
        }).includes("纳入判断"),
      );
    } finally {
      restoreEnv();
    }
  });

  it("keeps in-scene turns inside the scene instead of reopening it", async () => {
    const restoreEnv = applyEnv({ REMI_STRUCTURED_TURN_INTERPRETER: "on", key: undefined, base_url: undefined, model: undefined });
    try {
      const result = await analyzeTurn({
        userMessage: "北海公园，跟rem手牵手",
        history: [],
        slowBrainSnapshot: makeSnapshot(),
        inputSource: "text",
      });

      assert.ok(result);
      assert.equal(result.interpretation.userAct, "scene_continue");
      assert.equal(result.policy.bans.includes("no_scene_reset"), true);
      assert.ok(buildResponseShapeContract(result).includes("共同场景"));
    } finally {
      restoreEnv();
    }
  });
});
