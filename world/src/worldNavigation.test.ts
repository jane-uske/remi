import { describe, expect, it } from "vitest";

import { createLandCellRecord } from "./worldExpansion";
import { constrainPlayerPosition } from "./worldNavigation";

describe("worldNavigation", () => {
  it("keeps the player inside the island radius", () => {
    const point = constrainPlayerPosition(
      { x: 20, y: 1.45, z: 0 },
      { x: 0, y: 1.45, z: 0 },
    );

    expect(point.x).toBeCloseTo(5.35);
    expect(point.y).toBe(1.45);
    expect(point.z).toBeCloseTo(0);
  });

  it("prevents first-person movement through the cottage body", () => {
    const previous = { x: -0.5, y: 1.45, z: -0.55 };
    const point = constrainPlayerPosition(
      { x: -1.25, y: 1.45, z: -1.1 },
      previous,
    );

    expect(point).toEqual(previous);
  });

  it("keeps the player from pressing into the cottage front wall", () => {
    const previous = { x: -0.45, y: 1.45, z: 0.24 };
    const point = constrainPlayerPosition(
      { x: -0.2, y: 1.45, z: 0.95 },
      previous,
    );

    expect(point).toEqual(previous);
  });

  it("keeps the player outside the cottage eave comfort zone", () => {
    const previous = { x: -0.2, y: 1.45, z: 1.68 };
    const point = constrainPlayerPosition(
      { x: -0.65, y: 1.45, z: 1.45 },
      previous,
    );

    expect(point).toEqual(previous);
  });

  it("prevents walking through trees and fence rails", () => {
    const nearAppleTree = { x: 3.18, y: 1.45, z: 1.25 };
    expect(
      constrainPlayerPosition({ x: 3.85, y: 1.45, z: 1.25 }, nearAppleTree),
    ).toEqual(nearAppleTree);

    const nearGardenFence = { x: 3.1, y: 1.45, z: 1.6 };
    expect(
      constrainPlayerPosition({ x: 3.6, y: 1.45, z: 1.6 }, nearGardenFence),
    ).toEqual(nearGardenFence);
  });

  it("allows the player to walk onto expanded shoreline land", () => {
    const landCells = [createLandCellRecord({ x: 7, z: 0 }, "land-1")];
    const point = constrainPlayerPosition(
      { x: 5.6, y: 1.45, z: 0 },
      { x: 5.15, y: 1.45, z: 0 },
      landCells,
    );

    expect(point).toEqual({ x: 5.6, y: 1.45, z: 0 });
  });

  it("keeps water movement on the original island edge when no expanded land exists there", () => {
    const previous = { x: 5.15, y: 1.45, z: 0 };
    const point = constrainPlayerPosition(
      { x: 5.6, y: 1.45, z: 0 },
      previous,
      [],
    );

    expect(point).toEqual({ x: 5.35, y: 1.45, z: 0 });
  });

  it("keeps the player on filled shoreline instead of snapping back when stepping into water", () => {
    const landCells = [createLandCellRecord({ x: 7, z: 0 }, "land-1")];
    const previous = { x: 5.6, y: 1.45, z: 0 };
    const point = constrainPlayerPosition(
      { x: 6.3, y: 1.45, z: 0 },
      previous,
      landCells,
    );

    expect(point).toEqual(previous);
  });
});
