import { describe, expect, it } from "vitest";

import {
  getInvalidLandFillHint,
  getInvalidLandRemoveHint,
  getInvalidPlacementHint,
  getPlacedObjectTargets,
} from "./worldPlacementFlow";

describe("worldPlacementFlow", () => {
  it("keeps placement feedback in island-cleanup language", () => {
    expect(getInvalidPlacementHint("water")).toContain("dry ground");
    expect(getInvalidPlacementHint("cottage")).toContain("cottage entrance");
    expect(getInvalidPlacementHint("too_close_to_player")).toContain("Step back");
    expect(getInvalidPlacementHint("occupied")).toContain("clear patch");
  });

  it("keeps land fill feedback focused on shoreline expansion", () => {
    expect(getInvalidLandFillHint("existing_land")).toContain("already land");
    expect(getInvalidLandFillHint("too_far")).toContain("too far");
    expect(getInvalidLandFillHint("too_close_to_player")).toContain("Step back");
    expect(getInvalidLandFillHint("not_adjacent")).toContain("shoreline outward");
  });

  it("keeps land removal feedback focused on editable filled patches", () => {
    expect(getInvalidLandRemoveHint("no_land")).toContain("filled shoreline patch");
    expect(getInvalidLandRemoveHint("occupied")).toContain("Move the decoration");
    expect(getInvalidLandRemoveHint("would_orphan_land")).toContain("outer shoreline");
    expect(getInvalidLandRemoveHint("no_removable_land")).toContain("No empty filled");
  });

  it("maps rendered placed objects into lightweight placement targets", () => {
    const rootA = { position: { x: 1, y: 0, z: 2 } };
    const rootB = { position: { x: -2, y: 0, z: -1 } };

    const targets = getPlacedObjectTargets([
      { root: rootA, radius: 0.3 },
      { root: rootB, radius: 0.8 },
    ]);

    expect(targets).toEqual([
      { position: rootA.position, radius: 0.3 },
      { position: rootB.position, radius: 0.8 },
    ]);
  });
});
