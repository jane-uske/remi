import {
  Scene,
  Vector3,
} from "@babylonjs/core";

import { createBox } from "../scenePrimitives";
import { type SceneMaterials } from "../sceneMaterials";

export function createWaterfront(scene: Scene, materials: SceneMaterials) {
  for (let index = 0; index < 8; index += 1) {
    createBox(scene, `shore-foam-${index}`, materials.waterFoam, {
      width: 0.46 + (index % 3) * 0.12,
      height: 0.025,
      depth: 0.08,
      position: new Vector3(
        -3.15 + index * 0.78,
        -0.58,
        4.78 + Math.sin(index * 0.8) * 0.2,
      ),
      rotationY: -0.12 + index * 0.09,
    });
  }

  for (let index = 0; index < 7; index += 1) {
    createBox(scene, `shore-stone-${index}`, materials.stone, {
      width: 0.34 + (index % 2) * 0.18,
      height: 0.12,
      depth: 0.32,
      position: new Vector3(
        -2.8 + index * 0.86,
        0.04,
        4.55 + Math.sin(index) * 0.28,
      ),
      rotationY: index * 0.3,
    });
  }

  for (let index = 0; index < 4; index += 1) {
    createBox(scene, `shore-plank-${index}`, materials.weatheredWood, {
      width: 0.76,
      height: 0.08,
      depth: 0.22,
      position: new Vector3(1.02 + index * 0.32, 0.08, 4.05 + index * 0.2),
      rotationY: -0.36,
    });
  }

  for (const offset of [0, 0.5]) {
    createBox(scene, "small-dock-post-left", materials.darkWood, {
      width: 0.12,
      height: 0.46,
      depth: 0.12,
      position: new Vector3(1.92 + offset, 0.28, 4.18 + offset * 0.65),
    });
    createBox(scene, "small-dock-post-right", materials.darkWood, {
      width: 0.12,
      height: 0.42,
      depth: 0.12,
      position: new Vector3(1.42 + offset, 0.25, 4.04 + offset * 0.65),
    });
  }
}
