import {
  MeshBuilder,
  Scene,
  Vector3,
} from "@babylonjs/core";

import { createBox } from "../scenePrimitives";
import { type SceneMaterials } from "../sceneMaterials";

export function createIslandBase(scene: Scene, materials: SceneMaterials) {
  const water = MeshBuilder.CreateCylinder(
    "evening-water",
    { diameter: 28, height: 0.04, tessellation: 128 },
    scene,
  );
  water.position.y = -0.68;
  water.material = materials.water;

  const island = MeshBuilder.CreateCylinder(
    "round-island",
    { diameter: 12.4, height: 0.65, tessellation: 72 },
    scene,
  );
  island.position.y = -0.32;
  island.material = materials.grass;

  const earth = MeshBuilder.CreateCylinder(
    "earth-edge",
    { diameter: 12.55, height: 0.75, tessellation: 72 },
    scene,
  );
  earth.position.y = -0.48;
  earth.material = materials.earth;

  for (let index = 0; index < 9; index += 1) {
    createBox(scene, `path-stone-${index}`, materials.path, {
      width: 0.92,
      height: 0.05,
      depth: 0.72,
      position: new Vector3(
        -0.15 - index * 0.22,
        0.03,
        3.18 - index * 0.55,
      ),
      rotationY: index % 2 === 0 ? 0.15 : -0.08,
    });
  }

  createBox(scene, "porch-step", materials.path, {
    width: 1.6,
    height: 0.08,
    depth: 0.64,
    position: new Vector3(-1.95, 0.06, -1.04),
  });

  for (let index = 0; index < 3; index += 1) {
    createVoxelCloud(scene, materials, new Vector3(-4.8 + index * 4.4, 5.8 + index * 0.35, -10.5 - index));
  }
}

export function createBackgroundIslands(scene: Scene, materials: SceneMaterials) {
  for (let index = 0; index < 5; index += 1) {
    const island = MeshBuilder.CreateCylinder(
      `distant-island-${index}`,
      { diameter: 1.8 + index * 0.32, height: 0.18, tessellation: 12 },
      scene,
    );
    island.position = new Vector3(
      -7.5 + index * 3.3,
      -0.52,
      -12.5 - Math.cos(index) * 2,
    );
    island.material = materials.distant;

    if (index % 2 === 0) {
      createBox(scene, `distant-tree-${index}`, materials.distantTree, {
        width: 0.18,
        height: 0.56,
        depth: 0.18,
        position: island.position.add(new Vector3(0.18, 0.36, -0.08)),
      });
      createBox(scene, `distant-canopy-${index}`, materials.distantTree, {
        width: 0.56,
        height: 0.44,
        depth: 0.56,
        position: island.position.add(new Vector3(0.18, 0.76, -0.08)),
      });
    }

    if (index === 3) {
      const lightDot = MeshBuilder.CreateSphere(
        "distant-cottage-light",
        { diameter: 0.12, segments: 8 },
        scene,
      );
      lightDot.position = island.position.add(new Vector3(-0.22, 0.26, -0.2));
      lightDot.material = materials.distantLight;
    }
  }
}

function createVoxelCloud(
  scene: Scene,
  materials: SceneMaterials,
  position: Vector3,
) {
  for (const [index, offset] of [
    new Vector3(0, 0, 0),
    new Vector3(0.42, 0.08, 0),
    new Vector3(-0.42, 0.04, 0),
    new Vector3(0.12, 0.22, 0.05),
  ].entries()) {
    createBox(scene, `dusk-cloud-${index}`, materials.cloud, {
      width: 0.66,
      height: 0.32,
      depth: 0.32,
      position: position.add(offset),
      rotationY: index * 0.08,
    });
  }
}
