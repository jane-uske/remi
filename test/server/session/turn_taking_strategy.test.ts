const assert = require("assert").strict;

const {
  decideTurnTaking,
} = require("../../../server/session/turn_taking");

function makeInput(overrides = {}) {
  return {
    baseGapMs: 180,
    previewText: "",
    nowMs: 2000,
    lastPartialUpdateAt: 1000,
    lastGrowthAt: 1000,
    hesitationHoldMs: 980,
    growthHoldMs: 720,
    likelyStableMs: 680,
    confirmedStableMs: 1100,
    releaseMs: 60,
    minGapMs: 80,
    ...overrides,
  };
}

describe("turn taking strategy", () => {
  it("keeps HOLD for clause-break tails even when the partial looks stable", () => {
    const decision = decideTurnTaking(
      makeInput({
        previewText: "我先说一个重点，",
        lastPartialUpdateAt: 500,
        lastGrowthAt: 500,
      }),
    );

    assert.equal(decision.state, "HOLD");
    assert.equal(decision.gapMs, 720);
    assert.equal(decision.reasons.includes("clause_break_tail"), true);
  });

  it("keeps HOLD for open tails during thinking pauses", () => {
    const decision = decideTurnTaking(
      makeInput({
        previewText: "然后我想",
        lastPartialUpdateAt: 500,
        lastGrowthAt: 500,
      }),
    );

    assert.equal(decision.state, "HOLD");
    assert.equal(decision.reasons.includes("open_clause_tail"), true);
  });

  it("releases faster for semantically complete endings without punctuation", () => {
    const decision = decideTurnTaking(
      makeInput({
        previewText: "这样可以吗",
        lastPartialUpdateAt: 1200,
        lastGrowthAt: 1200,
      }),
    );

    assert.equal(decision.state, "LIKELY_END");
    assert.equal(decision.semanticallyComplete, true);
    assert.equal(decision.sentenceClosed, false);
    assert.equal(decision.gapMs, 120);
  });

  it("lets short carry-forward utterances respond quickly once stable", () => {
    const decision = decideTurnTaking(
      makeInput({
        previewText: "回到刚才那个",
        lastPartialUpdateAt: 1200,
        lastGrowthAt: 1100,
      }),
    );

    assert.equal(decision.state, "LIKELY_END");
    assert.equal(decision.gapMs, 80);
    assert.equal(decision.reasons.includes("carry_forward_cue"), true);
  });

  it("lets short correction utterances respond quickly once stable after interruption", () => {
    const decision = decideTurnTaking(
      makeInput({
        previewText: "我的意思是昨晚其实没睡着",
        lastPartialUpdateAt: 1200,
        lastGrowthAt: 1100,
        growthPlateauMs: 900,
        interruptionType: "correction",
      }),
    );

    assert.equal(decision.state, "LIKELY_END");
    assert.equal(decision.gapMs, 80);
    assert.equal(decision.reasons.includes("correction_cue"), true);
  });

  it("releases faster for a topic-switching sentence once it is semantically complete", () => {
    const decision = decideTurnTaking(
      makeInput({
        previewText: "先不说这个，我们换个话题吧",
        lastPartialUpdateAt: 1200,
        lastGrowthAt: 1100,
        interruptionType: "topic_switch",
      }),
    );

    assert.equal(decision.state, "LIKELY_END");
    assert.equal(decision.reasons.includes("interruption:topic_switch"), true);
  });

  it("can release topic_switch with semantic completion streak even without explicit ending", () => {
    const decision = decideTurnTaking(
      makeInput({
        previewText: "先不说这个我们换个方向聊",
        lastPartialUpdateAt: 1200,
        lastGrowthAt: 1100,
        interruptionType: "topic_switch",
        semanticCompletionStreak: 2,
      }),
    );

    assert.equal(decision.state, "LIKELY_END");
    assert.equal(decision.reasons.includes("semantic_completion_streak:2"), true);
  });

  it("still holds a semantic ending that is clearly expanding quickly", () => {
    const decision = decideTurnTaking(
      makeInput({
        previewText: "这样说也可以吗",
        lastPartialUpdateAt: 1500,
        lastGrowthAt: 1500,
        recentGrowthChars: 5,
        growthPlateauCount: 0,
      }),
    );

    assert.equal(decision.state, "HOLD");
    assert.equal(decision.reasons.includes("recent_growth"), true);
  });

  it("lets a correction release once partial growth has plateaued over small increments", () => {
    const decision = decideTurnTaking(
      makeInput({
        previewText: "不是那个意思，我是想说昨晚还是没睡着",
        lastPartialUpdateAt: 1400,
        lastGrowthAt: 1500,
        recentGrowthChars: 1,
        growthPlateauCount: 3,
        interruptionType: "correction",
      }),
    );

    assert.equal(decision.state, "LIKELY_END");
    assert.equal(decision.reasons.includes("partial_growth_plateau"), true);
  });

  it("keeps a semantically complete question on HOLD when prosody suggests the user is still rising", () => {
    const decision = decideTurnTaking(
      makeInput({
        previewText: "这样可以吗",
        lastPartialUpdateAt: 1120,
        lastGrowthAt: 1050,
        prosody: {
          reliable: true,
          voicedRatio: 0.75,
          voicedTailFrames: 4,
          pitchFrames: 4,
          pitchConfidence: 0.82,
          pitchSlopeHz: 28,
          tailEnergyDrop: 0.001,
          risingTail: true,
          fallingTail: false,
          sustainedVoicedTail: true,
        },
      }),
    );

    assert.equal(decision.state, "HOLD");
    assert.equal(decision.primaryReason, "prosody_hold_rising_tail");
    assert.equal(decision.prosodyApplied, "prosody_hold_rising_tail");
  });

  it("releases a punctuated close earlier when prosody shows a falling tail and energy drop", () => {
    const decision = decideTurnTaking(
      makeInput({
        previewText: "我今天就先说到这里。",
        lastPartialUpdateAt: 1400,
        lastGrowthAt: 1200,
        prosody: {
          reliable: true,
          voicedRatio: 0.8,
          voicedTailFrames: 4,
          pitchFrames: 4,
          pitchConfidence: 0.84,
          pitchSlopeHz: -22,
          tailEnergyDrop: 0.012,
          risingTail: false,
          fallingTail: true,
          sustainedVoicedTail: true,
        },
      }),
    );

    assert.equal(decision.state, "LIKELY_END");
    assert.equal(decision.primaryReason, "prosody_fast_release");
    assert.equal(decision.prosodyApplied, "prosody_fast_release");
    assert.equal(decision.gapMs, 80);
  });

  it("falls back to the baseline decision when prosody is unreliable", () => {
    const decision = decideTurnTaking(
      makeInput({
        previewText: "这样可以吗",
        lastPartialUpdateAt: 1120,
        lastGrowthAt: 1050,
        prosody: {
          reliable: false,
          voicedRatio: 0.2,
          voicedTailFrames: 1,
          pitchFrames: 0,
          pitchConfidence: 0.18,
          pitchSlopeHz: null,
          tailEnergyDrop: null,
          risingTail: true,
          fallingTail: false,
          sustainedVoicedTail: false,
        },
      }),
    );

    assert.equal(decision.state, "LIKELY_END");
    assert.equal(decision.primaryReason, "semantic_end_cue");
    assert.equal(decision.prosodyApplied, null);
  });

  it("documents the no-preview fallback path", () => {
    const decision = decideTurnTaking(
      makeInput({
        previewText: "录音中… 1.2s",
        lastPartialUpdateAt: 0,
        lastGrowthAt: 0,
      }),
    );

    assert.equal(decision.state, "CONFIRMED_END");
    assert.equal(decision.usedFallback, true);
    assert.deepEqual(decision.reasons, ["fallback:no_partial"]);
  });
});
