import {
  MeshBuilder,
  Scene,
  TransformNode,
  Vector3,
} from "@babylonjs/core";

import { createBox } from "./scenePrimitives";
import { type SceneMaterials } from "./sceneMaterials";
import {
  EXPANSION_CELL_SIZE,
  getExpansionCellCenter,
  type LandCellRecord,
} from "./worldExpansion";

export interface RenderedLandCell {
  id: string;
  record: LandCellRecord;
  root: TransformNode;
}

export function createLandCellMesh(
  scene: Scene,
  materials: SceneMaterials,
  record: LandCellRecord,
) {
  const center = getExpansionCellCenter(record.cell);
  const root = new TransformNode(`${record.id}-root`, scene);
  root.position = new Vector3(center.x, 0, center.z);

  createBox(scene, "expanded-land-earth", materials.earth, {
    width: EXPANSION_CELL_SIZE * 1.02,
    height: 0.26,
    depth: EXPANSION_CELL_SIZE * 1.02,
    position: new Vector3(0, -0.13, 0),
    parent: root,
  });
  createBox(scene, "expanded-land-grass", materials.grass, {
    width: EXPANSION_CELL_SIZE * 1.06,
    height: 0.06,
    depth: EXPANSION_CELL_SIZE * 1.06,
    position: new Vector3(0, 0.03, 0),
    parent: root,
  });
  createShoreLip(scene, materials, root);
  createLandCellDetails(scene, materials, root, record);

  return {
    id: record.id,
    record,
    root,
  };
}

function createShoreLip(
  scene: Scene,
  materials: SceneMaterials,
  root: TransformNode,
) {
  const half = EXPANSION_CELL_SIZE / 2;
  const length = EXPANSION_CELL_SIZE * 1.05;

  createBox(scene, "expanded-land-shore-lip-front", materials.pathEdge, {
    width: length,
    height: 0.11,
    depth: 0.035,
    position: new Vector3(0, -0.005, half + 0.018),
    parent: root,
  });
  createBox(scene, "expanded-land-shore-lip-back", materials.pathEdge, {
    width: length,
    height: 0.11,
    depth: 0.035,
    position: new Vector3(0, -0.005, -half - 0.018),
    parent: root,
  });
  createBox(scene, "expanded-land-shore-lip-left", materials.pathEdge, {
    width: 0.035,
    height: 0.11,
    depth: length,
    position: new Vector3(-half - 0.018, -0.005, 0),
    parent: root,
  });
  createBox(scene, "expanded-land-shore-lip-right", materials.pathEdge, {
    width: 0.035,
    height: 0.11,
    depth: length,
    position: new Vector3(half + 0.018, -0.005, 0),
    parent: root,
  });
}

function createLandCellDetails(
  scene: Scene,
  materials: SceneMaterials,
  root: TransformNode,
  record: LandCellRecord,
) {
  const detailSeed = Math.abs(record.cell.x * 31 + record.cell.z * 17);
  const tuftCount = 2 + (detailSeed % 2);

  for (let index = 0; index < tuftCount; index += 1) {
    const x = getDetailOffset(detailSeed, index, 0.62);
    const z = getDetailOffset(detailSeed + 7, index, 0.62);
    createTinyGrassTuft(
      scene,
      materials,
      root,
      new Vector3(x, 0, z),
      detailSeed * 0.13 + index,
    );
  }

  if (detailSeed % 3 !== 0) {
    const pebble = MeshBuilder.CreateSphere(
      "expanded-land-pebble",
      { diameter: 0.08 + (detailSeed % 2) * 0.025, segments: 6 },
      scene,
    );
    pebble.position = new Vector3(
      getDetailOffset(detailSeed + 11, 0, 0.58),
      0.085,
      getDetailOffset(detailSeed + 19, 1, 0.58),
    );
    pebble.material = materials.stoneDark;
    pebble.parent = root;
  }
}

function createTinyGrassTuft(
  scene: Scene,
  materials: SceneMaterials,
  root: TransformNode,
  position: Vector3,
  rotationY: number,
) {
  for (let blade = 0; blade < 3; blade += 1) {
    createBox(scene, `expanded-land-grass-blade-${blade}`, materials.grassBlade, {
      width: 0.024,
      height: 0.12 + blade * 0.025,
      depth: 0.024,
      position: position.add(
        new Vector3((blade - 1) * 0.038, 0.12 + blade * 0.012, 0),
      ),
      rotationY: rotationY + blade * 0.46,
      parent: root,
    });
  }
}

function getDetailOffset(seed: number, index: number, span: number) {
  const value = Math.sin((seed + 1) * (index + 2) * 12.9898) * 43758.5453;
  return (value - Math.floor(value) - 0.5) * span;
}
