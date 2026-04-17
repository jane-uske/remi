const assert = require("assert").strict;

const {
  buildToneContract,
  reviewReplyTone,
  detectDecisionSeekingSignal,
  detectAnswerNowSignal,
} = require("../../brain/tone_policy");

describe("tone policy", () => {
  it("builds a tone contract that explicitly suppresses assistanty openings", () => {
    const contract = buildToneContract({
      relationshipStage: "建立关系期",
      userMessage: "我有点委屈",
      shortInput: true,
      negativeEmotionalContext: true,
    });

    assert.ok(contract.includes("像真人接话"));
    assert.ok(contract.includes("少用这些开头"));
    assert.ok(contract.includes("别急着讲道理"));
    assert.ok(contract.includes("不要条件反射地抛主持式追问"));
  });

  it("flags a reply with host-like and customer-service phrasing as assistanty", () => {
    const review = reviewReplyTone(
      "如果你愿意的话，我可以继续陪你聊聊。要不要我陪你一起想象一下那个画面？",
    );

    assert.equal(review.assistanty, true);
    assert.ok(review.score >= 3);
    assert.ok(review.reasons.includes("主持式邀请"));
    assert.ok(review.reasons.includes("客服式让渡"));
  });

  it("does not flag a short in-scene continuation as assistanty", () => {
    const review = reviewReplyTone("嗯，我牵着你，沿着湖边慢慢走。");

    assert.equal(review.assistanty, false);
    assert.equal(review.score, 0);
  });

  it("detects decision-seeking and answer-now user messages", () => {
    assert.equal(detectDecisionSeekingSignal("你觉得我是不是需要换个老板呢"), true);
    assert.equal(detectDecisionSeekingSignal("今晚吃什么"), false);
    assert.equal(detectAnswerNowSignal("我在问你呢，你怎么老是问我"), true);
    assert.equal(detectAnswerNowSignal("不要一直问我，我成了你的助手了"), true);
    assert.equal(detectAnswerNowSignal("你又不会帮我做，然后一直问我问题，让我梳理"), true);
    assert.equal(detectAnswerNowSignal("你说"), true);
    assert.equal(detectAnswerNowSignal("你还在吗"), false);
  });
});
