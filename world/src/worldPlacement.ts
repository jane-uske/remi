import {
  getWorldTerrainStatus,
  type LandCellRecord,
} from "./worldExpansion";

export interface PlacementPoint {
  x: number;
  y: number;
  z: number;
}

export const ISLAND_RADIUS = 5.35;
export const PLACEMENT_MARGIN = 0.42;
export const PLACEMENT_RADIUS = ISLAND_RADIUS - PLACEMENT_MARGIN;
export const WATER_PREVIEW_RADIUS = ISLAND_RADIUS + 0.45;
export const MIN_PLAYER_PLACEMENT_DISTANCE = 0.95;
export const DEFAULT_REMOVE_TARGET_RADIUS = 0.82;

export type PlacementInvalidReason =
  | "water"
  | "cottage"
  | "too_close_to_player"
  | "occupied";

export type PlacementStatus =
  | {
      ok: true;
      point: PlacementPoint;
      reason: null;
    }
  | {
      ok: false;
      point: PlacementPoint;
      reason: PlacementInvalidReason;
    };

export interface PlacedObjectTarget {
  position: PlacementPoint;
  radius?: number;
}

export interface PlacementRay {
  origin: PlacementPoint;
  direction: PlacementPoint;
}

const PLACEMENT_BLOCKERS = [
  {
    reason: "cottage" as const,
    minX: -4.18,
    maxX: 0.18,
    minZ: -3.38,
    maxZ: -0.78,
  },
];

export function clampPlacementToIsland(point: PlacementPoint): PlacementPoint {
  return clampPlacementToRadius(point, PLACEMENT_RADIUS);
}

function clampPlacementToRadius(
  point: PlacementPoint,
  radius: number,
): PlacementPoint {
  const distance = Math.hypot(point.x, point.z);
  if (distance <= radius) {
    return { x: point.x, y: 0, z: point.z };
  }

  const angle = Math.atan2(point.z, point.x);
  return {
    x: Math.cos(angle) * radius,
    y: 0,
    z: Math.sin(angle) * radius,
  };
}

export function getPlacementStatus(
  rawPoint: PlacementPoint,
  playerPosition: PlacementPoint,
  occupiedTargets: readonly PlacedObjectTarget[] = [],
  landCells: readonly LandCellRecord[] = [],
): PlacementStatus {
  const terrainStatus = getWorldTerrainStatus(rawPoint, landCells);
  const point =
    terrainStatus === "expanded_land"
      ? { x: rawPoint.x, y: 0, z: rawPoint.z }
      : clampPlacementToIsland(rawPoint);

  if (
    terrainStatus !== "expanded_land" &&
    Math.hypot(rawPoint.x, rawPoint.z) > PLACEMENT_RADIUS
  ) {
    return {
      ok: false,
      point: clampPlacementToRadius(rawPoint, WATER_PREVIEW_RADIUS),
      reason: "water",
    };
  }

  if (getHorizontalDistance(point, playerPosition) < MIN_PLAYER_PLACEMENT_DISTANCE) {
    return {
      ok: false,
      point,
      reason: "too_close_to_player",
    };
  }

  for (const blocker of PLACEMENT_BLOCKERS) {
    if (
      point.x >= blocker.minX &&
      point.x <= blocker.maxX &&
      point.z >= blocker.minZ &&
      point.z <= blocker.maxZ
    ) {
      return {
        ok: false,
        point,
        reason: blocker.reason,
      };
    }
  }

  if (findTargetPlacedObjectIndex(occupiedTargets, point, 0.18) >= 0) {
    return {
      ok: false,
      point,
      reason: "occupied",
    };
  }

  return {
    ok: true,
    point,
    reason: null,
  };
}

export function findNearbyValidPlacementStatus(
  rawPoint: PlacementPoint,
  playerPosition: PlacementPoint,
  occupiedTargets: readonly PlacedObjectTarget[] = [],
  landCells: readonly LandCellRecord[] = [],
): PlacementStatus {
  for (const offset of NEARBY_PLACEMENT_OFFSETS) {
    const status = getPlacementStatus(
      {
        x: rawPoint.x + offset.x,
        y: 0,
        z: rawPoint.z + offset.z,
      },
      playerPosition,
      occupiedTargets,
      landCells,
    );

    if (status.ok) {
      return status;
    }
  }

  return getPlacementStatus(rawPoint, playerPosition, occupiedTargets, landCells);
}

export function findTargetPlacedObjectIndex(
  objects: readonly PlacedObjectTarget[],
  aimPoint: PlacementPoint,
  extraPadding = 0.08,
): number {
  let bestIndex = -1;
  let bestNormalizedDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < objects.length; index += 1) {
    const object = objects[index];
    const radius = object.radius ?? DEFAULT_REMOVE_TARGET_RADIUS;
    const distance = getHorizontalDistance(object.position, aimPoint);
    const allowedDistance = radius + extraPadding;
    if (distance > allowedDistance) {
      continue;
    }

    const normalizedDistance = distance / allowedDistance;
    if (normalizedDistance < bestNormalizedDistance) {
      bestNormalizedDistance = normalizedDistance;
      bestIndex = index;
    }
  }

  return bestIndex;
}

export function findTargetPlacedObjectIndexFromRay(
  objects: readonly PlacedObjectTarget[],
  origin: PlacementPoint,
  direction: PlacementPoint,
  maxDistance = 8,
  extraPadding = 0.08,
): number {
  const horizontalLength = Math.hypot(direction.x, direction.z);
  if (horizontalLength <= 0.001) {
    return -1;
  }

  const rayX = direction.x / horizontalLength;
  const rayZ = direction.z / horizontalLength;
  let bestIndex = -1;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let index = 0; index < objects.length; index += 1) {
    const object = objects[index];
    const toObjectX = object.position.x - origin.x;
    const toObjectZ = object.position.z - origin.z;
    const projectedDistance = toObjectX * rayX + toObjectZ * rayZ;
    if (projectedDistance < 0 || projectedDistance > maxDistance) {
      continue;
    }

    const closestX = origin.x + rayX * projectedDistance;
    const closestZ = origin.z + rayZ * projectedDistance;
    const missDistance = Math.hypot(
      object.position.x - closestX,
      object.position.z - closestZ,
    );
    const allowedDistance = (object.radius ?? DEFAULT_REMOVE_TARGET_RADIUS) + extraPadding;
    if (missDistance > allowedDistance) {
      continue;
    }

    const score = missDistance / allowedDistance + projectedDistance * 0.01;
    if (score < bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestIndex;
}

export function findNearestPlacedObjectIndex(
  objects: readonly PlacedObjectTarget[],
  aimPoint: PlacementPoint,
  maxDistance = DEFAULT_REMOVE_TARGET_RADIUS,
): number {
  let nearestIndex = -1;
  let nearestDistance = maxDistance;

  for (let index = 0; index < objects.length; index += 1) {
    const distance = getHorizontalDistance(objects[index].position, aimPoint);
    if (distance <= nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  }

  return nearestIndex;
}

export function getPlacementLocationLabel(position: PlacementPoint): string {
  if (position.z > 3.1) {
    return "the shore path";
  }
  if (position.x < -2.6 && position.z < -0.8) {
    return "near the cottage";
  }
  if (position.x > 1.6 && position.z < 1.2) {
    return "beside the garden sign";
  }
  if (position.x > 2.5) {
    return "the apple tree corner";
  }
  return "the front garden";
}

function getHorizontalDistance(a: PlacementPoint, b: PlacementPoint) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

const NEARBY_PLACEMENT_OFFSETS: ReadonlyArray<{ x: number; z: number }> = [
  { x: 0, z: -0.56 },
  { x: 0.56, z: 0 },
  { x: -0.56, z: 0 },
  { x: 0, z: 0.56 },
  { x: 0.4, z: -0.4 },
  { x: -0.4, z: -0.4 },
  { x: 0.4, z: 0.4 },
  { x: -0.4, z: 0.4 },
  { x: 0.88, z: 0 },
  { x: -0.88, z: 0 },
  { x: 0, z: 0.88 },
  { x: 0, z: -0.88 },
];
