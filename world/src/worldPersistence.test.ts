import { describe, expect, it } from "vitest";

import {
  clearLandCellsFromStorage,
  clearPlacedObjectsFromStorage,
  loadLandCellsFromStorage,
  loadPlacedObjectsFromStorage,
  saveLandCellsToStorage,
  savePlacedObjectsToStorage,
  WORLD_LAND_CELLS_STORAGE_KEY,
  WORLD_PLACED_OBJECTS_STORAGE_KEY,
} from "./worldPersistence";
import { createLandCellRecord } from "./worldExpansion";
import { createPlacedObjectRecord } from "./worldPlacedObjects";

describe("worldPersistence", () => {
  it("saves, loads, and clears local placed objects", () => {
    const storage = new MapStorage();
    const records = [
      createPlacedObjectRecord("lamp", { x: 1, y: 0, z: 2 }, "a"),
    ];

    savePlacedObjectsToStorage(storage, records);

    expect(storage.getItem(WORLD_PLACED_OBJECTS_STORAGE_KEY)).toContain(
      "\"version\":1",
    );
    expect(loadPlacedObjectsFromStorage(storage)).toEqual(records);

    clearPlacedObjectsFromStorage(storage);

    expect(loadPlacedObjectsFromStorage(storage)).toEqual([]);
  });

  it("treats storage failures as an empty local world instead of crashing", () => {
    const storage = {
      getItem: () => {
        throw new Error("storage unavailable");
      },
      setItem: () => {
        throw new Error("storage unavailable");
      },
      removeItem: () => {
        throw new Error("storage unavailable");
      },
    };

    expect(loadPlacedObjectsFromStorage(storage)).toEqual([]);
    expect(() => savePlacedObjectsToStorage(storage, [])).not.toThrow();
    expect(() => clearPlacedObjectsFromStorage(storage)).not.toThrow();
  });

  it("saves, loads, and clears local land cells separately from objects", () => {
    const storage = new MapStorage();
    const records = [
      createLandCellRecord({ x: 7, z: 0 }, "land-1"),
      createLandCellRecord({ x: 7, z: 1 }, "land-2"),
    ];

    saveLandCellsToStorage(storage, records);

    expect(storage.getItem(WORLD_LAND_CELLS_STORAGE_KEY)).toContain(
      "\"version\":1",
    );
    expect(loadLandCellsFromStorage(storage)).toEqual(records);
    expect(loadPlacedObjectsFromStorage(storage)).toEqual([]);

    clearLandCellsFromStorage(storage);

    expect(loadLandCellsFromStorage(storage)).toEqual([]);
  });
});

class MapStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}
