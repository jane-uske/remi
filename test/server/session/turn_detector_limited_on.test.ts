/**
 * PR5d — LiveKit limited_on (turn-END only, asymmetric, real-partial gated).
 *
 * Covers:
 *   A. applyLimitedOnAdjustment pure rules (one-directional + safety cap).
 *   B. ShadowTurnDetector limited_on integration (cache, freshness, mismatch,
 *      provider failure, shadow-mode no-op, barge-in untouched).
 *   C. resolver mode wiring.
 *   D. turn-END latency comparison (legacy vs limited_on) — acceptance #7.
 */
const assert = require("assert").strict;
const { resetConfig } = require("../../../server/config");
const { decideTurnTaking } = require("../../../server/session/turn_taking");
const {
  applyLimitedOnAdjustment,
  LegacyVadTurnDetector,
  SmartTurnStub,
  ShadowTurnDetector,
  resolveTurnDetector,
  __resetTurnDetectorForTest,
} = require("../../../server/session/voice/turn_detector");

async function withConfigEnvAsync(overrides, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(overrides)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetConfig();
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    resetConfig();
  }
}

const CFG = { eouLow: 0.05, eouHigh: 0.6, lowEouMaxExtraHoldMs: 700 };

function decision(state, overrides = {}) {
  return {
    state,
    gapMs: 300,
    primaryReason: "legacy_reason",
    previewText: "我觉得这个方案可以",
    reasons: ["legacy_reason"],
    usedFallback: false,
    sentenceClosed: false,
    semanticallyComplete: false,
    incompleteTail: false,
    recentGrowth: false,
    stableMs: 500,
    ...overrides,
  };
}

function turnInput(overrides = {}) {
  return {
    baseGapMs: 300,
    previewText: "我觉得这个方案可以",
    nowMs: 10_000,
    lastPartialUpdateAt: 9_500,
    lastGrowthAt: 9_500,
    hesitationHoldMs: 600,
    growthHoldMs: 500,
    likelyStableMs: 480,
    confirmedStableMs: 800,
    releaseMs: 120,
    minGapMs: 80,
    ...overrides,
  };
}

// ─── A. pure rules ─────────────────────────────────────────────────────────

describe("applyLimitedOnAdjustment (PR5d pure rules)", () => {
  it("LOW EOU + CONFIRMED_END → 降级 LIKELY_END（延长耐心，不早切）", () => {
    const r = applyLimitedOnAdjustment(decision("CONFIRMED_END", { stableMs: 820 }), 0.01, turnInput(), CFG);
    assert.equal(r.action, "low_eou_hold");
    assert.equal(r.decision.state, "LIKELY_END");
    assert.equal(r.decision.primaryReason, "limited_on_low_eou_hold");
  });

  it("LOW EOU + CONFIRMED_END 但已超安全上限 → 不变（释放，防永久挂起）", () => {
    // cap = confirmedStableMs(800) + 700 = 1500; stableMs 1600 >= cap → release
    const r = applyLimitedOnAdjustment(decision("CONFIRMED_END", { stableMs: 1600 }), 0.01, turnInput(), CFG);
    assert.equal(r.action, "none");
    assert.equal(r.decision.state, "CONFIRMED_END");
  });

  it("LOW EOU + HOLD → 不变（HOLD 本就不切）", () => {
    const r = applyLimitedOnAdjustment(decision("HOLD"), 0.01, turnInput(), CFG);
    assert.equal(r.action, "none");
    assert.equal(r.decision.state, "HOLD");
  });

  it("LOW EOU + LIKELY_END → 不变（不早切，保持 LIKELY）", () => {
    const r = applyLimitedOnAdjustment(decision("LIKELY_END"), 0.01, turnInput(), CFG);
    assert.equal(r.action, "none");
    assert.equal(r.decision.state, "LIKELY_END");
  });

  it("HIGH EOU + LIKELY_END → 升级 CONFIRMED_END（完整句更快 commit）", () => {
    const r = applyLimitedOnAdjustment(decision("LIKELY_END"), 0.9, turnInput(), CFG);
    assert.equal(r.action, "high_eou_commit");
    assert.equal(r.decision.state, "CONFIRMED_END");
    assert.equal(r.decision.primaryReason, "limited_on_high_eou_commit");
  });

  it("HIGH EOU + HOLD → 不变（绝不切 legacy 认为未完的话）", () => {
    const r = applyLimitedOnAdjustment(decision("HOLD"), 0.95, turnInput(), CFG);
    assert.equal(r.action, "none");
    assert.equal(r.decision.state, "HOLD");
  });

  it("HIGH EOU + CONFIRMED_END → 不变（已确认）", () => {
    const r = applyLimitedOnAdjustment(decision("CONFIRMED_END"), 0.95, turnInput(), CFG);
    assert.equal(r.action, "none");
    assert.equal(r.decision.state, "CONFIRMED_END");
  });

  it("MIDDLE EOU（0.05~0.6）→ 完全不干预", () => {
    for (const st of ["HOLD", "LIKELY_END", "CONFIRMED_END"]) {
      const r = applyLimitedOnAdjustment(decision(st), 0.3, turnInput(), CFG);
      assert.equal(r.action, "none", `state=${st}`);
      assert.equal(r.decision.state, st);
    }
  });

  it("EOU 非有限值（NaN）→ 不干预", () => {
    const r = applyLimitedOnAdjustment(decision("LIKELY_END"), NaN, turnInput(), CFG);
    assert.equal(r.action, "none");
    assert.equal(r.decision.state, "LIKELY_END");
  });
});

// ─── B. ShadowTurnDetector limited_on integration ──────────────────────────

describe("ShadowTurnDetector limited_on integration (PR5d)", () => {
  function fakePrimary(state) {
    return {
      id: "legacy",
      evaluateTurnEnd: () => decision(state),
      evaluateBargeIn: () => ({ decision: "candidate", source: "legacy" }),
    };
  }
  function fakeAsync(eou, opts = {}) {
    return {
      id: "livekit_v1mini",
      async isAvailable() { return true; },
      async evaluateTurnEndAsync(input) {
        if (opts.throws) throw new Error("real boom");
        return { state: "X", endOfTurnProb: eou, source: "livekit_v1mini", latencyMs: 6 };
      },
      async evaluateBargeInAsync() { return null; },
    };
  }
  const PREVIEW = "我觉得这个方案可以";

  async function build(primaryState, eou, { mode = "limited_on", async = true, throws = false, now = () => 1000 } = {}) {
    const det = new ShadowTurnDetector(
      fakePrimary(primaryState), new SmartTurnStub(), "conn-lo",
      async ? fakeAsync(eou, { throws }) : undefined, mode, now,
    );
    return det;
  }

  it("无 partial（没 notePartial / 无缓存）→ 完全 legacy", async () => {
    const det = await build("LIKELY_END", 0.9);
    const r = det.evaluateTurnEnd(turnInput({ previewText: PREVIEW }));
    assert.equal(r.state, "LIKELY_END", "无缓存应保持 legacy");
  });

  it("notePartial + HIGH EOU + legacy LIKELY_END → 升级 CONFIRMED_END", async () => {
    const det = await build("LIKELY_END", 0.9);
    det.notePartial(PREVIEW);
    await new Promise((r) => setTimeout(r, 15)); // let async EOU cache
    const r = det.evaluateTurnEnd(turnInput({ previewText: PREVIEW }));
    assert.equal(r.state, "CONFIRMED_END");
    assert.equal(r.primaryReason, "limited_on_high_eou_commit");
  });

  it("notePartial + LOW EOU + legacy CONFIRMED_END → 降级 LIKELY_END", async () => {
    const det = await build("CONFIRMED_END", 0.01);
    det.notePartial(PREVIEW);
    await new Promise((r) => setTimeout(r, 15));
    const r = det.evaluateTurnEnd(turnInput({ previewText: PREVIEW, confirmedStableMs: 800 }));
    assert.equal(r.state, "LIKELY_END");
    assert.equal(r.primaryReason, "limited_on_low_eou_hold");
  });

  it("缓存过期（超 TTL）→ 回退 legacy", async () => {
    let now = 1000;
    const det = await build("LIKELY_END", 0.9, { now: () => now });
    det.notePartial(PREVIEW);
    await new Promise((r) => setTimeout(r, 15)); // cached at now=1000
    now = 1000 + 5000; // advance past default TTL(1500)
    const r = det.evaluateTurnEnd(turnInput({ previewText: PREVIEW }));
    assert.equal(r.state, "LIKELY_END", "过期缓存应回退 legacy");
  });

  it("缓存文本与当前 preview 不一致 → 回退 legacy", async () => {
    const det = await build("LIKELY_END", 0.9);
    det.notePartial(PREVIEW);
    await new Promise((r) => setTimeout(r, 15));
    const r = det.evaluateTurnEnd(turnInput({ previewText: "完全不同的另一句话" }));
    assert.equal(r.state, "LIKELY_END", "文本不匹配应回退 legacy");
  });

  it("provider 抛错 → notePartial 不抛、无缓存 → 回退 legacy", async () => {
    const det = await build("LIKELY_END", 0.9, { throws: true });
    assert.doesNotThrow(() => det.notePartial(PREVIEW));
    await new Promise((r) => setTimeout(r, 15));
    const r = det.evaluateTurnEnd(turnInput({ previewText: PREVIEW }));
    assert.equal(r.state, "LIKELY_END", "provider 失败应回退 legacy");
  });

  it("无 asyncShadow（无 endpoint）→ notePartial no-op，永远 legacy", async () => {
    const det = await build("LIKELY_END", 0.9, { async: false });
    assert.doesNotThrow(() => det.notePartial(PREVIEW));
    await new Promise((r) => setTimeout(r, 10));
    const r = det.evaluateTurnEnd(turnInput({ previewText: PREVIEW }));
    assert.equal(r.state, "LIKELY_END");
  });

  it("shadow 模式 + 有缓存 → 不调整（仅 limited_on 生效）", async () => {
    const det = await build("LIKELY_END", 0.9, { mode: "shadow" });
    det.notePartial(PREVIEW); // no-op in shadow mode
    await new Promise((r) => setTimeout(r, 10));
    const r = det.evaluateTurnEnd(turnInput({ previewText: PREVIEW }));
    assert.equal(r.state, "LIKELY_END", "shadow 模式不应改变结果");
  });

  it("limited_on 不碰 barge-in（evaluateBargeIn 仍纯 legacy）", async () => {
    const det = await build("LIKELY_END", 0.9);
    det.notePartial(PREVIEW);
    await new Promise((r) => setTimeout(r, 15));
    const r = det.evaluateBargeIn({
      assistantActive: true, speechDurationMs: 300, minSpeechMs: 320,
      hasReliableEvidence: true, hasPartial: true, partialText: PREVIEW,
    });
    assert.equal(r.decision, "candidate", "barge-in 必须保持 legacy 判定");
    assert.equal(r.source, "legacy");
  });

  it("HIGH EOU 但 legacy HOLD → 仍 HOLD（绝不切未完句）", async () => {
    const det = await build("HOLD", 0.95);
    det.notePartial(PREVIEW);
    await new Promise((r) => setTimeout(r, 15));
    const r = det.evaluateTurnEnd(turnInput({ previewText: PREVIEW }));
    assert.equal(r.state, "HOLD");
  });
});

// ─── C. resolver wiring ────────────────────────────────────────────────────

describe("resolveTurnDetector — mode wiring (PR5d)", () => {
  afterEach(() => __resetTurnDetectorForTest());

  it("MODE=off → 纯 legacy", async () => {
    await withConfigEnvAsync({ REMI_TURN_DETECTOR_MODE: "off" }, async () => {
      __resetTurnDetectorForTest();
      assert.equal(resolveTurnDetector("c").id, "legacy");
      assert.ok(!(resolveTurnDetector("c") instanceof ShadowTurnDetector));
    });
  });

  it("MODE 未设 + SHADOW=1 → shadow（向后兼容）", async () => {
    await withConfigEnvAsync({ REMI_TURN_DETECTOR_MODE: undefined, REMI_TURN_DETECTOR_SHADOW: "1" }, async () => {
      __resetTurnDetectorForTest();
      assert.ok(resolveTurnDetector("c") instanceof ShadowTurnDetector);
    });
  });

  it("MODE=limited_on + endpoint → ShadowTurnDetector（带 notePartial）", async () => {
    await withConfigEnvAsync({
      REMI_TURN_DETECTOR_MODE: "limited_on",
      REMI_TURN_DETECTOR_SHADOW_PROVIDER: "livekit_v1mini",
      REMI_TURN_DETECTOR_ENDPOINT: "http://127.0.0.1:9",
    }, async () => {
      __resetTurnDetectorForTest();
      const td = resolveTurnDetector("c");
      assert.ok(td instanceof ShadowTurnDetector);
      assert.equal(typeof td.notePartial, "function");
    });
  });

  it("MODE=limited_on 但无 endpoint → 无真实 provider，行为回退 legacy", async () => {
    await withConfigEnvAsync({
      REMI_TURN_DETECTOR_MODE: "limited_on",
      REMI_TURN_DETECTOR_SHADOW_PROVIDER: "livekit_v1mini",
      REMI_TURN_DETECTOR_ENDPOINT: undefined,
    }, async () => {
      __resetTurnDetectorForTest();
      const td = resolveTurnDetector("c");
      // It's a ShadowTurnDetector but with no async provider → notePartial no-op,
      // evaluateTurnEnd returns legacy unchanged.
      td.notePartial?.("我觉得这个方案可以");
      await new Promise((r) => setTimeout(r, 10));
      const r = td.evaluateTurnEnd(turnInput({ previewText: "我觉得这个方案可以" }));
      // legacy decideTurnTaking result; just assert it didn't get a limited_on reason
      assert.notEqual(r.primaryReason, "limited_on_high_eou_commit");
      assert.notEqual(r.primaryReason, "limited_on_low_eou_hold");
    });
  });
});

// ─── D. turn-END latency comparison (acceptance #7) ────────────────────────

describe("limited_on turn-END latency 对比 (PR5d)", () => {
  // Drive the REAL legacy decideTurnTaking over a silence ramp for a complete
  // sentence, then apply limited_on. Report the gap (ms of silence) at which
  // CONFIRMED_END is reached under each policy.
  function firstConfirmGap(eou) {
    // Complete sentence (with sentence-final punctuation) so legacy actually
    // progresses HOLD → LIKELY_END(≈500ms) → CONFIRMED_END(≈800ms).
    const text = "你吃饭了吗？";
    const lastGrowthAt = 10_000;
    for (let gap = 0; gap <= 2600; gap += 20) {
      const input = turnInput({
        previewText: text,
        baseGapMs: gap,
        nowMs: lastGrowthAt + gap,
        lastPartialUpdateAt: lastGrowthAt,
        lastGrowthAt,
      });
      const legacy = decideTurnTaking(input);
      let state = legacy.state;
      if (eou != null) {
        state = applyLimitedOnAdjustment(legacy, eou, input, CFG).decision.state;
      }
      if (state === "CONFIRMED_END") return gap;
    }
    return null;
  }

  it("输出 legacy vs limited_on(high/low EOU) 的 turn-END commit 时延", () => {
    const legacyGap = firstConfirmGap(null);
    const highGap = firstConfirmGap(0.9);
    const lowGap = firstConfirmGap(0.01);

    console.log("LIMITED_ON_LATENCY_legacy_confirm_gap_ms=" + legacyGap);
    console.log("LIMITED_ON_LATENCY_highEOU_confirm_gap_ms=" + highGap);
    console.log("LIMITED_ON_LATENCY_lowEOU_confirm_gap_ms=" + lowGap);
    if (legacyGap != null && highGap != null) {
      console.log("LIMITED_ON_LATENCY_high_saves_ms=" + (legacyGap - highGap));
    }
    if (legacyGap != null && lowGap != null) {
      console.log("LIMITED_ON_LATENCY_low_adds_ms=" + (lowGap - legacyGap));
    }

    // Core guarantees:
    assert.ok(legacyGap != null, "legacy 应在 ramp 内确认");
    assert.ok(highGap != null && highGap < legacyGap, "high EOU 应更早 commit（降延迟）");
    assert.ok(lowGap != null && lowGap > legacyGap, "low EOU 应更晚 commit（延长耐心）");
    // Low-EOU extra patience must be bounded by the safety cap.
    assert.ok(lowGap - legacyGap <= CFG.lowEouMaxExtraHoldMs + 40, "low EOU 额外等待受安全上限约束");
  });
});
