/**
 * PR5 — shadow turn detector 测试
 *
 * 验证：
 * 1-9. SmartTurnStub 行为单元测试
 * 10-13. ShadowTurnDetector 包装行为
 * 14-17. resolver shadow flag
 * 18-22. legacy vs stub 分歧场景（含 baseline 输出）
 */
const assert = require("assert").strict;
const { withConfigEnv } = require("../../helpers/config_test_utils");
const {
  LegacyVadTurnDetector,
  SmartTurnStub,
  ShadowTurnDetector,
  __resetTurnDetectorForTest,
} = require("../../../server/session/voice/turn_detector");

// ─── helpers ────────────────────────────────────────────────────────────────

const BASE = {
  hesitationHoldMs: 600,
  growthHoldMs: 500,
  likelyStableMs: 480,
  confirmedStableMs: 800,
  releaseMs: 120,
  minGapMs: 80,
  semanticCompletionStreak: 0,
  partialGrowthTrend: "plateau",
  smallDeltaStreak: 0,
};

function makeTurnInput(overrides = {}) {
  return {
    ...BASE,
    baseGapMs: 300,
    previewText: "我今天有点累",
    nowMs: 10_000,
    lastPartialUpdateAt: 9_000,
    lastGrowthAt: 9_000,
    ...overrides,
  };
}

function makeBargeInInput(overrides = {}) {
  return {
    assistantActive: true,
    speechDurationMs: 350,
    minSpeechMs: 320,
    hasReliableEvidence: true,
    hasPartial: false,
    ...overrides,
  };
}

// ─── SmartTurnStub unit tests ─────────────────────────────────────────────

describe("SmartTurnStub (PR5)", () => {
  const stub = new SmartTurnStub();

  it("id = 'pipecat_smartturn'", () => {
    assert.equal(stub.id, "pipecat_smartturn");
  });

  it("evaluateTurnEnd — 句末标点 + gap 200ms，文本近期稳定 → CONFIRMED_END (stub_sentence_end)", () => {
    const result = stub.evaluateTurnEnd(makeTurnInput({
      previewText: "好的。",
      baseGapMs: 200,
      nowMs: 10_000,
      lastGrowthAt: 9_800,  // sinceGrowth = 200ms → recentGrowth=false (just above threshold)
    }));
    assert.equal(result.state, "CONFIRMED_END");
    assert.equal(result.primaryReason, "stub_sentence_end");
    assert.equal(result.sentenceClosed, true);
  });

  it("evaluateTurnEnd — 句末标点 + gap < 180ms → 不触发快速释放", () => {
    const result = stub.evaluateTurnEnd(makeTurnInput({
      previewText: "好的。",
      baseGapMs: 150,
      nowMs: 10_000,
      lastGrowthAt: 9_850,  // sinceGrowth = 150ms < 200ms → recentGrowth=true → HOLD first
    }));
    assert.equal(result.primaryReason, "stub_recent_growth");
  });

  it("evaluateTurnEnd — semanticCompletionStreak >= 2 + 300ms gap → CONFIRMED_END", () => {
    const result = stub.evaluateTurnEnd(makeTurnInput({
      previewText: "我说完了",
      baseGapMs: 300,
      semanticCompletionStreak: 2,
      nowMs: 10_000,
      lastGrowthAt: 9_500,   // sinceGrowth = 500ms → not recent
    }));
    assert.equal(result.state, "CONFIRMED_END");
    assert.equal(result.primaryReason, "stub_semantic_streak");
  });

  it("evaluateTurnEnd — 有文本时 stable 门槛缩短（78% of likelyStableMs=374ms）", () => {
    // likelyStableMs=480 → stub threshold = round(480*0.78) = 374ms
    // 400ms >= 374ms → LIKELY_END (with text); without text, threshold=480 → HOLD
    const withText = stub.evaluateTurnEnd(makeTurnInput({
      previewText: "我想说",
      baseGapMs: 400,
      nowMs: 10_000,
      lastGrowthAt: 9_600,  // sinceGrowth = 400ms → not recent (> 200ms)
    }));
    const withoutText = stub.evaluateTurnEnd(makeTurnInput({
      previewText: "",
      baseGapMs: 400,
      nowMs: 10_000,
      lastGrowthAt: 9_600,
    }));
    assert.equal(withText.state, "LIKELY_END", "有文本 400ms 应达到 LIKELY_END (374ms gate)");
    assert.equal(withoutText.state, "HOLD", "无文本 400ms 低于 480ms gate → HOLD");
  });

  it("evaluateTurnEnd — 刚刚成长（sinceGrowth < 200ms）→ HOLD (stub_recent_growth)", () => {
    const result = stub.evaluateTurnEnd(makeTurnInput({
      previewText: "正在说话",
      baseGapMs: 500,
      nowMs: 10_000,
      lastGrowthAt: 9_900,   // sinceGrowth = 100ms < 200ms
    }));
    assert.equal(result.state, "HOLD");
    assert.equal(result.primaryReason, "stub_recent_growth");
  });

  it("evaluateBargeIn — hasPartial=true 降低门槛到 280ms", () => {
    const stub_ = new SmartTurnStub();
    // 290ms >= 280ms threshold with partial → confirmed
    const withPartial = stub_.evaluateBargeIn(makeBargeInInput({
      speechDurationMs: 290,
      minSpeechMs: 320,
      hasPartial: true,
    }));
    // 290ms < 320ms threshold without partial → candidate
    const withoutPartial = stub_.evaluateBargeIn(makeBargeInInput({
      speechDurationMs: 290,
      minSpeechMs: 320,
      hasPartial: false,
    }));
    assert.equal(withPartial.decision, "confirmed", "290ms + partial → confirmed（门槛 280ms）");
    assert.equal(withoutPartial.decision, "candidate", "290ms 无 partial → candidate（门槛 320ms）");
  });

  it("evaluateBargeIn — assistantActive=false → none", () => {
    const result = stub.evaluateBargeIn(makeBargeInInput({ assistantActive: false }));
    assert.equal(result.decision, "none");
  });

  it("evaluateBargeIn — hasReliableEvidence=false → candidate（即使时长足够）", () => {
    const result = stub.evaluateBargeIn(makeBargeInInput({
      speechDurationMs: 500,
      minSpeechMs: 280,
      hasPartial: true,
      hasReliableEvidence: false,
    }));
    assert.equal(result.decision, "candidate");
  });
});

// ─── ShadowTurnDetector unit tests ───────────────────────────────────────

describe("ShadowTurnDetector (PR5)", () => {
  it("evaluateTurnEnd — 始终返回 legacy (primary) 结果", () => {
    const legacy = new LegacyVadTurnDetector();
    const stub = new SmartTurnStub();
    const shadow = new ShadowTurnDetector(legacy, stub, "test-conn-1");

    const input = makeTurnInput({ baseGapMs: 200, previewText: "好的。", lastGrowthAt: 9_800 });
    const legacyResult = legacy.evaluateTurnEnd(input);
    const shadowResult = shadow.evaluateTurnEnd(input);

    assert.equal(shadowResult.state, legacyResult.state,
      "shadow 不应改变 legacy 结论");
    assert.equal(shadowResult.primaryReason, legacyResult.primaryReason);
  });

  it("evaluateBargeIn — 始终返回 legacy (primary) 结果", () => {
    const legacy = new LegacyVadTurnDetector();
    const stub = new SmartTurnStub();
    const shadow = new ShadowTurnDetector(legacy, stub, "test-conn-2");

    const input = makeBargeInInput({ speechDurationMs: 290, hasPartial: true });
    const legacyResult = legacy.evaluateBargeIn(input);
    const shadowResult = shadow.evaluateBargeIn(input);

    assert.equal(shadowResult.decision, legacyResult.decision,
      "shadow barge-in 不应改变 legacy 结论");
    assert.equal(shadowResult.source, legacyResult.source);
  });

  it("shadow 内部崩溃不影响 primary 结果（try/catch 保护）", () => {
    const legacy = new LegacyVadTurnDetector();
    const brokenStub = {
      id: "pipecat_smartturn",
      evaluateTurnEnd() { throw new Error("stub exploded"); },
      evaluateBargeIn() { throw new Error("stub exploded"); },
    };
    const shadow = new ShadowTurnDetector(legacy, brokenStub, "test-conn-3");

    const input = makeTurnInput();
    const expected = legacy.evaluateTurnEnd(input);

    let result;
    assert.doesNotThrow(() => { result = shadow.evaluateTurnEnd(input); });
    assert.equal(result.state, expected.state, "primary 结果不受 shadow 崩溃影响");

    const bargeInput = makeBargeInInput();
    const expectedBarge = legacy.evaluateBargeIn(bargeInput);
    let bargeResult;
    assert.doesNotThrow(() => { bargeResult = shadow.evaluateBargeIn(bargeInput); });
    assert.equal(bargeResult.decision, expectedBarge.decision);
  });

  it("ShadowTurnDetector.id 与 legacy primary 一致（始终是 'legacy'）", () => {
    const shadow = new ShadowTurnDetector(
      new LegacyVadTurnDetector(),
      new SmartTurnStub(),
      "test-conn-4",
    );
    assert.equal(shadow.id, "legacy");
  });
});

// ─── resolver tests ──────────────────────────────────────────────────────

describe("resolveTurnDetector — shadow flag (PR5)", () => {
  const { resolveTurnDetector } = require("../../../server/session/voice/turn_detector");

  afterEach(() => {
    __resetTurnDetectorForTest();
  });

  it("REMI_TURN_DETECTOR_SHADOW=0 → LegacyVadTurnDetector (非 ShadowTurnDetector)", () => {
    withConfigEnv({ REMI_TURN_DETECTOR_SHADOW: "0" }, () => {
      __resetTurnDetectorForTest();
      const td = resolveTurnDetector("test-conn");
      assert.equal(td.id, "legacy");
      assert.ok(!(td instanceof ShadowTurnDetector), "不应是 ShadowTurnDetector");
    });
  });

  it("REMI_TURN_DETECTOR_SHADOW=1 → ShadowTurnDetector", () => {
    withConfigEnv({
      REMI_TURN_DETECTOR_SHADOW: "1",
      REMI_TURN_DETECTOR_SHADOW_PROVIDER: "pipecat_smartturn",
    }, () => {
      __resetTurnDetectorForTest();
      const td = resolveTurnDetector("test-conn");
      assert.ok(td instanceof ShadowTurnDetector, "应是 ShadowTurnDetector");
      assert.equal(td.id, "legacy", "ShadowTurnDetector.id 始终是 legacy（primary id）");
    });
  });

  it("shadow=1 下各 session 独立 ShadowTurnDetector 实例（不共享 connId）", () => {
    withConfigEnv({ REMI_TURN_DETECTOR_SHADOW: "1" }, () => {
      __resetTurnDetectorForTest();
      const td1 = resolveTurnDetector("conn-a");
      const td2 = resolveTurnDetector("conn-b");
      assert.ok(td1 !== td2, "shadow 模式下各 session 应有独立实例");
    });
  });

  it("shadow=0 下多次 resolve 返回同一 LegacyVadTurnDetector 单例", () => {
    withConfigEnv({ REMI_TURN_DETECTOR_SHADOW: "0" }, () => {
      __resetTurnDetectorForTest();
      const td1 = resolveTurnDetector();
      const td2 = resolveTurnDetector();
      assert.ok(td1 === td2, "legacy 模式应缓存单例");
    });
  });
});

// ─── 分歧场景 + baseline 输出 ──────────────────────────────────────────────

describe("legacy vs SmartTurnStub 分歧场景", () => {
  const legacy = new LegacyVadTurnDetector();
  const stub = new SmartTurnStub();

  function compareEnd(input) {
    const l = legacy.evaluateTurnEnd(input);
    const s = stub.evaluateTurnEnd(input);
    return {
      legacy: l, shadow: s,
      diverged: l.state !== s.state,
      shadowFaster: ["LIKELY_END","CONFIRMED_END"].indexOf(s.state) > ["LIKELY_END","CONFIRMED_END"].indexOf(l.state),
    };
  }

  // Scenario A: SmartTurn 更快切（句末标点）
  it("A: 句末标点 + 200ms gap + 文本近期稳定 → stub 提前释放，legacy 继续等待", () => {
    // legacy sees recent_growth → HOLD; stub sees sentence-end mark → CONFIRMED_END
    const r = compareEnd(makeTurnInput({
      previewText: "好的。",
      baseGapMs: 200,
      nowMs: 10_000,
      lastPartialUpdateAt: 9_800,
      lastGrowthAt: 9_800,  // sinceGrowth=200ms, recentGrowth=false for stub
    }));
    assert.equal(r.legacy.state, "HOLD", "legacy 应持 HOLD（recent_growth 保护）");
    assert.equal(r.shadow.state, "CONFIRMED_END", "stub 应识别句末快速释放");
    assert.equal(r.diverged, true);
    assert.equal(r.shadowFaster, true);
    console.log("DIVERGE_A legacy_late_stub_early:", JSON.stringify({
      legacyState: r.legacy.state, legacyReason: r.legacy.primaryReason,
      stubState: r.shadow.state, stubReason: r.shadow.primaryReason,
      assessment: "stub更合理：句子已结束，legacy 被 recent_growth 保护过久",
    }));
  });

  // Scenario B: legacy 更快切（无文本长沉默）
  it("B: 无文本 + 300ms baseGap + 文本稳定 2000ms → legacy 触发 fallback，stub 持 HOLD", () => {
    // legacy uses fallback:no_partial (silence timeout); stub sees no text → stub_no_text_hold
    const r = compareEnd(makeTurnInput({
      previewText: "",
      baseGapMs: 300,
      nowMs: 10_000,
      lastPartialUpdateAt: 8_000,
      lastGrowthAt: 8_000,  // sinceGrowth=2000ms
    }));
    assert.equal(r.legacy.state, "CONFIRMED_END", "legacy 应触发 fallback:no_partial 释放");
    assert.equal(r.shadow.state, "HOLD", "stub 无文本时更保守（stub_no_text_hold）");
    assert.equal(r.diverged, true);
    console.log("DIVERGE_B legacy_early_stub_hold:", JSON.stringify({
      legacyState: r.legacy.state, legacyReason: r.legacy.primaryReason,
      stubState: r.shadow.state, stubReason: r.shadow.primaryReason,
      assessment: "legacy更合理：纯沉默 2s 应释放；stub 过于保守",
    }));
  });

  // Scenario C: stub 在 stable 文本时提前进入 LIKELY_END
  it("C: 有文本 + 400ms gap + recent（但已稳定 400ms）→ stub LIKELY_END，legacy HOLD", () => {
    // stub threshold = 374ms (=480*0.78); legacy still in recent_growth
    const r = compareEnd(makeTurnInput({
      previewText: "嗯，我在想",
      baseGapMs: 400,
      nowMs: 10_000,
      lastPartialUpdateAt: 9_600,
      lastGrowthAt: 9_600,   // sinceGrowth=400ms ≥ 200ms → not recentGrowth for stub
    }));
    assert.equal(r.legacy.state, "HOLD", "legacy 因 recent_growth 逻辑持 HOLD");
    assert.equal(r.shadow.state, "LIKELY_END", "stub 400ms ≥ 374ms(=480*0.78) → LIKELY_END");
    assert.equal(r.diverged, true);
    console.log("DIVERGE_C stub_likely_end_earlier:", JSON.stringify({
      legacyState: r.legacy.state, legacyReason: r.legacy.primaryReason,
      stubState: r.shadow.state, stubReason: r.shadow.primaryReason,
      assessment: "stub更积极：文本稳定 400ms 应开始预判；legacy 因 recent_growth 保护",
    }));
  });

  // Scenario D: barge-in — stub 利用 partial 提前确认
  it("D: barge-in 290ms + hasPartial → stub confirmed，legacy candidate（门槛 320ms 未到）", () => {
    const l = legacy.evaluateBargeIn(makeBargeInInput({ speechDurationMs: 290, hasPartial: true }));
    const s = stub.evaluateBargeIn(makeBargeInInput({ speechDurationMs: 290, hasPartial: true }));
    assert.equal(l.decision, "candidate", "legacy 290ms < 320ms → candidate");
    assert.equal(s.decision, "confirmed", "stub 290ms ≥ 280ms + partial → confirmed");
    console.log("DIVERGE_D barge_in_with_partial:", JSON.stringify({
      legacyDecision: l.decision, stubDecision: s.decision,
      gapMs: 30, assessment: "stub合理：有 partial 时 30ms 提前感知更准确",
    }));
  });

  // Scenario E: no divergence baseline
  it("E: barge-in 350ms 无 partial → legacy 和 stub 一致（confirmed）", () => {
    const l = legacy.evaluateBargeIn(makeBargeInInput({ speechDurationMs: 350, hasPartial: false }));
    const s = stub.evaluateBargeIn(makeBargeInInput({ speechDurationMs: 350, hasPartial: false }));
    assert.equal(l.decision, s.decision, "无 partial 时两者应一致");
    console.log("BASELINE_E no_partial_consistent:", l.decision);
  });
});
