import {
  Color3,
  Mesh,
  MeshBuilder,
  Scene,
  TransformNode,
  Vector3,
} from "@babylonjs/core";

import { EXPANSION_CELL_SIZE } from "./worldExpansion";
import type { SceneMaterials } from "./sceneMaterials";
import type { WorldObjectKind } from "./worldObjects";

export interface PreviewPlacementStatus {
  ok: boolean;
  point: {
    x: number;
    y: number;
    z: number;
  };
}

export interface PlacementPreview {
  root: TransformNode;
  base: Mesh;
  ring: Mesh;
  marker: Mesh;
  landTile: Mesh;
  landEdges: Mesh[];
}

const LAND_PREVIEW_SIZE = EXPANSION_CELL_SIZE * 0.96;

export function createPlacementPreview(
  scene: Scene,
  materials: SceneMaterials,
): PlacementPreview {
  const root = new TransformNode("placement-preview", scene);
  const base = MeshBuilder.CreateCylinder(
    "placement-preview-base",
    { diameter: 1.02, height: 0.04, tessellation: 32 },
    scene,
  );
  base.position.y = 0.02;
  base.material = materials.placementGhost;
  base.parent = root;

  const ring = MeshBuilder.CreateTorus(
    "placement-preview-ring",
    { diameter: 1.05, thickness: 0.025, tessellation: 36 },
    scene,
  );
  ring.position.y = 0.06;
  ring.material = materials.placementGhostAccent;
  ring.parent = root;

  const marker = MeshBuilder.CreateBox(
    "placement-preview-marker",
    { width: 0.24, height: 0.24, depth: 0.24 },
    scene,
  );
  marker.position.y = 0.22;
  marker.material = materials.placementGhostAccent;
  marker.parent = root;

  const landTile = MeshBuilder.CreateBox(
    "placement-preview-land-tile",
    { width: LAND_PREVIEW_SIZE, height: 0.035, depth: LAND_PREVIEW_SIZE },
    scene,
  );
  landTile.position.y = 0.018;
  landTile.material = materials.placementGhost;
  landTile.parent = root;

  const landEdges = [
    createPreviewLandEdge(
      scene,
      materials,
      "placement-preview-land-edge-front",
      LAND_PREVIEW_SIZE,
      0.035,
      new Vector3(0, 0.055, LAND_PREVIEW_SIZE / 2),
    ),
    createPreviewLandEdge(
      scene,
      materials,
      "placement-preview-land-edge-back",
      LAND_PREVIEW_SIZE,
      0.035,
      new Vector3(0, 0.055, -LAND_PREVIEW_SIZE / 2),
    ),
    createPreviewLandEdge(
      scene,
      materials,
      "placement-preview-land-edge-left",
      0.035,
      LAND_PREVIEW_SIZE,
      new Vector3(-LAND_PREVIEW_SIZE / 2, 0.055, 0),
    ),
    createPreviewLandEdge(
      scene,
      materials,
      "placement-preview-land-edge-right",
      0.035,
      LAND_PREVIEW_SIZE,
      new Vector3(LAND_PREVIEW_SIZE / 2, 0.055, 0),
    ),
  ];
  for (const edge of landEdges) {
    edge.parent = root;
  }

  return {
    root,
    base,
    ring,
    marker,
    landTile,
    landEdges,
  };
}

export function updatePlacementPreview(
  placementPreview: PlacementPreview,
  materials: SceneMaterials,
  selectedObject: WorldObjectKind,
  status: PreviewPlacementStatus,
  previewAlpha: number,
) {
  placementPreview.root.position = toVector3(status.point);
  placementPreview.root.position.y = getPlacementPreviewHeight(
    selectedObject,
    status,
  );
  applyPlacementPreviewMode(placementPreview, selectedObject);
  applyPlacementPreviewStyle(
    placementPreview,
    materials,
    status.ok,
    previewAlpha,
  );
}

export function getPlacementPreviewHeight(
  selectedObject: WorldObjectKind,
  status: PreviewPlacementStatus,
) {
  if (selectedObject === "land_fill") {
    return status.ok ? 0.02 : 0.12;
  }

  return status.ok ? 0.035 : 0.14;
}

function createPreviewLandEdge(
  scene: Scene,
  materials: SceneMaterials,
  name: string,
  width: number,
  depth: number,
  position: Vector3,
) {
  const edge = MeshBuilder.CreateBox(
    name,
    { width, height: 0.04, depth },
    scene,
  );
  edge.position = position;
  edge.material = materials.placementGhostAccent;
  return edge;
}

function applyPlacementPreviewMode(
  placementPreview: PlacementPreview,
  selectedObject: WorldObjectKind,
) {
  const isLandFill = selectedObject === "land_fill";
  placementPreview.base.isVisible = !isLandFill;
  placementPreview.ring.isVisible = !isLandFill;
  placementPreview.marker.isVisible = !isLandFill;
  placementPreview.landTile.isVisible = isLandFill;
  for (const edge of placementPreview.landEdges) {
    edge.isVisible = isLandFill;
  }
}

function applyPlacementPreviewStyle(
  placementPreview: PlacementPreview,
  materials: SceneMaterials,
  placementAllowed: boolean,
  previewAlpha: number,
) {
  setPlacementPreviewColors(materials, placementAllowed);
  materials.placementGhost.alpha = placementAllowed ? previewAlpha : 0.72;
  materials.placementGhostAccent.alpha = placementAllowed
    ? Math.min(0.72, previewAlpha + 0.16)
    : 0.92;

  const previewPulse = placementAllowed ? previewAlpha * 0.08 : 0.18;
  placementPreview.root.scaling = new Vector3(
    1 + previewPulse,
    1,
    1 + previewPulse,
  );
}

function setPlacementPreviewColors(
  materials: SceneMaterials,
  placementAllowed: boolean,
) {
  if (placementAllowed) {
    materials.placementGhost.diffuseColor = new Color3(0.92, 0.98, 0.86);
    materials.placementGhost.emissiveColor = new Color3(0.26, 0.42, 0.18);
    materials.placementGhostAccent.diffuseColor = new Color3(0.86, 1, 0.56);
    materials.placementGhostAccent.emissiveColor = new Color3(0.26, 0.38, 0.12);
    return;
  }

  materials.placementGhost.diffuseColor = new Color3(1, 0.22, 0.14);
  materials.placementGhost.emissiveColor = new Color3(0.9, 0.12, 0.04);
  materials.placementGhostAccent.diffuseColor = new Color3(1, 0.82, 0.16);
  materials.placementGhostAccent.emissiveColor = new Color3(0.95, 0.32, 0.02);
}

function toVector3(point: { x: number; y: number; z: number }) {
  return new Vector3(point.x, point.y, point.z);
}
