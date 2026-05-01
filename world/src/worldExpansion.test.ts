import { describe, expect, it } from "vitest";

import {
  EXPANSION_CELL_SIZE,
  createLandCellRecord,
  getLandFillStatus,
  getLandLocationLabel,
  getLandRecordKey,
  getLandRemoveStatus,
  findLatestRemovableLandStatus,
  getWorldTerrainStatus,
  isPointOnExpandedLand,
  parseLandCells,
  serializeLandCells,
  toExpansionCell,
} from "./worldExpansion";
import { ISLAND_RADIUS } from "./worldPlacement";

describe("worldExpansion", () => {
  it("allows filling a shoreline cell that touches the original island", () => {
    const status = getLandFillStatus(
      { x: ISLAND_RADIUS + EXPANSION_CELL_SIZE * 0.45, y: 0, z: 0 },
      { x: 0, y: 0, z: 3 },
      [],
    );

    expect(status).toMatchObject({
      ok: true,
      cell: { x: 7, z: 0 },
      point: { x: expect.closeTo(5.6), y: 0, z: 0 },
    });
  });

  it("rejects filling existing land, isolated water, third-ring cells, and player feet", () => {
    const player = { x: 0, y: 0, z: 3 };
    const firstCell = createLandCellRecord({ x: 7, z: 0 }, "land-1");
    const secondCell = createLandCellRecord({ x: 8, z: 0 }, "land-2");

    expect(getLandFillStatus({ x: 4, y: 0, z: 0 }, player, [])).toMatchObject({
      ok: false,
      reason: "existing_land",
    });

    expect(getLandFillStatus({ x: 6.4, y: 0, z: 2.4 }, player, [])).toMatchObject({
      ok: false,
      reason: "not_adjacent",
    });

    expect(
      getLandFillStatus(
        { x: 7.2, y: 0, z: 0 },
        player,
        [firstCell, secondCell],
      ),
    ).toMatchObject({
      ok: false,
      reason: "too_far",
    });

    expect(
      getLandFillStatus(
        { x: ISLAND_RADIUS + EXPANSION_CELL_SIZE * 0.45, y: 0, z: 0 },
        { x: 5.5, y: 0, z: 0 },
        [],
      ),
    ).toMatchObject({
      ok: false,
      reason: "too_close_to_player",
    });
  });

  it("treats expanded cells as terrain for walking and decoration placement", () => {
    const cell = createLandCellRecord({ x: 7, z: 0 }, "land-1");

    expect(isPointOnExpandedLand({ x: 5.6, y: 0, z: 0.1 }, [cell])).toBe(true);
    expect(isPointOnExpandedLand({ x: 6.3, y: 0, z: 0 }, [cell])).toBe(false);
    expect(getWorldTerrainStatus({ x: 5.6, y: 0, z: 0.1 }, [cell])).toBe(
      "expanded_land",
    );
    expect(getWorldTerrainStatus({ x: 4, y: 0, z: 0 }, [cell])).toBe(
      "original_island",
    );
    expect(getWorldTerrainStatus({ x: 8, y: 0, z: 0 }, [cell])).toBe("water");
  });

  it("round-trips land cells and ignores bad payloads", () => {
    const records = [
      createLandCellRecord(toExpansionCell({ x: 5.6, y: 0, z: 0 }), "land-1"),
      createLandCellRecord(toExpansionCell({ x: 5.6, y: 0, z: 0.8 }), "land-2"),
    ];

    expect(parseLandCells(serializeLandCells(records))).toEqual(records);
    expect(parseLandCells(null)).toEqual([]);
    expect(parseLandCells("{bad json")).toEqual([]);
    expect(
      parseLandCells(
        JSON.stringify({
          version: 1,
          cells: [{ id: "land-x", cell: { x: Number.NaN, z: 0 } }],
        }),
      ),
    ).toEqual([]);
  });

  it("creates stable cell keys and readable location labels", () => {
    expect(getLandRecordKey(createLandCellRecord({ x: -7, z: -2 }, "land-1"))).toBe(
      "-7:-2",
    );
    expect(getLandLocationLabel({ x: -7, z: -2 })).toBe("the cottage shoreline");
    expect(getLandLocationLabel({ x: 7, z: 3 })).toBe("the garden shoreline");
    expect(getLandLocationLabel({ x: 0, z: 7 })).toBe("the front shore");
  });

  it("allows removing empty outer filled land but protects occupied or supporting cells", () => {
    const innerCell = createLandCellRecord({ x: 7, z: 0 }, "land-1");
    const outerCell = createLandCellRecord({ x: 8, z: 0 }, "land-2");

    expect(
      getLandRemoveStatus({ x: 6.4, y: 0, z: 0 }, [innerCell, outerCell]),
    ).toMatchObject({
      ok: true,
      cell: { x: 8, z: 0 },
    });
    expect(
      getLandRemoveStatus({ x: 5.6, y: 0, z: 0 }, [innerCell, outerCell]),
    ).toMatchObject({
      ok: false,
      reason: "would_orphan_land",
    });
    expect(
      getLandRemoveStatus(
        { x: 6.4, y: 0, z: 0 },
        [innerCell, outerCell],
        [{ position: { x: 6.4, y: 0, z: 0 }, radius: 0.22 }],
      ),
    ).toMatchObject({
      ok: false,
      reason: "occupied",
    });
    expect(getLandRemoveStatus({ x: 4, y: 0, z: 0 }, [innerCell])).toMatchObject({
      ok: false,
      reason: "no_land",
    });
  });

  it("finds the latest removable empty land cell as an undo fallback", () => {
    const innerCell = createLandCellRecord({ x: 7, z: 0 }, "land-1");
    const outerCell = createLandCellRecord({ x: 8, z: 0 }, "land-2");

    expect(findLatestRemovableLandStatus([innerCell, outerCell])).toMatchObject({
      ok: true,
      cell: { x: 8, z: 0 },
    });
    expect(
      findLatestRemovableLandStatus(
        [innerCell, outerCell],
        [{ position: { x: 6.4, y: 0, z: 0 }, radius: 0.22 }],
      ),
    ).toMatchObject({
      ok: false,
      reason: "no_removable_land",
    });
  });
});
