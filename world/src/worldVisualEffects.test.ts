import { describe, expect, it } from "vitest";

import { getVisualEffectFrame } from "./worldVisualEffects";

describe("worldVisualEffects", () => {
  it("keeps all ambient animation values inside restrained MVP ranges", () => {
    for (const second of [0, 0.5, 1.5, 4.2, 9.8]) {
      const frame = getVisualEffectFrame(second);

      expect(frame.lampIntensity).toBeGreaterThanOrEqual(0.82);
      expect(frame.lampIntensity).toBeLessThanOrEqual(1.08);
      expect(frame.smokeAlpha).toBeGreaterThanOrEqual(0.24);
      expect(frame.smokeAlpha).toBeLessThanOrEqual(0.5);
      expect(frame.waterAlpha).toBeGreaterThanOrEqual(0.58);
      expect(frame.waterAlpha).toBeLessThanOrEqual(0.74);
      expect(frame.previewAlpha).toBeGreaterThanOrEqual(0.35);
      expect(frame.previewAlpha).toBeLessThanOrEqual(0.62);
    }
  });

  it("changes lamp, smoke, water, and preview values over time", () => {
    const start = getVisualEffectFrame(0);
    const later = getVisualEffectFrame(1.7);

    expect(later.lampIntensity).not.toBeCloseTo(start.lampIntensity);
    expect(later.smokeLift).not.toBeCloseTo(start.smokeLift);
    expect(later.waterAlpha).not.toBeCloseTo(start.waterAlpha);
    expect(later.previewAlpha).not.toBeCloseTo(start.previewAlpha);
  });
});
