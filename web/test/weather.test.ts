import type {} from "mocha";

const assert = require("node:assert/strict");

import { weatherAt, type WeatherProfile } from "@/lib/world/weather";

describe("RW-P2-3: weather", () => {
  it("returns valid weather state", () => {
    const w = weatherAt(Date.now());
    assert.ok(
      ["clear", "cloudy", "rain", "snow"].includes(w.state),
      `unexpected state: ${w.state}`,
    );
  });

  it("is deterministic (same slot → same weather)", () => {
    const t = 1700000000000;
    const w1 = weatherAt(t);
    const w2 = weatherAt(t + 1000); // 1 second later, same slot
    assert.equal(w1.state, w2.state);
  });

  it("can change between 6-hour slots", () => {
    // Try many slots, at least 2 different weather states should appear
    const states = new Set<string>();
    for (let i = 0; i < 100; i++) {
      states.add(weatherAt(i * 6 * 3600_000).state);
    }
    assert.ok(states.size > 1, `only saw ${[...states].join(", ")}`);
  });

  it("has non-empty contextLine for all states", () => {
    // Force each state by scanning slots
    const seen = new Set<string>();
    for (let i = 0; i < 1000 && seen.size < 4; i++) {
      const w = weatherAt(i * 6 * 3600_000);
      assert.equal(typeof w.contextLine, "string");
      assert.ok(w.contextLine.length > 0, "contextLine should not be empty");
      assert.equal(typeof w.label, "string");
      assert.ok(w.label.length > 0, "label should not be empty");
      seen.add(w.state);
    }
  });

  it("rain and snow are indoorOnly", () => {
    for (let i = 0; i < 1000; i++) {
      const w = weatherAt(i * 6 * 3600_000);
      if (w.state === "rain" || w.state === "snow") {
        assert.equal(w.indoorOnly, true);
      }
    }
  });
});
