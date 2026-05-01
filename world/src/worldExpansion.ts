import {
  ISLAND_RADIUS,
  MIN_PLAYER_PLACEMENT_DISTANCE,
  type PlacementPoint,
} from "./worldPlacement";

export const EXPANSION_CELL_SIZE = 0.8;
const MAX_EXPANSION_RINGS = 2;
const LAND_STORAGE_VERSION = 1;
const MAX_EXPANSION_RADIUS = ISLAND_RADIUS + EXPANSION_CELL_SIZE * MAX_EXPANSION_RINGS;

export interface LandCell {
  x: number;
  z: number;
}

export interface LandCellRecord {
  id: string;
  cell: LandCell;
}

export type LandFillInvalidReason =
  | "existing_land"
  | "too_close_to_player"
  | "too_far"
  | "not_adjacent";

export type LandRemoveInvalidReason =
  | "no_land"
  | "occupied"
  | "would_orphan_land"
  | "no_removable_land";

export type LandFillStatus =
  | {
      ok: true;
      point: PlacementPoint;
      cell: LandCell;
      reason: null;
    }
  | {
      ok: false;
      point: PlacementPoint;
      cell: LandCell;
      reason: LandFillInvalidReason;
    };

export type LandRemoveStatus =
  | {
      ok: true;
      point: PlacementPoint;
      cell: LandCell;
      reason: null;
    }
  | {
      ok: false;
      point: PlacementPoint;
      cell: LandCell;
      reason: LandRemoveInvalidReason;
    };

export type WorldTerrainStatus = "original_island" | "expanded_land" | "water";

export function toExpansionCell(point: PlacementPoint): LandCell {
  return {
    x: Math.round(point.x / EXPANSION_CELL_SIZE),
    z: Math.round(point.z / EXPANSION_CELL_SIZE),
  };
}

export function getExpansionCellCenter(cell: LandCell): PlacementPoint {
  return {
    x: cell.x * EXPANSION_CELL_SIZE,
    y: 0,
    z: cell.z * EXPANSION_CELL_SIZE,
  };
}

export function createLandCellRecord(
  cell: LandCell,
  id: string,
): LandCellRecord {
  return {
    id,
    cell: {
      x: cell.x,
      z: cell.z,
    },
  };
}

export function getLandRecordKey(record: LandCellRecord): string {
  return getLandCellKey(record.cell);
}

export function getLandCellKey(cell: LandCell): string {
  return `${cell.x}:${cell.z}`;
}

export function getLandFillStatus(
  rawPoint: PlacementPoint,
  playerPosition: PlacementPoint,
  landCells: readonly LandCellRecord[],
): LandFillStatus {
  const cell = toExpansionCell(rawPoint);
  const point = getExpansionCellCenter(cell);

  if (isOriginalIsland(point) || hasCell(landCells, cell)) {
    return {
      ok: false,
      point,
      cell,
      reason: "existing_land",
    };
  }

  if (Math.hypot(point.x, point.z) > MAX_EXPANSION_RADIUS) {
    return {
      ok: false,
      point,
      cell,
      reason: "too_far",
    };
  }

  if (getHorizontalDistance(point, playerPosition) < MIN_PLAYER_PLACEMENT_DISTANCE) {
    return {
      ok: false,
      point,
      cell,
      reason: "too_close_to_player",
    };
  }

  if (!isAdjacentToLand(cell, landCells)) {
    return {
      ok: false,
      point,
      cell,
      reason: "not_adjacent",
    };
  }

  return {
    ok: true,
    point,
    cell,
    reason: null,
  };
}

export function getLandRemoveStatus(
  rawPoint: PlacementPoint,
  landCells: readonly LandCellRecord[],
  occupiedTargets: readonly { position: PlacementPoint; radius?: number }[] = [],
): LandRemoveStatus {
  const cell = toExpansionCell(rawPoint);
  const point = getExpansionCellCenter(cell);

  if (!hasCell(landCells, cell)) {
    return {
      ok: false,
      point,
      cell,
      reason: "no_land",
    };
  }

  if (occupiedTargets.some((target) => getLandCellKey(toExpansionCell(target.position)) === getLandCellKey(cell))) {
    return {
      ok: false,
      point,
      cell,
      reason: "occupied",
    };
  }

  if (!remainingLandStaysConnectedToIsland(cell, landCells)) {
    return {
      ok: false,
      point,
      cell,
      reason: "would_orphan_land",
    };
  }

  return {
    ok: true,
    point,
    cell,
    reason: null,
  };
}

export function findLatestRemovableLandStatus(
  landCells: readonly LandCellRecord[],
  occupiedTargets: readonly { position: PlacementPoint; radius?: number }[] = [],
): LandRemoveStatus {
  for (let index = landCells.length - 1; index >= 0; index -= 1) {
    const status = getLandRemoveStatus(
      getExpansionCellCenter(landCells[index].cell),
      landCells,
      occupiedTargets,
    );
    if (status.ok) {
      return status;
    }
  }

  return {
    ok: false,
    point: { x: 0, y: 0, z: 0 },
    cell: { x: 0, z: 0 },
    reason: "no_removable_land",
  };
}

export function getWorldTerrainStatus(
  point: PlacementPoint,
  landCells: readonly LandCellRecord[],
): WorldTerrainStatus {
  if (isOriginalIsland(point)) {
    return "original_island";
  }

  if (isPointOnExpandedLand(point, landCells)) {
    return "expanded_land";
  }

  return "water";
}

export function isPointOnExpandedLand(
  point: PlacementPoint,
  landCells: readonly LandCellRecord[],
): boolean {
  return hasCell(landCells, toExpansionCell(point));
}

export function getLandLocationLabel(cell: LandCell): string {
  const center = getExpansionCellCenter(cell);
  if (center.x < -2.2 && center.z < 0.4) {
    return "the cottage shoreline";
  }
  if (center.x > 2.0 || center.z < -2.6) {
    return "the garden shoreline";
  }
  if (center.z > 2.4) {
    return "the front shore";
  }
  return "the shoreline";
}

export function serializeLandCells(records: readonly LandCellRecord[]): string {
  return JSON.stringify({
    version: LAND_STORAGE_VERSION,
    cells: records,
  });
}

export function parseLandCells(value: string | null): LandCellRecord[] {
  if (!value) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (!isStoredLandPayload(parsed)) {
      return [];
    }

    return parsed.cells.flatMap((item) => {
      if (!isLandCellRecordLike(item)) {
        return [];
      }

      return [
        createLandCellRecord(
          {
            x: item.cell.x,
            z: item.cell.z,
          },
          item.id,
        ),
      ];
    });
  } catch {
    return [];
  }
}

function isAdjacentToLand(
  cell: LandCell,
  landCells: readonly LandCellRecord[],
): boolean {
  return getNeighborCells(cell).some((neighbor) => {
    const center = getExpansionCellCenter(neighbor);
    return isOriginalIsland(center) || hasCell(landCells, neighbor);
  });
}

function getNeighborCells(cell: LandCell): LandCell[] {
  return [
    { x: cell.x + 1, z: cell.z },
    { x: cell.x - 1, z: cell.z },
    { x: cell.x, z: cell.z + 1 },
    { x: cell.x, z: cell.z - 1 },
  ];
}

function hasCell(
  landCells: readonly LandCellRecord[],
  cell: LandCell,
): boolean {
  const key = getLandCellKey(cell);
  return landCells.some((record) => getLandRecordKey(record) === key);
}

function remainingLandStaysConnectedToIsland(
  removedCell: LandCell,
  landCells: readonly LandCellRecord[],
): boolean {
  const removedKey = getLandCellKey(removedCell);
  const remainingCells = landCells
    .map((record) => record.cell)
    .filter((cell) => getLandCellKey(cell) !== removedKey);

  if (remainingCells.length === 0) {
    return true;
  }

  const reachable = new Set<string>();
  const frontier = remainingCells.filter((cell) => isAdjacentToOriginalIsland(cell));
  for (const cell of frontier) {
    reachable.add(getLandCellKey(cell));
  }

  while (frontier.length > 0) {
    const current = frontier.pop();
    if (!current) {
      break;
    }

    for (const neighbor of getNeighborCells(current)) {
      const key = getLandCellKey(neighbor);
      if (reachable.has(key) || !remainingCells.some((cell) => getLandCellKey(cell) === key)) {
        continue;
      }

      reachable.add(key);
      frontier.push(neighbor);
    }
  }

  return remainingCells.every((cell) => reachable.has(getLandCellKey(cell)));
}

function isAdjacentToOriginalIsland(cell: LandCell): boolean {
  return getNeighborCells(cell).some((neighbor) => isOriginalIsland(getExpansionCellCenter(neighbor)));
}

function isOriginalIsland(point: PlacementPoint): boolean {
  return Math.hypot(point.x, point.z) <= ISLAND_RADIUS;
}

function getHorizontalDistance(a: PlacementPoint, b: PlacementPoint) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function isStoredLandPayload(
  value: unknown,
): value is { version: number; cells: unknown[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    "cells" in value &&
    (value as { version: unknown }).version === LAND_STORAGE_VERSION &&
    Array.isArray((value as { cells: unknown }).cells)
  );
}

function isLandCellRecordLike(value: unknown): value is LandCellRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as {
    id?: unknown;
    cell?: {
      x?: unknown;
      z?: unknown;
    };
  };

  return (
    typeof candidate.id === "string" &&
    typeof candidate.cell === "object" &&
    candidate.cell !== null &&
    Number.isInteger(candidate.cell.x) &&
    Number.isInteger(candidate.cell.z)
  );
}
