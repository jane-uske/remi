import { FreeCamera } from "@babylonjs/core";

import {
  getLandFillStatus,
  type LandCellRecord,
  type LandFillStatus,
  type LandRemoveStatus,
} from "./worldExpansion";
import {
  getPlacementStatus,
  type PlacedObjectTarget,
  type PlacementPoint,
  type PlacementStatus,
} from "./worldPlacement";
import type { WorldObjectKind } from "./worldObjects";

export type CurrentPlacementStatus = PlacementStatus | LandFillStatus;

interface PlacedObjectTargetSource {
  root: {
    position: PlacementPoint;
  };
  radius: number;
}

export function getPlacedObjectTargets(
  placedObjects: readonly PlacedObjectTargetSource[],
): PlacedObjectTarget[] {
  return placedObjects.map((object) => ({
    position: object.root.position,
    radius: object.radius,
  }));
}

export function getPlacementStatusFromCamera(
  camera: FreeCamera,
  selectedObject: WorldObjectKind,
  placedObjects: readonly PlacedObjectTargetSource[],
  landCells: readonly LandCellRecord[],
): CurrentPlacementStatus {
  const rawPoint = getRawPlacementPoint(camera);
  if (selectedObject === "land_fill") {
    return getLandFillStatus(rawPoint, camera.position, landCells);
  }

  return getPlacementStatus(
    rawPoint,
    camera.position,
    getPlacedObjectTargets(placedObjects),
    landCells,
  );
}

export function getRawPlacementPoint(camera: FreeCamera): PlacementPoint {
  const ray = camera.getForwardRay(8);

  if (Math.abs(ray.direction.y) > 0.001) {
    const t = -ray.origin.y / ray.direction.y;
    if (t > 0.35 && t < 8) {
      return ray.origin.add(ray.direction.scale(t));
    }
  }

  return ray.origin.add(ray.direction.scale(2.4));
}

export function getInvalidPlacementHint(reason: PlacementStatus["reason"]) {
  if (reason === "water") {
    return "That spot is off the island. Keep the detail on dry ground.";
  }
  if (reason === "cottage") {
    return "Leave the cottage entrance clear. Tidy the garden path instead.";
  }
  if (reason === "too_close_to_player") {
    return "Step back a little before placing that detail.";
  }
  if (reason === "occupied") {
    return "That spot already has a detail. Aim at a clear patch nearby.";
  }

  return "Aim at a clear patch of island ground before placing.";
}

export function getInvalidLandFillHint(reason: LandFillStatus["reason"]) {
  if (reason === "existing_land") {
    return "That patch is already land. Aim just beyond the shoreline.";
  }
  if (reason === "too_far") {
    return "That patch is too far from the island for this first expansion.";
  }
  if (reason === "too_close_to_player") {
    return "Step back a little before filling that shoreline patch.";
  }
  if (reason === "not_adjacent") {
    return "Fill from the shoreline outward, one connected patch at a time.";
  }

  return "Aim at water touching the island edge to fill new land.";
}

export function getInvalidLandRemoveHint(reason: LandRemoveStatus["reason"]) {
  if (reason === "no_land") {
    return "Aim at a filled shoreline patch before removing land.";
  }
  if (reason === "occupied") {
    return "Move the decoration on that patch before removing the land.";
  }
  if (reason === "would_orphan_land") {
    return "Remove outer shoreline patches first so the island stays connected.";
  }
  if (reason === "no_removable_land") {
    return "No empty filled shoreline patch can be removed yet.";
  }

  return "Aim at an empty filled patch before removing land.";
}
