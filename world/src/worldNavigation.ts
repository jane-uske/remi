import { ISLAND_RADIUS } from "./worldPlacement";
import {
  getWorldTerrainStatus,
  type LandCellRecord,
} from "./worldExpansion";

export interface NavigationPoint {
  x: number;
  y: number;
  z: number;
}

type SolidBlocker =
  | {
      type: "rect";
      minX: number;
      maxX: number;
      minZ: number;
      maxZ: number;
    }
  | {
      type: "circle";
      x: number;
      z: number;
      radius: number;
    };

const PLAYER_RADIUS = 0.32;

const SOLID_BLOCKERS: readonly SolidBlocker[] = [
  {
    type: "rect",
    minX: -4.18,
    maxX: 0.22,
    minZ: -3.32,
    maxZ: 1.42,
  },
  {
    type: "rect",
    minX: 3.48,
    maxX: 3.72,
    minZ: 0.56,
    maxZ: 3.12,
  },
  {
    type: "rect",
    minX: -4.62,
    maxX: -1.58,
    minZ: -0.56,
    maxZ: -0.34,
  },
  {
    type: "circle",
    x: 3.85,
    z: 1.25,
    radius: 0.36,
  },
  {
    type: "circle",
    x: -4.65,
    z: 0.65,
    radius: 0.36,
  },
];

export function constrainPlayerPosition(
  candidate: NavigationPoint,
  previous: NavigationPoint,
  landCells: readonly LandCellRecord[] = [],
): NavigationPoint {
  const terrainPosition = constrainToWalkableTerrain(candidate, previous, landCells);

  if (SOLID_BLOCKERS.some((blocker) => isInsideSolidBlocker(terrainPosition, blocker))) {
    return keepPreviousHorizontalPosition(candidate, previous);
  }

  return terrainPosition;
}

function constrainToWalkableTerrain(
  candidate: NavigationPoint,
  previous: NavigationPoint,
  landCells: readonly LandCellRecord[],
): NavigationPoint {
  const candidateTerrain = getWorldTerrainStatus(candidate, landCells);
  if (candidateTerrain !== "water") {
    return candidate;
  }

  if (getWorldTerrainStatus(previous, landCells) === "expanded_land") {
    return keepPreviousHorizontalPosition(candidate, previous);
  }

  return clampToIsland(candidate);
}

function clampToIsland(point: NavigationPoint): NavigationPoint {
  const distance = Math.hypot(point.x, point.z);
  if (distance <= ISLAND_RADIUS) {
    return point;
  }

  const angle = Math.atan2(point.z, point.x);
  return {
    x: Math.cos(angle) * ISLAND_RADIUS,
    y: point.y,
    z: Math.sin(angle) * ISLAND_RADIUS,
  };
}

function keepPreviousHorizontalPosition(
  candidate: NavigationPoint,
  previous: NavigationPoint,
): NavigationPoint {
  return {
    x: previous.x,
    y: candidate.y,
    z: previous.z,
  };
}

function isInsideSolidBlocker(point: NavigationPoint, blocker: SolidBlocker) {
  if (blocker.type === "circle") {
    return Math.hypot(point.x - blocker.x, point.z - blocker.z) <=
      blocker.radius + PLAYER_RADIUS;
  }

  return (
    point.x >= blocker.minX - PLAYER_RADIUS &&
    point.x <= blocker.maxX + PLAYER_RADIUS &&
    point.z >= blocker.minZ - PLAYER_RADIUS &&
    point.z <= blocker.maxZ + PLAYER_RADIUS
  );
}
