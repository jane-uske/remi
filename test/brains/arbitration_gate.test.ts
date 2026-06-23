import { expect } from "chai";
import { arbitrate, DEFAULT_ARBITRATION_CONFIG } from "../../brains/arbitration_gate";
import type { InitiationCandidate, UserOutreachState, ArbitrationConfig } from "../../brains/arbitration_gate";

function makeCandidate(overrides?: Partial<InitiationCandidate>): InitiationCandidate {
  return { id: "c1", source: "silence_nudge", text: "在想什么呢？", urgency: 0.5, ...overrides };
}

function makeState(overrides?: Partial<UserOutreachState>): UserOutreachState {
  return {
    lastOutreachAt: null,
    ignoredStreak: 0,
    retreatLevel: 0,
    cooldownUntilAt: 0,
    lastConversationEndedAt: null,
    familiarityScore: 0.5,
    ...overrides,
  };
}

describe("ArbitrationGate", () => {
  const daytime = new Date("2026-06-23T14:00:00Z"); // 14:00 UTC

  it("holds when there are no candidates", () => {
    const result = arbitrate([], makeState(), daytime, null);
    expect(result.decision).to.equal("hold");
    expect(result.reason).to.equal("no_candidates");
  });

  it("holds when familiarity is too low", () => {
    const result = arbitrate(
      [makeCandidate()],
      makeState({ familiarityScore: 0.05 }),
      daytime,
      null,
    );
    expect(result.decision).to.equal("hold");
    expect(result.reason).to.equal("familiarity_too_low");
  });

  it("holds when retreat level is exceeded", () => {
    const result = arbitrate(
      [makeCandidate()],
      makeState({ retreatLevel: 3 }),
      daytime,
      null,
    );
    expect(result.decision).to.equal("hold");
    expect(result.reason).to.equal("retreat_level_exceeded");
  });

  it("holds when cooldown is active", () => {
    const futureMs = daytime.getTime() + 60_000;
    const result = arbitrate(
      [makeCandidate()],
      makeState({ cooldownUntilAt: futureMs }),
      daytime,
      null,
    );
    expect(result.decision).to.equal("hold");
    expect(result.reason).to.equal("cooldown_active");
  });

  it("holds during quiet hours (23:00-7:00) at midnight", () => {
    const midnight = new Date("2026-06-23T00:00:00Z");
    const result = arbitrate(
      [makeCandidate()],
      makeState(),
      midnight,
      "UTC",  // explicit UTC so hour=0 falls in 23-7 quiet range
    );
    expect(result.decision).to.equal("hold");
    expect(result.reason).to.equal("quiet_hours");
  });

  it("sends at 14:00 (not quiet hours)", () => {
    const result = arbitrate(
      [makeCandidate()],
      makeState(),
      daytime,
      null,
    );
    expect(result.decision).to.equal("send");
    expect(result.reason).to.equal("gates_passed");
  });

  it("holds for post-conversation cooldown (ended 1 min ago)", () => {
    const endedAt = daytime.getTime() - 60_000; // 1 min ago
    const result = arbitrate(
      [makeCandidate()],
      makeState({ lastConversationEndedAt: endedAt }),
      daytime,
      null,
    );
    expect(result.decision).to.equal("hold");
    expect(result.reason).to.equal("post_conversation_cooldown");
  });

  it("sends when post-conversation cooldown has elapsed (ended 10 min ago)", () => {
    const endedAt = daytime.getTime() - 10 * 60_000; // 10 min ago
    const result = arbitrate(
      [makeCandidate()],
      makeState({ lastConversationEndedAt: endedAt }),
      daytime,
      null,
    );
    expect(result.decision).to.equal("send");
    expect(result.reason).to.equal("gates_passed");
  });

  it("picks the highest urgency candidate when all gates pass", () => {
    const candidates = [
      makeCandidate({ id: "c1", urgency: 0.3, source: "presence" }),
      makeCandidate({ id: "c2", urgency: 0.9, source: "care" }),
      makeCandidate({ id: "c3", urgency: 0.6, source: "follow_up" }),
    ];
    const result = arbitrate(candidates, makeState(), daytime, null);
    expect(result.decision).to.equal("send");
    expect(result.chosen!.id).to.equal("c2");
    expect(result.chosen!.urgency).to.equal(0.9);
  });

  it("correctly orders multiple candidates by urgency desc", () => {
    const candidates = [
      makeCandidate({ id: "low", urgency: 0.1 }),
      makeCandidate({ id: "high", urgency: 0.8 }),
      makeCandidate({ id: "mid", urgency: 0.5 }),
    ];
    const result = arbitrate(candidates, makeState(), daytime, null);
    expect(result.decision).to.equal("send");
    expect(result.chosen!.id).to.equal("high");
  });

  it("respects quiet hours with timezone (Asia/Shanghai)", () => {
    // 2026-06-23T22:00:00Z = 2026-06-24T06:00 CST (Asia/Shanghai, UTC+8)
    // 06:00 CST falls inside quiet hours 23:00-7:00
    const utcTime = new Date("2026-06-23T22:00:00Z");
    const result = arbitrate(
      [makeCandidate()],
      makeState(),
      utcTime,
      "Asia/Shanghai",
    );
    expect(result.decision).to.equal("hold");
    expect(result.reason).to.equal("quiet_hours");
  });

  it("sends outside quiet hours with timezone (Asia/Shanghai)", () => {
    // 2026-06-23T06:00:00Z = 2026-06-23T14:00 CST (Asia/Shanghai, UTC+8)
    // 14:00 CST is outside quiet hours 23:00-7:00
    const utcTime = new Date("2026-06-23T06:00:00Z");
    const result = arbitrate(
      [makeCandidate()],
      makeState(),
      utcTime,
      "Asia/Shanghai",
    );
    expect(result.decision).to.equal("send");
    expect(result.reason).to.equal("gates_passed");
  });

  it("uses custom config for quiet hours range", () => {
    // Custom quiet hours: 1:00 - 6:00 (non-wrapping)
    const config: ArbitrationConfig = {
      ...DEFAULT_ARBITRATION_CONFIG,
      quietHoursStart: 1,
      quietHoursEnd: 6,
    };
    // 03:00 UTC → inside 1-6 range (use explicit UTC timezone)
    const threeAm = new Date("2026-06-23T03:00:00Z");
    const result = arbitrate(
      [makeCandidate()],
      makeState(),
      threeAm,
      "UTC",
      config,
    );
    expect(result.decision).to.equal("hold");
    expect(result.reason).to.equal("quiet_hours");
  });
});
