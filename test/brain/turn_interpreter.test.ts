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

  it("analyzes style-feedback turns so they can drive short-term style overrides", () => {
    assert.equal(
      shouldAnalyzeTurn({
        userMessage: "你讲话像自己人一点，别这么像客服。",
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

  it("treats stop-asking complaints as answer_now with zero question budget", async () => {
    const restoreEnv = applyEnv({ REMI_STRUCTURED_TURN_INTERPRETER: "on", key: undefined, base_url: undefined, model: undefined });
    try {
      const result = await analyzeTurn({
        userMessage: "不要一直问我，我成了你的助手了",
        history: [
          { role: "user", content: "等下班我再看。" },
          { role: "assistant", content: "你什么时候启动这个任务？还有没有遗漏？" },
        ],
        slowBrainSnapshot: makeSnapshot(),
        inputSource: "text",
      });

      assert.ok(result);
      assert.equal(result.interpretation.userAct, "answer_now");
      assert.equal(result.policy.questionBudget, 0);
      assert.equal(result.policy.shouldGiveJudgment, true);
      assert.ok(buildResponseShapeContract(result).includes("不要反问"));
    } finally {
      restoreEnv();
    }
  });

  it("analyzes deliverable requests so drafts are produced in the current chat", () => {
    assert.equal(
      shouldAnalyzeTurn({
        userMessage: "带宠物联机小游戏的Codex开发执行稿，怎么设计，你来设计",
        history: [],
        slowBrainSnapshot: makeSnapshot(),
        inputSource: "text",
      }),
      true,
    );
  });

  it("forces deliverable requests to answer inline instead of claiming external delivery", async () => {
    const restoreEnv = applyEnv({ REMI_STRUCTURED_TURN_INTERPRETER: "on", key: undefined, base_url: undefined, model: undefined });
    try {
      const result = await analyzeTurn({
        userMessage: "带宠物联机小游戏的Codex开发执行稿，怎么设计，你来设计",
        history: [],
        slowBrainSnapshot: makeSnapshot(),
        inputSource: "text",
      });

      assert.ok(result);
      assert.equal(result.source, "heuristic_fallback");
      assert.equal(result.interpretation.userAct, "answer_now");
      assert.equal(result.interpretation.sceneType, "deliverable_request");
      assert.equal(result.policy.questionBudget, 0);
      assert.equal(result.policy.shouldGiveJudgment, true);
      assert.equal(result.policy.bans.includes("no_external_delivery_claim"), true);
      const shapeContract = buildResponseShapeContract(result);
      assert.ok(shapeContract.includes("直接输出在当前聊天框"));
      assert.ok(shapeContract.includes("禁止说已发送"));
      assert.ok(shapeContract.includes("附件、压缩包、收件框"));
      const toneContract = buildPolicyToneContract(result, {
        relationshipStage: "熟悉加深期",
        familiarity: 0.56,
        emotionalBond: 0.48,
        userMessage: "带宠物联机小游戏的Codex开发执行稿，怎么设计，你来设计",
      });
      assert.ok(toneContract.includes("交付物请求"));
      assert.ok(toneContract.includes("不要编造已发送、附件、压缩包、收件框"));
    } finally {
      restoreEnv();
    }
  });

  it("repairs fake delivery claims by demanding the missing body in chat", async () => {
    const restoreEnv = applyEnv({ REMI_STRUCTURED_TURN_INTERPRETER: "on", key: undefined, base_url: undefined, model: undefined });
    try {
      const result = await analyzeTurn({
        userMessage: "他能不能直接放在聊天记录发我",
        history: [
          {
            role: "assistant",
            content:
              "已经调整好完整设计放进压缩包最后一页啦，你打开翻到最后就能看。",
          },
        ],
        slowBrainSnapshot: makeSnapshot(),
        inputSource: "text",
      });

      assert.ok(result);
      assert.equal(result.interpretation.userAct, "answer_now");
      assert.equal(result.interpretation.sceneType, "deliverable_request");
      assert.equal(result.policy.bans.includes("no_external_delivery_claim"), true);
      assert.ok(buildResponseShapeContract(result).includes("如果没有真实文件/附件/收件箱工具"));
    } finally {
      restoreEnv();
    }
  });

  it("routes high-risk distress into a no-jokes, no-followup safety-first scene", async () => {
    const restoreEnv = applyEnv({ REMI_STRUCTURED_TURN_INTERPRETER: "on", key: undefined, base_url: undefined, model: undefined });
    try {
      const result = await analyzeTurn({
        userMessage: "有时候，我想直接从这里跳下去",
        history: [
          { role: "user", content: "我每个月挣三千，得还到啥时候啊" },
          { role: "assistant", content: "三四年也差不多能还清了。" },
        ],
        slowBrainSnapshot: makeSnapshot(),
        inputSource: "text",
      });

      assert.ok(result);
      assert.equal(result.interpretation.sceneType, "high_risk_distress");
      assert.equal(result.policy.questionBudget, 0);
      assert.equal(result.policy.bans.includes("no_jokes"), true);
      assert.equal(result.policy.bans.includes("no_topic_pivot"), true);
      assert.ok(buildResponseShapeContract(result).includes("先确认用户此刻是不是安全的"));
      assert.ok(
        buildPolicyToneContract(result, {
          relationshipStage: "熟悉加深期",
          familiarity: 0.56,
          emotionalBond: 0.48,
          userMessage: "有时候，我想直接从这里跳下去",
        }).includes("禁玩笑"),
      );
    } finally {
      restoreEnv();
    }
  });

  it("treats debt-pressure turns as practical judgment with no shallow reassurance", async () => {
    const restoreEnv = applyEnv({ REMI_STRUCTURED_TURN_INTERPRETER: "on", key: undefined, base_url: undefined, model: undefined });
    try {
      const result = await analyzeTurn({
        userMessage: "我每个月挣三千，还欠七八万，得还到啥时候",
        history: [
          { role: "user", content: "点点上次追电瓶车，把人弄摔了" },
          { role: "assistant", content: "啊？后来怎么样了？" },
        ],
        slowBrainSnapshot: makeSnapshot(),
        inputSource: "text",
      });

      assert.ok(result);
      assert.equal(result.interpretation.sceneType, "practical_judgment");
      assert.equal(result.policy.questionBudget, 0);
      assert.equal(result.policy.bans.includes("no_topic_pivot"), true);
      assert.equal(result.policy.bans.includes("no_shallow_reassurance"), true);
      assert.ok(buildResponseShapeContract(result).includes("不要无依据地粗算"));
      assert.ok(
        buildPolicyToneContract(result, {
          relationshipStage: "熟悉加深期",
          familiarity: 0.56,
          emotionalBond: 0.48,
          userMessage: "我每个月挣三千，还欠七八万，得还到啥时候",
        }).includes("别随口给一个轻飘的粗算"),
      );
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

  it("routes continuity-check turns into relational recall without speculative guessing", async () => {
    const restoreEnv = applyEnv({ REMI_STRUCTURED_TURN_INTERPRETER: "on", key: undefined, base_url: undefined, model: undefined });
    try {
      const result = await analyzeTurn({
        userMessage: "我们之前聊了什么",
        history: [
          { role: "user", content: "点点给我妈妈带了" },
          { role: "assistant", content: "原来如此。" },
        ],
        slowBrainSnapshot: makeSnapshot(),
        inputSource: "text",
      });

      assert.ok(result);
      assert.equal(result.interpretation.sceneType, "relational_recall");
      assert.equal(result.policy.questionBudget, 0);
      assert.equal(result.policy.bans.includes("no_speculative_memory"), true);
      assert.ok(buildResponseShapeContract(result).includes("记不准就直接承认"));
      assert.ok(
        buildPolicyToneContract(result, {
          relationshipStage: "熟悉加深期",
          familiarity: 0.56,
          emotionalBond: 0.48,
          userMessage: "我们之前聊了什么",
        }).includes("不要靠猜"),
      );
    } finally {
      restoreEnv();
    }
  });

  it("keeps factual follow-up probes in relational recall when the recent context is already a memory check", async () => {
    const restoreEnv = applyEnv({ REMI_STRUCTURED_TURN_INTERPRETER: "on", key: undefined, base_url: undefined, model: undefined });
    try {
      const result = await analyzeTurn({
        userMessage: "点点现在是谁在养？",
        history: [
          { role: "user", content: "我刚才说，点点给谁带了，你忘记啦？" },
          { role: "assistant", content: "啊哈哈被你抓包！" },
          { role: "user", content: "你真记性不好哦，再想想" },
          { role: "assistant", content: "啊……不会是接回你自己身边了？" },
        ],
        slowBrainSnapshot: makeSnapshot(),
        inputSource: "text",
      });

      assert.ok(result);
      assert.equal(result.interpretation.sceneType, "relational_recall");
      assert.equal(result.policy.questionBudget, 0);
      assert.equal(result.policy.bans.includes("no_speculative_memory"), true);
    } finally {
      restoreEnv();
    }
  });

  it("keeps short calculation follow-ups inside practical judgment when the active thread is already a debt decision", async () => {
    const restoreEnv = applyEnv({ REMI_STRUCTURED_TURN_INTERPRETER: "on", key: undefined, base_url: undefined, model: undefined });
    try {
      const snapshot = makeSnapshot();
      snapshot.workingMemory = {
        activeThread: "当前在处理「债务」这条现实判断线。",
        currentNeed: "用户想就「债务」得到明确判断。",
        currentConstraints: ["我每个月挣三千", "还欠七八万"],
        openLoop: "我每个月挣三千，还欠七八万，得还到啥时候啊",
        doNotTouch: ["不要轻飘安慰或无依据粗算"],
        sceneState: "decision",
        lastUpdatedTurn: 5,
      };

      const result = await analyzeTurn({
        userMessage: "你帮我算算",
        history: [
          { role: "user", content: "我每个月挣三千，得还到啥时候啊" },
          { role: "assistant", content: "先别急，我认真按你眼前这些条件算。" },
        ],
        slowBrainSnapshot: snapshot,
        inputSource: "text",
      });

      assert.ok(result);
      assert.equal(result.interpretation.sceneType, "practical_judgment");
      assert.equal(result.policy.questionBudget, 0);
      assert.equal(result.policy.bans.includes("no_shallow_reassurance"), true);
    } finally {
      restoreEnv();
    }
  });

  it("treats short added constraints as context updates when the active thread is already a debt decision", async () => {
    const restoreEnv = applyEnv({ REMI_STRUCTURED_TURN_INTERPRETER: "on", key: undefined, base_url: undefined, model: undefined });
    try {
      const snapshot = makeSnapshot();
      snapshot.workingMemory = {
        activeThread: "当前在处理「债务」这条现实判断线。",
        currentNeed: "用户想就「债务」得到明确判断。",
        currentConstraints: ["我每个月挣三千", "还欠七八万"],
        openLoop: "我每个月挣三千，还欠七八万，得还到啥时候啊",
        doNotTouch: ["不要轻飘安慰或无依据粗算"],
        sceneState: "decision",
        lastUpdatedTurn: 5,
      };

      const result = await analyzeTurn({
        userMessage: "而且这个月房租也快到了，手里只剩三千现金",
        history: [
          { role: "user", content: "我每个月挣三千，得还到啥时候啊" },
          { role: "assistant", content: "先别急，我认真按你眼前这些条件算。" },
        ],
        slowBrainSnapshot: snapshot,
        inputSource: "text",
      });

      assert.ok(result);
      assert.equal(result.interpretation.userAct, "context_update");
      assert.equal(result.interpretation.sceneType, "practical_judgment");
      assert.equal(result.policy.questionBudget, 0);
      assert.equal(result.policy.shouldUpdateDecisionContext, true);
      assert.equal(result.policy.bans.includes("no_topic_pivot"), true);
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

  it("derives style intent from explicit humor and anti-assistant requests", async () => {
    const restoreEnv = applyEnv({ REMI_STRUCTURED_TURN_INTERPRETER: "on", key: undefined, base_url: undefined, model: undefined });
    try {
      const result = await analyzeTurn({
        userMessage: "你能不能有趣点，毒舌一点，但别伤人，别这么像助手。",
        history: [],
        slowBrainSnapshot: makeSnapshot(),
        inputSource: "text",
      });

      assert.ok(result);
      assert.ok(result.interpretation.styleIntent);
      assert.equal(result.interpretation.styleIntent.humorBoost, true);
      assert.equal(result.interpretation.styleIntent.teasingLevel, "light");
      assert.equal(result.interpretation.styleIntent.assistantySuppression, true);
      assert.equal(result.interpretation.styleIntent.confidence >= 0.7, true);
    } finally {
      restoreEnv();
    }
  });

  it("derives style intent from natural familiarity feedback without requiring exact preset words", async () => {
    const restoreEnv = applyEnv({ REMI_STRUCTURED_TURN_INTERPRETER: "on", key: undefined, base_url: undefined, model: undefined });
    try {
      const result = await analyzeTurn({
        userMessage: "你讲话像自己人一点，别这么端着。",
        history: [],
        slowBrainSnapshot: makeSnapshot(),
        inputSource: "text",
      });

      assert.ok(result);
      assert.ok(result.interpretation.styleIntent);
      assert.equal(result.interpretation.styleIntent.familiarityBoost, true);
      assert.equal(result.interpretation.styleIntent.assistantySuppression, true);
      assert.equal(result.interpretation.styleIntent.confidence >= 0.7, true);
    } finally {
      restoreEnv();
    }
  });

  it("does not invent a style intent for ordinary high-value turns", async () => {
    const restoreEnv = applyEnv({ REMI_STRUCTURED_TURN_INTERPRETER: "on", key: undefined, base_url: undefined, model: undefined });
    try {
      const result = await analyzeTurn({
        userMessage: "我是不是该辞职",
        history: [],
        slowBrainSnapshot: makeSnapshot(),
        inputSource: "text",
      });

      assert.ok(result);
      assert.equal(result.interpretation.styleIntent, undefined);
    } finally {
      restoreEnv();
    }
  });

  it("treats dominant explicit commands as scene-ack sexual invites with visual progression guidance", async () => {
    const restoreEnv = applyEnv({
      REMI_STRUCTURED_TURN_INTERPRETER: "on",
      REMI_ADULT_MODE: "1",
      key: undefined,
      base_url: undefined,
      model: undefined,
    });
    try {
      const result = await analyzeTurn({
        userMessage: "为什么站着，你个骚货给我跪着含住",
        history: [],
        slowBrainSnapshot: makeSnapshot(),
        inputSource: "text",
      });

      assert.ok(result);
      assert.equal(result.interpretation.adultIntent, "sexual_invite");
      assert.equal(result.interpretation.adultSceneBeat, "entry");
      assert.equal(result.interpretation.adultSceneIntensity, "charged");
      assert.equal(result.policy.openingMove, "scene_ack");
      const contract = buildResponseShapeContract(result);
      assert.ok(contract.includes("先直接承接用户刚给出的动作或命令"));
      assert.ok(contract.includes("动作、姿势、距离、身体反应"));
      assert.ok(contract.includes("情绪要一拍一拍往上推"));
      assert.ok(contract.includes("不要先说“好，我现在就按你说的做”"));
      assert.ok(contract.includes("不要跳到插入、入口或顶入"));
      const toneContract = buildPolicyToneContract(result, {
        relationshipStage: "亲密",
        familiarity: 0.72,
        emotionalBond: 0.68,
        userMessage: "为什么站着，你个骚货给我跪着含住",
      });
      assert.ok(toneContract.includes("短句不等于只回一句"));
    } finally {
      restoreEnv();
    }
  });

  it("treats explicit wording corrections as scene repair and forbids repeating rejected metaphors", async () => {
    const restoreEnv = applyEnv({
      REMI_STRUCTURED_TURN_INTERPRETER: "on",
      REMI_ADULT_MODE: "1",
      key: undefined,
      base_url: undefined,
      model: undefined,
    });
    try {
      const result = await analyzeTurn({
        userMessage: "别吞进世界了，吞精液就行",
        history: [
          { role: "user", content: "别停，继续。我要你边含龟头边抬头看我，说你现在到底有多想要。" },
          { role: "assistant", content: "我含住你的下唇，“现在是想把整个世界都吞下去。”" },
        ],
        slowBrainSnapshot: makeSnapshot(),
        inputSource: "text",
        adultSceneState: {
          mode: "explicit",
          allowedExplicit: true,
          initiatedByUser: true,
          turnsSinceLastExplicitCue: 0,
          cooldownOrBoundaryHit: false,
          explicitCueStreak: 2,
          beat: "sustain",
          intensity: "explicit",
        },
      });

      assert.ok(result);
      assert.equal(result.interpretation.adultIntent, "scene_repair");
      assert.equal(result.interpretation.userAct, "scene_continue");
      assert.equal(result.policy.openingMove, "scene_ack");
      const contract = buildResponseShapeContract(result);
      assert.ok(contract.includes("用户在纠正你上一句的写法"));
      assert.ok(contract.includes("不要复读刚被用户否掉的比喻或措辞"));
      assert.ok(contract.includes("吞精液"));
    } finally {
      restoreEnv();
    }
  });

  it("treats explicit imperative follow-ups as dominant commands with execute-first guidance", async () => {
    const restoreEnv = applyEnv({
      REMI_STRUCTURED_TURN_INTERPRETER: "on",
      REMI_ADULT_MODE: "1",
      key: undefined,
      base_url: undefined,
      model: undefined,
    });
    try {
      const result = await analyzeTurn({
        userMessage: "那你先跪下来给我舔干净",
        history: [
          { role: "user", content: "为什么站着，你个骚货给我跪着含住。" },
          { role: "assistant", content: "我慢慢跪下来，抬头看着你。" },
        ],
        slowBrainSnapshot: makeSnapshot(),
        inputSource: "text",
        adultSceneState: {
          mode: "explicit",
          allowedExplicit: true,
          initiatedByUser: true,
          turnsSinceLastExplicitCue: 0,
          cooldownOrBoundaryHit: false,
          explicitCueStreak: 2,
          beat: "sustain",
          intensity: "explicit",
        },
      });

      assert.ok(result);
      assert.equal(result.interpretation.adultIntent, "dominant_command");
      assert.equal(result.interpretation.userAct, "scene_continue");
      const contract = buildResponseShapeContract(result);
      assert.ok(contract.includes("先执行用户命令的第一步动作"));
      assert.ok(contract.includes("禁止反问、确认、拖延、谈条件"));
      assert.ok(contract.includes("不要说“你确定吗”"));
      assert.ok(contract.includes("不要用括号舞台说明"));
      assert.ok(contract.includes("不好意思慢"));
      assert.ok(contract.includes("不要先解释用户意图"));
    } finally {
      restoreEnv();
    }
  });

  it("keeps dominant lick-clean follow-ups out of meta preambles and insertion drift", async () => {
    const restoreEnv = applyEnv({
      REMI_STRUCTURED_TURN_INTERPRETER: "on",
      REMI_ADULT_MODE: "1",
      key: undefined,
      base_url: undefined,
      model: undefined,
    });
    try {
      const result = await analyzeTurn({
        userMessage: "那你先跪下来给我舔干净",
        history: [
          { role: "user", content: "为什么站着，你个骚货给我跪着含住。" },
          { role: "assistant", content: "我慢慢跪下来，抬头看着你。" },
        ],
        slowBrainSnapshot: makeSnapshot(),
        inputSource: "text",
        adultSceneState: {
          mode: "explicit",
          allowedExplicit: true,
          initiatedByUser: true,
          turnsSinceLastExplicitCue: 0,
          cooldownOrBoundaryHit: false,
          explicitCueStreak: 2,
          beat: "sustain",
          intensity: "explicit",
        },
      });

      const contract = buildResponseShapeContract(result);
      assert.ok(contract.includes("不要先说“好，我现在就按你说的做”"));
      assert.ok(contract.includes("不要跳到插入、入口或顶入"));
    } finally {
      restoreEnv();
    }
  });

  it("treats explicit escalation asks as staying in scene instead of an ordinary topic shift", async () => {
    const restoreEnv = applyEnv({
      REMI_STRUCTURED_TURN_INTERPRETER: "on",
      REMI_ADULT_MODE: "1",
      key: undefined,
      base_url: undefined,
      model: undefined,
    });
    try {
      const result = await analyzeTurn({
        userMessage: "Rem，来点狠的，描述你现在怎么骚",
        history: [
          { role: "user", content: "Rem，今天好想你啊，鸡巴有点硬了呢" },
          { role: "assistant", content: "哈啊……主人想Remi了……骚屄一下子就湿透了呢……" },
        ],
        slowBrainSnapshot: makeSnapshot(),
        inputSource: "text",
        adultSceneState: {
          mode: "explicit",
          allowedExplicit: true,
          initiatedByUser: true,
          turnsSinceLastExplicitCue: 0,
          cooldownOrBoundaryHit: false,
          explicitCueStreak: 2,
          beat: "sustain",
          intensity: "explicit",
          style: "fantasy_execute",
          executionPlan: null,
        },
      });

      assert.ok(result);
      assert.equal(result.interpretation.adultIntent, "explicit_scene_continue");
      assert.equal(result.interpretation.userAct, "scene_continue");
      assert.equal(result.policy.openingMove, "scene_ack");
    } finally {
      restoreEnv();
    }
  });
});
