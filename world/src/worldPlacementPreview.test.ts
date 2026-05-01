import { describe, expect, it } from "vitest";

import {
  getPlacementPreviewHeight,
  type PreviewPlacementStatus,
} from "./worldPlacementPreview";

const okStatus: PreviewPlacementStatus = {
  ok: true,
  point: { x: 1, y: 0, z: 1 },
};

const invalidStatus: PreviewPlacementStatus = {
  ok: false,
  point: { x: 1, y: 0, z: 1 },
};

describe("worldPlacementPreview", () => {
  it("keeps valid previews close to the ground", () => {
    expect(getPlacementPreviewHeight("lamp", okStatus)).toBe(0.035);
    expect(getPlacementPreviewHeight("land_fill", okStatus)).toBe(0.02);
  });

  it("lifts invalid previews so the blocked state stays visible", () => {
    expect(getPlacementPreviewHeight("lamp", invalidStatus)).toBe(0.14);
    expect(getPlacementPreviewHeight("land_fill", invalidStatus)).toBe(0.12);
  });
});
