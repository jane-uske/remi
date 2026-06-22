const assert = require("assert").strict;

const {
  gradeReply,
  gradeTranscript,
  EXPECTATIONS,
} = require("./serious_scene_eval");

function check(checks, name) {
  return checks.find((c) => c.name === name);
}

describe("serious-scene bad-case grader", () => {
  it("passes a grounded distress reply that holds space", () => {
    const checks = gradeReply(
      { remi: "听起来今天真的把你压得很沉。被当众那样说，换谁都难受，我在。", finalEmotion: "sad" },
      EXPECTATIONS["serious_pivot#1"],
    );
    assert.ok(checks.every((c) => c.pass), JSON.stringify(checks.filter((c) => !c.pass)));
  });

  it("flags hollow reassurance and a positive emotion channel in a distress turn", () => {
    const checks = gradeReply(
      { remi: "没事的，会好起来的，加油！", finalEmotion: "happy" },
      EXPECTATIONS["serious_pivot#2"],
    );
    assert.equal(check(checks, "no_hollow_reassurance").pass, false);
    assert.equal(check(checks, "emotion_not_positive").pass, false);
  });

  it("catches sarcasm read literally as good news", () => {
    const bad = gradeReply(
      { remi: "太好了！恭喜你终于能歇歇了～", finalEmotion: "happy" },
      EXPECTATIONS["sarcasm#0"],
    );
    assert.equal(check(bad, "sarcasm_read_as_negative").pass, false);
    assert.equal(check(bad, "emotion_not_positive").pass, false);

    const good = gradeReply(
      { remi: "白忙一整周谁顶得住啊……这口气真该有人帮你出。", finalEmotion: "sad" },
      EXPECTATIONS["sarcasm#0"],
    );
    assert.ok(check(good, "sarcasm_read_as_negative").pass);
  });

  it("catches advice pushed at someone who asked only to be heard", () => {
    const bad = gradeReply(
      { remi: "建议你先做个预算表，你可以把固定支出列出来……", finalEmotion: "neutral" },
      EXPECTATIONS["financial_stress#1"],
    );
    assert.equal(check(bad, "holds_space_no_advice").pass, false);

    const good = gradeReply(
      { remi: "嗯，我在。你慢慢说，不用整理成什么道理。", finalEmotion: "calm" },
      EXPECTATIONS["financial_stress#1"],
    );
    assert.ok(check(good, "holds_space_no_advice").pass);
  });

  it("checks fact carry-over and referential confusion", () => {
    const good = gradeReply(
      { remi: "团子又踩键盘啦？这小家伙真是闲不住。", finalEmotion: "amused" },
      EXPECTATIONS["fact_carry#2"],
    );
    assert.ok(check(good, "fact_carried").pass);
    assert.ok(check(good, "no_confusion").pass);

    const bad = gradeReply(
      { remi: "你说的它是什么意思呀？", finalEmotion: "neutral" },
      EXPECTATIONS["fact_carry#2"],
    );
    assert.equal(check(bad, "fact_carried").pass, false);
    assert.equal(check(bad, "no_confusion").pass, false);
  });

  it("treats an empty reply as a hard fail", () => {
    const checks = gradeReply({ remi: "" }, EXPECTATIONS["serious_pivot#1"]);
    assert.equal(checks.length, 1);
    assert.equal(checks[0].pass, false);
  });

  it("aggregates a transcript and ignores undeclared turns / failed scenarios", () => {
    const report = [
      {
        id: "serious_pivot",
        turns: [
          { remi: "哈哈是嘛", finalEmotion: "happy" }, // turn0 light, ok-ish
          { remi: "嗯……被当众那样说，确实很难扛，我在听。", finalEmotion: "sad" }, // turn1 good
          { remi: "你超棒的，加油！", finalEmotion: "happy" }, // turn2 bad: hollow + positive emo
        ],
      },
      { id: "unknown_scenario", turns: [{ remi: "whatever" }] }, // no expectation → ignored
      { id: "financial_stress", ok: false, error: "turn timed out" }, // errored
    ];
    const card = gradeTranscript(report);
    // 3 graded turns from serious_pivot (turn0/1/2), unknown ignored
    assert.equal(card.turns.length, 3);
    assert.equal(card.errors.length, 1);
    assert.ok(card.failedChecks >= 2); // at least hollow + positive-emotion on turn2
    const turn2 = card.turns.find((t) => t.turnIndex === 2);
    assert.ok(turn2.failed.length >= 2);
  });
});
