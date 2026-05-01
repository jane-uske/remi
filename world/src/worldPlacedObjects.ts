import {
  WORLD_OBJECT_LABELS,
  type WorldObjectKind,
} from "./worldObjects";
import { type PlacementPoint } from "./worldPlacement";

export interface PlacedObjectRecord {
  id: string;
  kind: WorldObjectKind;
  position: PlacementPoint;
}

const STORAGE_VERSION = 1;

const OBJECT_RADII: Record<WorldObjectKind, number> = {
  lamp: 0.42,
  blue_flower: 0.22,
  pink_flower: 0.22,
  wood_block: 0.46,
  stone_block: 0.46,
  land_fill: 0.46,
};

export function createPlacedObjectRecord(
  kind: WorldObjectKind,
  position: PlacementPoint,
  id: string,
): PlacedObjectRecord {
  return {
    id,
    kind,
    position: normalizePlacementPoint(position),
  };
}

export function getWorldObjectRadius(kind: WorldObjectKind): number {
  return OBJECT_RADII[kind];
}

export function serializePlacedObjects(
  records: readonly PlacedObjectRecord[],
): string {
  return JSON.stringify({
    version: STORAGE_VERSION,
    objects: records,
  });
}

export function parsePlacedObjects(value: string | null): PlacedObjectRecord[] {
  if (!value) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (!isStoredPayload(parsed)) {
      return [];
    }

    return parsed.objects.flatMap((item) => {
      if (!isPlacedObjectRecordLike(item)) {
        return [];
      }

      return [
        createPlacedObjectRecord(
          item.kind,
          item.position,
          item.id,
        ),
      ];
    });
  } catch {
    return [];
  }
}

function normalizePlacementPoint(point: PlacementPoint): PlacementPoint {
  return {
    x: point.x,
    y: 0,
    z: point.z,
  };
}

function isStoredPayload(
  value: unknown,
): value is { version: number; objects: unknown[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    "objects" in value &&
    (value as { version: unknown }).version === STORAGE_VERSION &&
    Array.isArray((value as { objects: unknown }).objects)
  );
}

function isPlacedObjectRecordLike(
  value: unknown,
): value is PlacedObjectRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as {
    id?: unknown;
    kind?: unknown;
    position?: {
      x?: unknown;
      y?: unknown;
      z?: unknown;
    };
  };

  return (
    typeof candidate.id === "string" &&
    typeof candidate.kind === "string" &&
    candidate.kind in WORLD_OBJECT_LABELS &&
    candidate.kind !== "land_fill" &&
    typeof candidate.position === "object" &&
    candidate.position !== null &&
    Number.isFinite(candidate.position.x) &&
    Number.isFinite(candidate.position.z)
  );
}
