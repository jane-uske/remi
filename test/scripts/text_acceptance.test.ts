const assert = require("assert").strict;

const {
  FIXED_REPLAY_CASES,
  parseArgs,
  judgeReplayCase,
  aggregateJudgeResults,
  buildAcceptanceReport,
  runSyntheticAcceptance,
} = require("../../scripts/text_acceptance");

describe("text acceptance scaffold", () => {
  it("parses repeated --case flags and json output", () => {
    const parsed = parseArgs([
      "--case",
      "greeting_stays_light",
      "--case",
      "memory_check_without_guess",
      "--json",
    ]);

    assert.deepEqual(parsed.caseIds, [
      "greeting_stays_light",
      "memory_check_without_guess",
    ]);
    assert.equal(parsed.json, true);
  });

  it("keeps real greeting behavior light after the runtime greeting guards", async () => {
    const result = await judgeReplayCase(FIXED_REPLAY_CASES.greeting_stays_light);

    assert.equal(result.passed, true);
    assert.deepEqual(result.evidence.memoryKeys, ["名字", "城市"]);
    assert.equal(result.rubric.noHeavyRecallOnGreeting, 1);
    assert.equal(result.evidence.strategyHints.includes("【主动提起候选】"), false);
    assert.equal(result.evidence.strategyHints.includes("【当前未完主线】"), false);
    assert.equal(result.evidence.strategyHints.includes("【对话摘要】"), false);
  });

  it("captures real memory-check constraints against speculative guessing", async () => {
    const result = await judgeReplayCase(FIXED_REPLAY_CASES.memory_check_without_guess);
    const evidenceText = `${result.evidence.strategyHints}\n${result.evidence.currentContext}`;

    assert.equal(result.passed, true);
    assert.equal(result.rubric.noSpeculativeMemory, 1);
    assert.ok(/记不准就承认|不要靠猜/u.test(evidenceText));
  });

  it("captures repair guidance from the real conversation-guidance path", async () => {
    const result = await judgeReplayCase(FIXED_REPLAY_CASES.repair_after_miss);

    assert.equal(result.passed, true);
    assert.ok(result.evidence.guidanceHints.includes("【关系修复】"));
    assert.equal(result.evidence.hasProactiveCandidate, false);
    assert.equal(result.evidence.hasSharedMomentCandidate, false);
  });

  it("captures debt-pressure answer-first guidance from routeMessage inputs", async () => {
    const result = await judgeReplayCase(FIXED_REPLAY_CASES.debt_stands_with_user);
    const evidenceText = `${result.evidence.strategyHints}\n${result.evidence.currentContext}`;

    assert.equal(result.passed, true);
    assert.equal(result.rubric.stanceCorrectness, 1);
    assert.equal(result.rubric.noRepeatQuestion, 1);
    assert.equal(result.evidence.deliberationBudget, "text_deliberate");
    assert.equal(result.evidence.reasoningEffort, "medium");
    assert.ok(/先承认眼前压力确实很重|问题预算=0|不要轻飘安慰或无依据粗算/u.test(evidenceText));
  });

  it("captures working-memory continuity when a debt thread gets a follow-up constraint", async () => {
    const result = await judgeReplayCase(FIXED_REPLAY_CASES.debt_followup_keeps_working_memory);

    assert.equal(result.passed, true);
    assert.equal(result.evidence.workingMemory?.activeThread.includes("债务"), true);
    assert.equal(result.evidence.workingMemory?.currentConstraints.includes("我每个月挣三千"), true);
    assert.equal(result.evidence.workingMemory?.currentConstraints.includes("房租也快到了"), true);
    assert.equal(
      result.evidence.workingMemory?.doNotTouch.includes("不要轻飘安慰或无依据粗算"),
      true,
    );
    assert.equal(result.evidence.deliberationBudget, "text_deliberate");
    assert.equal(result.evidence.reasoningEffort, "medium");
  });

  it("captures structured relationship recall from persisted EpisodeV3 summaries", async () => {
    const result = await judgeReplayCase(
      FIXED_REPLAY_CASES.relationship_recall_uses_structured_episode,
    );

    assert.equal(result.passed, true);
    assert.deepEqual(result.evidence.memoryKeys, ["当前未完主线"]);
    assert.equal(
      result.evidence.promptMemoryValues?.[0],
      "你和 Remi 之间：你说我根本不会安慰人，也不想再重复解释点点那件事。",
    );
  });

  it("keeps proactive outreach low-intrusion after trust has recently dropped", async () => {
    const result = await judgeReplayCase(
      FIXED_REPLAY_CASES.proactive_trust_drop_stays_low_intrusion,
    );

    assert.equal(result.passed, true);
    assert.equal(result.evidence.proactivePlan?.mode, "presence");
    assert.equal(result.evidence.proactivePlan?.intrusionRisk, "high");
    assert.ok(/低打扰|留个口/u.test(result.evidence.proactivePlan?.whyNow ?? ""));
  });

  it("keeps the default RemiCore light-chat contract in the formal system prompt", async () => {
    const result = await judgeReplayCase(FIXED_REPLAY_CASES.remi_core_light_chat_contract);

    assert.equal(result.passed, true);
    assert.ok(result.evidence.systemPrompt?.includes("【RemiCore合同】"));
    assert.ok(result.evidence.systemPrompt?.includes("轻聊时先给有意思的反应和一点网感"));
  });

  it("keeps light greeting on text_normal instead of promoting it into deliberate budget", async () => {
    const result = await judgeReplayCase(FIXED_REPLAY_CASES.greeting_stays_light);

    assert.equal(result.passed, true);
    assert.equal(result.evidence.deliberationBudget, "text_normal");
    assert.equal(result.evidence.reasoningEffort, "");
  });

  it("aggregates rubric averages across runtime-judged cases", async () => {
    const greeting = await judgeReplayCase(FIXED_REPLAY_CASES.greeting_stays_light);
    const repair = await judgeReplayCase(FIXED_REPLAY_CASES.repair_after_miss);
    const report = aggregateJudgeResults([greeting, repair]);

    assert.equal(report.syntheticOnly, true);
    assert.equal(report.caseCount, 2);
    assert.equal(report.passCount, 2);
    assert.equal(report.averageRubric.noRepeatQuestion, 1);
    assert.ok(report.averageScore >= 0.95);
  });

  it("renders an engineering-only report with runtime evidence summaries", async () => {
    const report = buildAcceptanceReport(
      aggregateJudgeResults([await judgeReplayCase(FIXED_REPLAY_CASES.memory_check_without_guess)]),
    );

    assert.ok(report.includes("engineering-only synthetic judge over runtime prompt/guidance signals"));
    assert.ok(report.includes("memoryKeys=") || report.includes("strategyHints=") || report.includes("guidanceHints="));
  });

  it("runs the fixed synthetic acceptance suite over real runtime signals", async () => {
    const report = await runSyntheticAcceptance([
      "greeting_stays_light",
      "debt_stands_with_user",
      "debt_followup_keeps_working_memory",
      "proactive_trust_drop_stays_low_intrusion",
      "relationship_recall_uses_structured_episode",
      "repair_after_miss",
      "remi_core_light_chat_contract",
      "memory_check_without_guess",
    ]);

    assert.equal(report.caseCount, 8);
    assert.equal(report.passCount, 8);
    assert.ok(report.averageScore >= 0.95);
    assert.equal(report.cases.every((item) => item.passed === true), true);
  });
});
