import { describe, expect, it } from "vitest";

import { getHeroCameraPreset } from "./heroCameraPreset";

describe("heroCameraPreset", () => {
  it("keeps the hero shot out of wide-angle distortion", () => {
    const preset = getHeroCameraPreset();

    expect(preset.fovDegrees).toBeGreaterThanOrEqual(35);
    expect(preset.fovDegrees).toBeLessThanOrEqual(50);
  });

  it("frames cottage left and leaves a right-side Remi stand zone", () => {
    const preset = getHeroCameraPreset();
    const cottageCenter = { x: -2.35, z: -2.08 };

    expect(preset.position.z).toBeGreaterThan(5.6);
    expect(projectHorizontal(preset, cottageCenter)).toBeLessThan(0);
    expect(projectHorizontal(preset, preset.remiStandZone)).toBeGreaterThan(0);
  });
});

function projectHorizontal(
  preset: ReturnType<typeof getHeroCameraPreset>,
  point: { x: number; z: number },
) {
  const forward = {
    x: preset.target.x - preset.position.x,
    z: preset.target.z - preset.position.z,
  };
  const length = Math.hypot(forward.x, forward.z);
  const screenRight = {
    x: forward.z / length,
    z: -forward.x / length,
  };

  return (
    (point.x - preset.target.x) * screenRight.x +
    (point.z - preset.target.z) * screenRight.z
  );
}
