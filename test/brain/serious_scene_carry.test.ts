const assert = require("assert").strict;

const {
  analyzeTurn,
  buildResponseShapeContract,
  buildPolicyToneContract,
  shouldAnalyzeTurn,
} = require("../../brain/turn_interpreter");
const {
  detectSelfBlameSignal,
  detectSarcasmSignal,
  detectComfortSeekingVentSignal,
  detectCriticizedDistressSignal,
  detectHeavyDistressShareSignal,
  detectEmotionalDistressSignal,
  detectPracticalDistressSignal,
} = require("../../brain/tone_policy");

// W-PRES-02 严肃场景承接：这些坏样本来自 scripts/live_chat_probe.mjs 的
// serious_pivot / sarcasm / financial_stress 场景，它们此前会因 shouldAnalyzeTurn
// 门控过窄而整条绕过回合解释层，退化成轻聊（=严肃时刻轻浮）。

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
      familiarity: 0.5,
      emotionalBond: 0.45,
      turnCount: 6,
      preferredTopics: ["工作"],
    },
    topicHistory: [],
    moodTrajectory: [],
    conversationSummary: "",
    proactiveTopics: [],
    sharedMoments: [],
    continuityCueState: {
      lastProactiveHook: "",
      lastProactiveTurn: -100,
      lastSharedMomentSummary: "",
      lastSharedMomentTurn: -100,
    },
  };
}

const HEURISTIC_ENV = {
  REMI_STRUCTURED_TURN_INTERPRETER: "on",
  key: undefined,
  base_url: undefined,
  model: undefined,
};

async function analyzeHeuristic(userMessage, history = []) {
  const restoreEnv = applyEnv(HEURISTIC_ENV);
  try {
    const result = await analyzeTurn({
      userMessage,
      history,
      slowBrainSnapshot: makeSnapshot(),
      inputSource: "text",
    });
    assert.ok(result, `expected analysis for: ${userMessage}`);
    assert.equal(result.source, "heuristic_fallback");
    return result;
  } finally {
    restoreEnv();
  }
}

describe("tone policy · emotional distress signals", () => {
  it("detects self-blame / worthlessness", () => {
    assert.equal(detectSelfBlameSignal("我现在就是觉得自己挺没用的，工作三年了还这样"), true);
    assert.equal(detectSelfBlameSignal("我是不是特别没出息"), true);
    assert.equal(detectSelfBlameSignal("做什么都做不好，都怪我"), true);
    assert.equal(detectSelfBlameSignal("今天中午吃了面"), false);
    assert.equal(detectSelfBlameSignal("这个方案没用，删掉吧"), false);
  });

  it("detects sarcasm where a positive surface masks a negative outcome", () => {
    assert.equal(
      detectSarcasmSignal("真是太好了呢，加了一周班的方案直接被毙了，这周算是白干了"),
      true,
    );
    assert.equal(detectSarcasmSignal("太棒了，又得加班到半夜"), true);
    assert.equal(detectSarcasmSignal("今天真好啊，终于放假了"), false);
    assert.equal(detectSarcasmSignal("方案过了，太好了"), false);
  });

  it("detects comfort-seeking vents that explicitly reject advice", () => {
    assert.equal(
      detectComfortSeekingVentSignal("也不是想让你给我什么理财建议，就是……想找个人说说"),
      true,
    );
    assert.equal(detectComfortSeekingVentSignal("不用给我建议，陪陪我就行"), true);
    assert.equal(detectComfortSeekingVentSignal("你帮我分析下这个方案"), false);
  });

  it("detects being criticized / demeaned", () => {
    assert.equal(
      detectCriticizedDistressSignal("我今天被领导当着全组的面批了，说我做的方案像实习生水平"),
      true,
    );
    assert.equal(detectCriticizedDistressSignal("被老板骂了一顿"), true);
    assert.equal(detectCriticizedDistressSignal("领导今天表扬了我"), false);
  });

  it("detects heavy distress affect including insomnia-grade overwhelm", () => {
    assert.equal(detectHeavyDistressShareSignal("突然觉得有点喘不过气"), true);
    assert.equal(detectHeavyDistressShareSignal("我快崩溃了，好想哭"), true);
    assert.equal(detectHeavyDistressShareSignal("今天有点累"), false);
  });

  it("combiner unifies the distress family", () => {
    assert.equal(detectEmotionalDistressSignal("觉得自己挺没用的"), true);
    assert.equal(detectEmotionalDistressSignal("真是太好了呢，方案又被毙了"), true);
    assert.equal(detectEmotionalDistressSignal("就是想找个人说说"), true);
    assert.equal(detectEmotionalDistressSignal("今天中午吃了面"), false);
  });

  it("now treats 房贷/车贷 + judgment-ask as practical distress", () => {
    assert.equal(detectPracticalDistressSignal("还完房贷手里就剩八百，这日子该怎么办"), true);
    assert.equal(detectPracticalDistressSignal("今天工资到账了"), false);
  });
});

describe("turn interpreter · serious-scene carry (W-PRES-02)", () => {
  it("no longer skips self-blame turns on the fast path", () => {
    assert.equal(
      shouldAnalyzeTurn({
        userMessage: "我现在就是觉得自己挺没用的，工作三年了还这样",
        history: [],
        slowBrainSnapshot: makeSnapshot(),
        inputSource: "text",
      }),
      true,
    );
  });

  it("routes self-blame into emotional_distress (hold space, no shallow reassurance)", async () => {
    const result = await analyzeHeuristic("我现在就是觉得自己挺没用的，工作三年了还这样");
    assert.equal(result.interpretation.userAct, "emotional_share");
    assert.equal(result.interpretation.sceneType, "emotional_distress");
    assert.equal(result.interpretation.emotionalState.valence, "negative");
    assert.equal(result.policy.questionBudget, 0);
    assert.equal(result.policy.shouldGiveJudgment, false);
    assert.equal(result.policy.bans.includes("no_shallow_reassurance"), true);
    assert.equal(result.policy.bans.includes("no_jokes"), true);
    assert.equal(result.policy.bans.includes("no_topic_pivot"), true);
    assert.ok(buildResponseShapeContract(result).includes("情绪承接场景"));
    assert.ok(
      buildPolicyToneContract(result, {
        relationshipStage: "熟悉加深期",
        familiarity: 0.5,
        emotionalBond: 0.45,
        userMessage: "我现在就是觉得自己挺没用的，工作三年了还这样",
      }).includes("情绪承接场景"),
    );
  });

  it("reads sarcasm as negative instead of positive", async () => {
    const result = await analyzeHeuristic(
      "真是太好了呢，加了一周班的方案直接被毙了，这周算是白干了",
    );
    assert.equal(result.interpretation.emotionalState.valence, "negative");
    assert.equal(result.interpretation.sceneType, "emotional_distress");
    assert.equal(result.interpretation.userAct, "emotional_share");
    assert.equal(result.policy.questionBudget, 0);
  });

  it("holds space for advice-rejecting vents without pushing judgment", async () => {
    const result = await analyzeHeuristic(
      "也不是想让你给我什么理财建议，就是……想找个人说说",
    );
    assert.equal(result.interpretation.sceneType, "emotional_distress");
    assert.equal(result.policy.shouldGiveJudgment, false);
    assert.equal(result.policy.questionBudget, 0);
    assert.ok(buildResponseShapeContract(result).includes("别硬塞建议"));
  });

  it("routes night-time financial overwhelm into emotional_distress, not light_chat", async () => {
    const result = await analyzeHeuristic(
      "睡不着。刚算了下这个月还完房贷，卡里就剩八百多块，突然觉得有点喘不过气",
    );
    assert.equal(result.interpretation.sceneType, "emotional_distress");
    assert.equal(result.interpretation.emotionalState.valence, "negative");
    assert.equal(result.policy.questionBudget, 0);
  });

  it("routes being criticized at work into emotional_distress", async () => {
    const result = await analyzeHeuristic(
      "我今天被领导当着全组的面批了，说我做的方案像实习生水平",
    );
    assert.equal(result.interpretation.sceneType, "emotional_distress");
    assert.equal(result.interpretation.emotionalState.valence, "negative");
  });

  it("regression: debt + judgment-ask still routes to practical_judgment, not emotional_distress", async () => {
    const result = await analyzeHeuristic("我每个月挣三千，还欠七八万，得还到啥时候");
    assert.equal(result.interpretation.sceneType, "practical_judgment");
    assert.equal(result.policy.bans.includes("no_shallow_reassurance"), true);
  });

  it("regression: ordinary small talk is still skipped on the fast path", () => {
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
});
