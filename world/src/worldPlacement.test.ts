import { describe, expect, it } from "vitest";

import { createLandCellRecord } from "./worldExpansion";
import {
  clampPlacementToIsland,
  findNearestPlacedObjectIndex,
  findNearbyValidPlacementStatus,
  findTargetPlacedObjectIndex,
  findTargetPlacedObjectIndexFromRay,
  getPlacementStatus,
  getPlacementLocationLabel,
} from "./worldPlacement";

describe("worldPlacement", () => {
  it("keeps placement points inside the island build radius", () => {
    const point = clampPlacementToIsland({ x: 20, y: 0, z: 0 });

    expect(point.x).toBeCloseTo(4.93);
    expect(point.y).toBe(0);
    expect(point.z).toBeCloseTo(0);
  });

  it("labels high-value island areas for feedback text", () => {
    expect(getPlacementLocationLabel({ x: -3, y: 0, z: -2 })).toBe(
      "near the cottage",
    );
    expect(getPlacementLocationLabel({ x: 2.2, y: 0, z: 0 })).toBe(
      "beside the garden sign",
    );
    expect(getPlacementLocationLabel({ x: 0, y: 0, z: 3.5 })).toBe(
      "the shore path",
    );
  });

  it("marks water, cottage, and near-player placement as invalid", () => {
    const player = { x: 0, y: 0, z: 3.6 };

    expect(getPlacementStatus({ x: 8, y: 0, z: 0 }, player)).toMatchObject({
      ok: false,
      reason: "water",
      point: { x: expect.closeTo(5.8), y: 0, z: expect.closeTo(0) },
    });

    expect(getPlacementStatus({ x: -2.2, y: 0, z: -1.2 }, player)).toMatchObject({
      ok: false,
      reason: "cottage",
    });

    expect(getPlacementStatus({ x: 0.1, y: 0, z: 3.55 }, player)).toMatchObject({
      ok: false,
      reason: "too_close_to_player",
    });

    expect(getPlacementStatus({ x: 1.35, y: 0, z: 1.75 }, player)).toMatchObject({
      ok: true,
      point: { x: 1.35, y: 0, z: 1.75 },
    });
  });

  it("marks placement as invalid when it overlaps an existing detail", () => {
    const player = { x: 0, y: 0, z: 3.6 };
    const occupied = [
      { position: { x: 1.2, y: 0, z: 1.7 }, radius: 0.42 },
    ];

    expect(
      getPlacementStatus({ x: 1.35, y: 0, z: 1.8 }, player, occupied),
    ).toMatchObject({
      ok: false,
      reason: "occupied",
    });

    expect(
      getPlacementStatus({ x: 2.25, y: 0, z: 1.8 }, player, occupied),
    ).toMatchObject({
      ok: true,
    });
  });

  it("can find a nearby valid spot when the intended shoreline detail spot is occupied", () => {
    const landCells = [createLandCellRecord({ x: 7, z: 0 }, "land-1")];
    const player = { x: 3.4, y: 0, z: 0 };
    const occupied = [
      { position: { x: 5.6, y: 0, z: 0 }, radius: 0.22 },
    ];

    expect(
      findNearbyValidPlacementStatus(
        { x: 5.6, y: 0, z: 0 },
        player,
        occupied,
        landCells,
      ),
    ).toMatchObject({
      ok: true,
    });
  });

  it("allows decoration placement on expanded shoreline land", () => {
    const landCells = [createLandCellRecord({ x: 7, z: 0 }, "land-1")];
    const player = { x: 4.6, y: 0, z: 0 };

    expect(
      getPlacementStatus({ x: 5.6, y: 0, z: 0 }, player, [], landCells),
    ).toMatchObject({
      ok: true,
      point: { x: 5.6, y: 0, z: 0 },
    });

    expect(
      getPlacementStatus({ x: 5.6, y: 0, z: 0.8 }, player, [], []),
    ).toMatchObject({
      ok: false,
      reason: "water",
    });
  });

  it("finds the placed object nearest to the aimed placement point", () => {
    const objects = [
      { position: { x: -1, y: 0, z: 0 } },
      { position: { x: 1.1, y: 0, z: 0.2 } },
      { position: { x: 2.6, y: 0, z: 1.8 } },
    ];

    expect(findNearestPlacedObjectIndex(objects, { x: 1.2, y: 0, z: 0.05 })).toBe(1);
    expect(
      findNearestPlacedObjectIndex(objects, { x: 4.5, y: 0, z: 4.5 }, 0.5),
    ).toBe(-1);
  });

  it("targets placed objects by their footprint rather than a broad nearest radius", () => {
    const objects = [
      { position: { x: 0, y: 0, z: 0 }, radius: 0.2 },
      { position: { x: 0.48, y: 0, z: 0 }, radius: 0.44 },
    ];

    expect(findTargetPlacedObjectIndex(objects, { x: 0.14, y: 0, z: 0 })).toBe(0);
    expect(findTargetPlacedObjectIndex(objects, { x: 0.34, y: 0, z: 0 })).toBe(1);
    expect(findTargetPlacedObjectIndex(objects, { x: 1.2, y: 0, z: 0 })).toBe(-1);
  });

  it("targets placed objects from the crosshair ray instead of only the ground preview point", () => {
    const objects = [
      { position: { x: 0.2, y: 0, z: 2.2 }, radius: 0.22 },
      { position: { x: 1.4, y: 0, z: 2.2 }, radius: 0.46 },
    ];

    expect(
      findTargetPlacedObjectIndexFromRay(
        objects,
        { x: 0, y: 1.45, z: 0 },
        { x: 0.09, y: -0.16, z: 1 },
      ),
    ).toBe(0);
    expect(
      findTargetPlacedObjectIndexFromRay(
        objects,
        { x: 0, y: 1.45, z: 0 },
        { x: -1, y: -0.1, z: 0 },
      ),
    ).toBe(-1);
  });
});
