import {
  parsePlacedObjects,
  serializePlacedObjects,
  type PlacedObjectRecord,
} from "./worldPlacedObjects";
import {
  parseLandCells,
  serializeLandCells,
  type LandCellRecord,
} from "./worldExpansion";

export const WORLD_PLACED_OBJECTS_STORAGE_KEY = "remi-world:placed-objects:v1";
export const WORLD_LAND_CELLS_STORAGE_KEY = "remi-world:land-cells:v1";

interface BasicStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export function loadPlacedObjectsFromStorage(
  storage: BasicStorage,
): PlacedObjectRecord[] {
  try {
    return parsePlacedObjects(storage.getItem(WORLD_PLACED_OBJECTS_STORAGE_KEY));
  } catch {
    return [];
  }
}

export function savePlacedObjectsToStorage(
  storage: BasicStorage,
  records: readonly PlacedObjectRecord[],
) {
  try {
    storage.setItem(
      WORLD_PLACED_OBJECTS_STORAGE_KEY,
      serializePlacedObjects(records),
    );
  } catch {
    // Local persistence is best-effort in the prototype.
  }
}

export function clearPlacedObjectsFromStorage(storage: BasicStorage) {
  try {
    storage.removeItem(WORLD_PLACED_OBJECTS_STORAGE_KEY);
  } catch {
    // Local persistence is best-effort in the prototype.
  }
}

export function loadLandCellsFromStorage(
  storage: BasicStorage,
): LandCellRecord[] {
  try {
    return parseLandCells(storage.getItem(WORLD_LAND_CELLS_STORAGE_KEY));
  } catch {
    return [];
  }
}

export function saveLandCellsToStorage(
  storage: BasicStorage,
  records: readonly LandCellRecord[],
) {
  try {
    storage.setItem(
      WORLD_LAND_CELLS_STORAGE_KEY,
      serializeLandCells(records),
    );
  } catch {
    // Local persistence is best-effort in the prototype.
  }
}

export function clearLandCellsFromStorage(storage: BasicStorage) {
  try {
    storage.removeItem(WORLD_LAND_CELLS_STORAGE_KEY);
  } catch {
    // Local persistence is best-effort in the prototype.
  }
}
