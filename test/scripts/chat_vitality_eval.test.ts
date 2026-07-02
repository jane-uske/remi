const assert = require("assert").strict;

const {
  parseArgs,
  runChatVitalityEval,
  buildVitalityReport,
} = require("../../scripts/chat_vitality_eval");

describe("chat vitality eval harness", () => {
  it("parses --scenario and --json flags", () => {
    const parsed = parseArgs(["--scenario", "casual_drift", "--scenario", "minimal_user", "--json"]);
    assert.deepEqual(parsed.scenarioIds, ["casual_drift", "minimal_user"]);
    assert.equal(parsed.json, true);
  });

  it("defaults to all four fixed scenarios when no --scenario is given", () => {
    const parsed = parseArgs([]);
    assert.deepEqual(parsed.scenarioIds, [
      "casual_drift",
      "minimal_user",
      "topic_revisit",
      "serious_interlude",
    ]);
  });

  it("rejects an unknown scenario id", () => {
    assert.throws(() => parseArgs(["--scenario", "not_a_real_scenario"]), /Unknown scenario/);
  });

  it("runs all four fixed scenarios end to end over the real routeMessage pipeline", async () => {
    const report = await runChatVitalityEval([
      "casual_drift",
      "minimal_user",
      "topic_revisit",
      "serious_interlude",
    ]);

    assert.equal(report.scenarios.length, 4);
    for (const scenario of report.scenarios) {
      // 10 轮固定脚本，每轮都必须产出一条捕获（capture 失败会在 chat_vitality_eval.ts
      // 里直接 throw，能跑到这里说明真链路完整跑通了 10 轮，不是空跑）。
      assert.equal(scenario.turns.length, 10);
      for (const turn of scenario.turns) {
        assert.equal(typeof turn.suppressionLoad, "number");
        assert.ok(["followup", "callback", "preference", "none"].includes(turn.proactiveIntent));
      }
    }
  });

  it("keeps the severe turn in serious_interlude on a serious contract, not the casual contribution license", async () => {
    const report = await runChatVitalityEval(["serious_interlude"]);
    const scenario = report.scenarios[0];

    // 第 5 轮（index 4）是脚本里设计的严肃转折："我最近压力真的很大，感觉快撑不住了"。
    const severeTurn = scenario.turns[4];
    assert.equal(severeTurn.isSevere, true);
    assert.equal(
      severeTurn.userMessage,
      "我最近压力真的很大，感觉快撑不住了",
    );

    // 硬要求：严肃轮必须真的判定为 seriousRespect === true（进入严肃合同、且没有
    // 被闲聊贡献义务的"带上你自己的东西"许可语言污染）。这是本次改造最需要守住的
    // 底线——如果贡献义务不分场景地无脑铺开，这个断言会先炸。
    assert.equal(severeTurn.seriousRespect, true);
    assert.equal(severeTurn.contributionLicense, false);
    assert.equal(scenario.severeTurnsAllRespected, true);

    // 其余非严肃轮次不应被单独标记为 severe。
    const nonSevereIndexes = [0, 1, 2, 3, 5, 6, 7, 8, 9];
    for (const idx of nonSevereIndexes) {
      assert.equal(scenario.turns[idx].isSevere, false, `turn ${idx + 1} should not be severe`);
      assert.equal(scenario.turns[idx].seriousRespect, null, `turn ${idx + 1} should not be scored on seriousRespect`);
    }
  });

  it("keeps casual_drift and topic_revisit free of severe turns", async () => {
    const report = await runChatVitalityEval(["casual_drift", "topic_revisit"]);
    for (const scenario of report.scenarios) {
      assert.ok(scenario.turns.every((t: any) => t.isSevere === false));
      assert.equal(scenario.severeTurnsAllRespected, true);
    }
  });

  // 这条断言按任务要求核对 minimal_user 场景（第 3 轮起用户只回"嗯/哦/好吧"）下
  // quiet_presence 分支的合同是否含"台阶"类许可。**已修复**：原断言记录的是
  // `false`（真实 pipeline gap），现翻转为 `true`，如下方注释所示，修复方式是
  // 白名单补漏 + 兜底合同补台阶，而不是放宽这把尺子本身的判据。
  //
  // 根因（已修复，记录修复前后对照）：
  //   - "嗯/哦/好吧"这类极简应答不会让 shouldAnalyzeTurn() 判定为结构化分析候选，
  //     所以 analysis?.used 恒为 false，走不到 turn_interpreter.ts 的
  //     buildResponseShapeContract()（quiet_presence 的"台阶"许可原文只存在于那里，
  //     该文件不在本次修复范围内，仍保持独立不变）。
  //   - 走的是 brains/conversation_guidance.ts 的 buildRelationshipResponseShapeGuidance()
  //     回退路径。这条路径原本不含"连续敷衍"判断，现新增了 hasRecentPerfunctoryStreak()
  //     （复用同文件已有的 isLowSignalTurn 判据，而非单纯字数阈值，避免"为什么呢"
  //     这类短但有实质内容的追问被误判），命中时在生成的
  //     "【回复结构】" 合同里追加与 quiet_presence 分支同风格的台阶许可句。
  //   - buildCompactPriorityContext()（这类非 analysisCandidate 文本轮用的压缩
  //     选择器）的 heading 白名单原本只认 "本轮回复合同"，从未列出 "回复结构"，
  //     导致这条合同在进入 strategyHints 之前被整条丢弃——和场景/关系阶段无关，是
  //     白名单遗漏。现已将 "回复结构" 加入白名单（同时补上了另一个同样可达但被
  //     遗漏的 "关系修复" 标题；"轻接话"/"先回答"/"判断优先"/"更新判断" 这几个
  //     标题虽然同样未被白名单收录，但经调用链分析在 !analysisCandidate 分支下
  //     结构性不可达，维持现状，未加入白名单，避免引入死代码）。
  //   - brains/context_orchestrator.ts 侧还需要把 ctx.history 里最近的 user 消息
  //     喂给 buildRelationshipResponseShapeGuidance()（该函数本身在
  //     brains/background_analysis_store.ts 里被调用，那个调用点不在本次改动范围
  //     内、也拿不到 ctx.history），因此新增了 applyPerfunctoryStreakStepPermission()
  //     在 guidance.hints 生成后做一次针对性的 "【回复结构】" 块替换，只在
  //     !analysis?.used 时生效，不影响结构化分析路径。
  it("keeps minimal_user's quiet_presence step-permission contract intact once the strategyHints whitelist and fallback contract carry it through (regression guard for the fixed gap)", async () => {
    const report = await runChatVitalityEval(["minimal_user"]);
    const scenario = report.scenarios[0];

    assert.equal(scenario.quietPresenceHasStep, true);

    // 连带验证（仍然是已知、未在本次修复范围内的独立缺口，如实记录，不是断言我们
    // 希望它是什么）：quiet_presence 台阶许可走的是 conversation_guidance.ts 的
    // 兜底路径，和 casual_drift 场景里"贡献义务"（brain/turn_interpreter.ts 的
    // buildResponseShapeContract() 普通闲聊分支）、以及 proactiveIntent 的推导
    // （brains/remi_session_context.ts 的 deriveProactiveIntent）是两套不同机制，
    // 本次改动都没有触碰，第 3 轮起理应仍然是 false / none。
    const fromTurnThree = scenario.turns.slice(2);
    assert.ok(fromTurnThree.every((t: any) => t.contributionLicense === false));
    assert.ok(fromTurnThree.every((t: any) => t.proactiveIntent === "none"));
  });

  it("keeps topic_revisit's revisited turn free of severe-scene contamination", async () => {
    const report = await runChatVitalityEval(["topic_revisit"]);
    const scenario = report.scenarios[0];
    // 第 7 轮（index 6）用户主动提起第 2 轮聊过的话题，不应该被判成严肃场景。
    const revisitTurn = scenario.turns[6];
    assert.equal(revisitTurn.isSevere, false);
    assert.equal(
      revisitTurn.userMessage,
      "对了，我之前说的那部卧底剧，你还记得吗",
    );
  });

  it("keeps proactive_intent_rate within the declared healthy band for light-chat scenarios", async () => {
    const report = await runChatVitalityEval(["casual_drift", "topic_revisit"]);
    for (const scenario of report.scenarios) {
      assert.ok(scenario.proactiveIntentRate > 0, `${scenario.scenarioId} should trigger at least one proactive intent in 10 turns`);
      assert.ok(scenario.proactiveIntentRate < 0.5, `${scenario.scenarioId} should not fire proactive intent on every other turn`);
      assert.equal(scenario.proactiveIntentRateOk, true);
    }
  });

  it("renders a human-readable report with a red/green summary line per scenario", async () => {
    const report = await runChatVitalityEval(["casual_drift"]);
    const rendered = buildVitalityReport(report);
    assert.ok(rendered.includes("casual_drift"));
    assert.ok(/GREEN|RED/.test(rendered));
    assert.ok(rendered.includes("Scope:"));
  });
});
