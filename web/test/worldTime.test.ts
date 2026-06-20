import type {} from "mocha";

const assert = require("node:assert/strict");

import { scheduledBehaviorAt, type BehaviorId } from "@/lib/world/behavior";
import {
  buildOfflineReturnOpener,
  worldTimePhaseAt,
  worldTimeProfileAt,
  type WorldTimePhase,
} from "@/lib/world/worldTime";

function localHour(hour: number): number {
  return new Date(2026, 5, 14, hour, 30, 0, 0).getTime();
}

describe("RemiWorld Phase 2 world clock", () => {
  it("maps wall-clock hours into daily phases", () => {
    assert.equal(worldTimePhaseAt(localHour(7)), "morning");
    assert.equal(worldTimePhaseAt(localHour(13)), "day");
    assert.equal(worldTimePhaseAt(localHour(18)), "dusk");
    assert.equal(worldTimePhaseAt(localHour(23)), "night");
    assert.equal(worldTimePhaseAt(localHour(2)), "night");
  });

  it("exposes phase copy and lighting intent for HUD/prompt/engine", () => {
    assert.equal(worldTimeProfileAt(localHour(7)).label, "清晨");
    assert.equal(worldTimeProfileAt(localHour(13)).label, "午后");
    assert.equal(worldTimeProfileAt(localHour(18)).label, "黄昏");
    assert.equal(worldTimeProfileAt(localHour(23)).label, "深夜");
    assert.equal(worldTimeProfileAt(localHour(7)).lowLight, false);
    assert.equal(worldTimeProfileAt(localHour(23)).lowLight, true);
  });

  it("keeps scheduled behavior inside each phase's daily routine pool", () => {
    const samples: Array<[WorldTimePhase, number]> = [
      ["morning", localHour(7)],
      ["day", localHour(13)],
      ["dusk", localHour(18)],
      ["night", localHour(23)],
    ];

    for (const [phase, startMs] of samples) {
      const pool = new Set<BehaviorId>(worldTimeProfileAt(startMs).behaviorPool);
      assert.ok(pool.size >= 2, `${phase} should have a real routine pool`);
      for (let i = 0; i < 24; i += 1) {
        const id = scheduledBehaviorAt(startMs + i * 105_000);
        assert.ok(pool.has(id), `${phase} should not schedule ${id}`);
      }
    }
  });

  it("builds a return opener from offline time without firing on tiny absences", () => {
    assert.equal(
      buildOfflineReturnOpener({
        elapsedMs: 8 * 60_000,
        profile: worldTimeProfileAt(localHour(18)),
        flowerPlanted: true,
        lanternLit: true,
      }),
      null,
    );

    const opener = buildOfflineReturnOpener({
      elapsedMs: 9 * 60 * 60_000,
      profile: worldTimeProfileAt(localHour(23)),
      flowerPlanted: true,
      lanternLit: true,
    });

    assert.ok(opener);
    assert.match(opener!, /你不在/);
    assert.match(opener!, /深夜/);
    assert.match(opener!, /花|灯/);
  });
});
