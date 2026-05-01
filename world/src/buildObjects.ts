import {
  Color3,
  MeshBuilder,
  PointLight,
  Scene,
  TransformNode,
  Vector3,
} from "@babylonjs/core";

import { createBox } from "./scenePrimitives";
import { type SceneMaterials } from "./sceneMaterials";
import { type WorldObjectKind } from "./worldObjects";
import { getWorldObjectRadius } from "./worldPlacedObjects";

export type PlacedObject = {
  id: string;
  kind: WorldObjectKind;
  root: TransformNode;
  radius: number;
};

export function createBuildObject(
  scene: Scene,
  materials: SceneMaterials,
  kind: WorldObjectKind,
  position: Vector3,
  placedObjects: PlacedObject[],
  id: string,
) {
  const root = new TransformNode(`${kind}-root`, scene);
  root.position = position.clone();

  if (kind === "lamp") {
    createLampPost(scene, materials, new Vector3(0, 0, 0), root);
  } else if (kind === "blue_flower" || kind === "pink_flower") {
    createFlower(scene, materials, new Vector3(0, 0, 0), kind === "blue_flower", root);
  } else if (kind === "wood_block") {
    createBox(scene, "placed-wood-block", materials.woodBlock, {
      width: 0.62,
      height: 0.62,
      depth: 0.62,
      position: new Vector3(0, 0.31, 0),
      parent: root,
    });
  } else {
    createBox(scene, "placed-stone-block", materials.stone, {
      width: 0.62,
      height: 0.62,
      depth: 0.62,
      position: new Vector3(0, 0.31, 0),
      parent: root,
    });
  }

  const placedObject = {
    id,
    kind,
    root,
    radius: getWorldObjectRadius(kind),
  };
  placedObjects.push(placedObject);
  return placedObject;
}

export function createLampPost(
  scene: Scene,
  materials: SceneMaterials,
  position: Vector3,
  parent?: TransformNode,
) {
  createBox(scene, "lamp-post", materials.darkWood, {
    width: 0.13,
    height: 1.18,
    depth: 0.13,
    position: position.add(new Vector3(0, 0.59, 0)),
    parent,
  });
  createBox(scene, "lamp-arm", materials.darkWood, {
    width: 0.52,
    height: 0.08,
    depth: 0.08,
    position: position.add(new Vector3(0.2, 1.16, 0)),
    parent,
  });
  createBox(scene, "lamp-cap", materials.darkWood, {
    width: 0.32,
    height: 0.09,
    depth: 0.32,
    position: position.add(new Vector3(0.42, 1.04, 0)),
    parent,
  });
  createBox(scene, "lamp-base", materials.darkWood, {
    width: 0.26,
    height: 0.07,
    depth: 0.26,
    position: position.add(new Vector3(0.42, 0.79, 0)),
    parent,
  });
  const glow = MeshBuilder.CreateSphere(
    "warm-lantern-glow",
    { diameter: 0.16, segments: 8 },
    scene,
  );
  glow.position = position.add(new Vector3(0.42, 0.92, 0));
  glow.material = materials.lanternGlow;
  glow.parent = parent ?? null;

  const light = new PointLight("warm-lantern-light", glow.position.clone(), scene);
  light.diffuse = new Color3(1, 0.56, 0.2);
  light.intensity = parent ? 0.34 : 0.54;
  light.range = parent ? 2.2 : 3.2;
  light.parent = parent ?? null;
}

export function createFlower(
  scene: Scene,
  materials: SceneMaterials,
  position: Vector3,
  isBlue: boolean,
  parent?: TransformNode,
) {
  const blossomMaterial = isBlue ? materials.blueFlower : materials.pinkFlower;
  for (let stem = 0; stem < 3; stem += 1) {
    const offset = new Vector3((stem - 1) * 0.055, 0, stem === 1 ? 0.035 : 0);
    createBox(scene, "flower-stem", materials.flowerStem, {
      width: 0.024,
      height: 0.16 + stem * 0.025,
      depth: 0.024,
      position: position.add(offset).add(new Vector3(0, 0.08 + stem * 0.012, 0)),
      rotationY: stem * 0.36,
      parent,
    });
    createBox(scene, isBlue ? "blue-flower-petal" : "pink-flower-petal", blossomMaterial, {
      width: 0.08,
      height: 0.045,
      depth: 0.08,
      position: position.add(offset).add(new Vector3(0, 0.18 + stem * 0.025, 0)),
      rotationY: stem * 0.7,
      parent,
    });
  }
}
