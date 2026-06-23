const assert = require("assert").strict;
const { decideTurnTaking } = require("../../../server/session/turn_taking");
const {
  resolveTurnDetector,
  LegacyVadTurnDetector,
  __resetTurnDetectorForTest,
} = require("../../../server/session/voice/turn_detector");

function makeInput(overrides = {}) {
  return {
    baseGapMs: 300,
    previewText: "我今天有点累",
    nowMs: 10_000,
    lastPartialUpdateAt: 9_000,
    lastGrowthAt: 9_000,
    hesitationHoldMs: 600,
    growthHoldMs: 500,
    likelyStableMs: 480,
    confirmedStableMs: 800,
    releaseMs: 120,
    minGapMs: 80,
    ...overrides,
  };
}

describe("LegacyVadTurnDetector (phase 1 seam)", () => {
  it("evaluateTurnEnd 与 decideTurnTaking 逐字段一致（1:1 包装）", () => {
    const detector = new LegacyVadTurnDetector();
    const cases = [
      makeInput(),
      makeInput({ previewText: "然后呢" }),
      makeInput({ previewText: "我觉得吧，" }),
      makeInput({ previewText: "" }),
      makeInput({
        previewText: "好的。",
        nowMs: 12_000,
        lastPartialUpdateAt: 10_000,
        lastGrowthAt: 10_000,
      }),
      makeInput({ previewText: "嗯", interruptionType: "emotional_interrupt" }),
    ];
    for (const input of cases) {
      assert.deepEqual(
        detector.evaluateTurnEnd(input),
        decideTurnTaking(input),
        `mismatch for preview="${input.previewText}"`,
      );
    }
  });

  it("evaluateBargeIn 镜像现有 confirm 判据（不新增阈值）", () => {
    const d = new LegacyVadTurnDetector();
    // assistant 未在说话/管线未活跃 → 无 barge-in 语境
    assert.equal(
      d.evaluateBargeIn({ assistantActive: false, speechDurationMs: 999, minSpeechMs: 260, hasReliableEvidence: true }).decision,
      "none",
    );
    // 时长不足 → 仅候选
    assert.equal(
      d.evaluateBargeIn({ assistantActive: true, speechDurationMs: 100, minSpeechMs: 260, hasReliableEvidence: true }).decision,
      "candidate",
    );
    // 时长够但证据不足 → 仅候选
    assert.equal(
      d.evaluateBargeIn({ assistantActive: true, speechDurationMs: 300, minSpeechMs: 260, hasReliableEvidence: false }).decision,
      "candidate",
    );
    // 时长够且证据足 → 确认（等价 speechDurationMs>=min && reliable）
    assert.equal(
      d.evaluateBargeIn({ assistantActive: true, speechDurationMs: 300, minSpeechMs: 260, hasReliableEvidence: true }).decision,
      "confirmed",
    );
  });

  it("resolveTurnDetector 默认 legacy，未知 provider 回退 legacy", () => {
    const prev = process.env.REMI_TURN_DETECTOR;
    try {
      delete process.env.REMI_TURN_DETECTOR;
      __resetTurnDetectorForTest();
      assert.equal(resolveTurnDetector().id, "legacy");

      process.env.REMI_TURN_DETECTOR = "pipecat_smartturn";
      __resetTurnDetectorForTest();
      assert.equal(resolveTurnDetector().id, "legacy");
    } finally {
      if (prev === undefined) delete process.env.REMI_TURN_DETECTOR;
      else process.env.REMI_TURN_DETECTOR = prev;
      __resetTurnDetectorForTest();
    }
  });
});
