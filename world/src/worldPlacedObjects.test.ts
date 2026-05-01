import { describe, expect, it } from "vitest";

import {
  createPlacedObjectRecord,
  getWorldObjectRadius,
  parsePlacedObjects,
  serializePlacedObjects,
} from "./worldPlacedObjects";

describe("worldPlacedObjects", () => {
  it("creates stable placed-object records with normalized ground position", () => {
    expect(
      createPlacedObjectRecord("lamp", { x: 1.2, y: 4, z: -0.7 }, "placed-1"),
    ).toEqual({
      id: "placed-1",
      kind: "lamp",
      position: { x: 1.2, y: 0, z: -0.7 },
    });
  });

  it("uses tighter footprints for flowers than blocks and lamps", () => {
    expect(getWorldObjectRadius("blue_flower")).toBeLessThan(
      getWorldObjectRadius("wood_block"),
    );
    expect(getWorldObjectRadius("pink_flower")).toBeLessThan(
      getWorldObjectRadius("lamp"),
    );
  });

  it("round-trips placed objects through a versioned storage payload", () => {
    const records = [
      createPlacedObjectRecord("lamp", { x: 1, y: 0, z: 2 }, "a"),
      createPlacedObjectRecord("stone_block", { x: -1, y: 0, z: 0.5 }, "b"),
    ];

    expect(parsePlacedObjects(serializePlacedObjects(records))).toEqual(records);
  });

  it("drops invalid or unknown saved objects without throwing", () => {
    const payload = JSON.stringify({
      version: 1,
      objects: [
        { id: "valid", kind: "wood_block", position: { x: 0, y: 8, z: 1 } },
        { id: "land", kind: "land_fill", position: { x: 5.6, y: 0, z: 0 } },
        { id: "bad-kind", kind: "chair", position: { x: 0, y: 0, z: 0 } },
        { id: "bad-position", kind: "lamp", position: { x: "x", y: 0, z: 0 } },
      ],
    });

    expect(parsePlacedObjects(payload)).toEqual([
      {
        id: "valid",
        kind: "wood_block",
        position: { x: 0, y: 0, z: 1 },
      },
    ]);
    expect(parsePlacedObjects("{")).toEqual([]);
  });
});
