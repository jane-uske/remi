import { describe, expect, it } from "vitest";

import { getEveningLightingPreset } from "./createEveningLighting";

describe("createEveningLighting", () => {
  it("uses warm low-angle dusk light with muted atmospheric fog", () => {
    const preset = getEveningLightingPreset();

    expect(preset.sun.direction.y).toBeLessThan(-0.55);
    expect(preset.sun.diffuse.r).toBeGreaterThan(preset.sun.diffuse.b * 2);
    expect(preset.sky.intensity).toBeGreaterThan(0.45);
    expect(preset.sky.intensity).toBeLessThan(0.85);
    expect(preset.fog.color.b).toBeGreaterThan(preset.fog.color.g);
    expect(preset.fog.end).toBeGreaterThan(24);
  });

  it("keeps post processing cinematic but restrained", () => {
    const preset = getEveningLightingPreset();

    expect(preset.postProcess.bloomEnabled).toBe(true);
    expect(preset.postProcess.bloomWeight).toBeLessThan(0.32);
    expect(preset.postProcess.exposure).toBeLessThanOrEqual(1);
    expect(preset.postProcess.contrast).toBeGreaterThan(1);
    expect(preset.shadows.enabled).toBe(true);
  });
});
