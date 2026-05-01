import {
  MeshBuilder,
  Scene,
  Vector3,
} from "@babylonjs/core";

import {
  createFlower,
  createLampPost,
} from "../buildObjects";
import { createBox } from "../scenePrimitives";
import { type SceneMaterials } from "../sceneMaterials";

export function createCottage(scene: Scene, materials: SceneMaterials) {
  createBox(scene, "cottage-foundation", materials.stoneDark, {
    width: 3.58,
    height: 0.18,
    depth: 2.48,
    position: new Vector3(-2.35, 0.09, -2.08),
  });
  createBox(scene, "cottage-body", materials.woodWall, {
    width: 3.35,
    height: 1.58,
    depth: 2.25,
    position: new Vector3(-2.35, 0.82, -2.08),
  });
  createBox(scene, "cottage-front-trim", materials.darkWood, {
    width: 3.58,
    height: 0.2,
    depth: 0.14,
    position: new Vector3(-2.35, 1.48, -0.88),
  });
  for (let index = 0; index < 3; index += 1) {
    createBox(scene, `cottage-front-plank-shadow-${index}`, materials.darkWood, {
      width: 3.28,
      height: 0.045,
      depth: 0.08,
      position: new Vector3(-2.35, 0.42 + index * 0.34, -0.84),
    });
  }
  createBox(scene, "cottage-door", materials.door, {
    width: 0.62,
    height: 1.12,
    depth: 0.08,
    position: new Vector3(-2.25, 0.64, -0.91),
  });
  createBox(scene, "cottage-door-left-plank", materials.darkWood, {
    width: 0.04,
    height: 0.96,
    depth: 0.1,
    position: new Vector3(-2.46, 0.66, -0.86),
  });
  createBox(scene, "cottage-door-right-plank", materials.darkWood, {
    width: 0.04,
    height: 0.96,
    depth: 0.1,
    position: new Vector3(-2.04, 0.66, -0.86),
  });
  createBox(scene, "cottage-door-lintel", materials.roofTrim, {
    width: 0.82,
    height: 0.1,
    depth: 0.14,
    position: new Vector3(-2.25, 1.24, -0.82),
  });
  createBox(scene, "cottage-doormat", materials.weatheredWood, {
    width: 0.92,
    height: 0.035,
    depth: 0.42,
    position: new Vector3(-2.25, 0.08, -0.48),
  });
  const doorKnob = MeshBuilder.CreateSphere(
    "cottage-door-knob",
    { diameter: 0.08, segments: 8 },
    scene,
  );
  doorKnob.position = new Vector3(-2.04, 0.72, -0.84);
  doorKnob.material = materials.lanternGlow;

  createWindow(scene, materials, "left-window", new Vector3(-3.35, 0.9, -0.84), 0.62, 0.56);
  createWindow(scene, materials, "right-window", new Vector3(-1.12, 0.96, -0.84), 0.56, 0.52);

  for (let layer = 0; layer < 4; layer += 1) {
    createBox(scene, `block-roof-${layer}`, materials.roof, {
      width: 3.95 - layer * 0.42,
      height: 0.26,
      depth: 2.82 - layer * 0.38,
      position: new Vector3(-2.35, 1.7 + layer * 0.25, -2.08),
    });
  }
  createBox(scene, "roof-ridge-cap", materials.roofTrim, {
    width: 1.65,
    height: 0.12,
    depth: 0.36,
    position: new Vector3(-2.35, 2.56, -2.08),
  });
  createBox(scene, "roof-front-fascia", materials.roofTrim, {
    width: 4.12,
    height: 0.16,
    depth: 0.18,
    position: new Vector3(-2.35, 1.58, -0.72),
  });
  createBox(scene, "roof-back-fascia", materials.roofTrim, {
    width: 3.72,
    height: 0.14,
    depth: 0.14,
    position: new Vector3(-2.35, 1.58, -3.44),
  });
  for (const x of [-3.85, -2.35, -0.85]) {
    createBox(scene, "roof-under-beam", materials.darkWood, {
      width: 0.16,
      height: 0.14,
      depth: 0.42,
      position: new Vector3(x, 1.42, -0.68),
    });
  }

  createBox(scene, "chimney-a", materials.stone, {
    width: 0.42,
    height: 1.15,
    depth: 0.42,
    position: new Vector3(-3.26, 2.38, -2.65),
  });
  createBox(scene, "chimney-b", materials.stoneDark, {
    width: 0.5,
    height: 0.16,
    depth: 0.5,
    position: new Vector3(-3.26, 3.02, -2.65),
  });

  for (let index = 0; index < 5; index += 1) {
    const puff = MeshBuilder.CreateSphere(
      `smoke-puff-${index}`,
      { diameter: 0.28 + index * 0.04, segments: 8 },
      scene,
    );
    puff.position = new Vector3(
      -3.26 + Math.sin(index) * 0.18,
      3.22 + index * 0.28,
      -2.65 - index * 0.06,
    );
    puff.material = materials.smoke;
  }

  createLampPost(scene, materials, new Vector3(-0.72, 0, -0.95));
  createLampPost(scene, materials, new Vector3(2.75, 0, -0.55));
  createLeafTrail(scene, materials, new Vector3(-3.92, 1.46, -0.68));
  createCottageYardDetails(scene, materials);
}

function createCottageYardDetails(scene: Scene, materials: SceneMaterials) {
  createPlanterBox(scene, materials, new Vector3(-3.35, 0.42, -0.68), 0.86);
  createPlanterBox(scene, materials, new Vector3(-1.12, 0.44, -0.68), 0.78);
  createBench(scene, materials, new Vector3(-3.78, 0, -0.98));
  createWoodPile(scene, materials, new Vector3(-4.18, 0, -1.78));
  createBarrel(scene, materials, new Vector3(-0.62, 0, -1.54));
  createDoorPot(scene, materials, new Vector3(-2.82, 0, -0.55), true);
  createDoorPot(scene, materials, new Vector3(-1.68, 0, -0.55), false);
}

function createDoorPot(
  scene: Scene,
  materials: SceneMaterials,
  position: Vector3,
  isBlue: boolean,
) {
  const pot = MeshBuilder.CreateCylinder(
    "porch-flower-pot",
    { diameterTop: 0.26, diameterBottom: 0.18, height: 0.22, tessellation: 8 },
    scene,
  );
  pot.position = position.add(new Vector3(0, 0.11, 0));
  pot.material = materials.earth;
  createFlower(scene, materials, position.add(new Vector3(0, 0.16, 0)), isBlue);
}

function createLeafTrail(
  scene: Scene,
  materials: SceneMaterials,
  start: Vector3,
) {
  for (let index = 0; index < 5; index += 1) {
    createBox(scene, `cottage-vine-leaf-${index}`, materials.leaves, {
      width: 0.16,
      height: 0.12,
      depth: 0.08,
      position: start.add(new Vector3(0.18 * index, -0.16 * index, 0.02)),
      rotationY: index * 0.35,
    });
  }
}

function createPlanterBox(
  scene: Scene,
  materials: SceneMaterials,
  position: Vector3,
  width: number,
) {
  createBox(scene, "window-planter-box", materials.weatheredWood, {
    width,
    height: 0.16,
    depth: 0.22,
    position,
  });
  for (let index = 0; index < 3; index += 1) {
    createFlower(
      scene,
      materials,
      position.add(new Vector3(-width * 0.28 + index * width * 0.28, 0.08, 0)),
      index % 2 === 0,
    );
  }
}

function createBench(scene: Scene, materials: SceneMaterials, position: Vector3) {
  createBox(scene, "porch-bench-seat", materials.weatheredWood, {
    width: 0.95,
    height: 0.14,
    depth: 0.28,
    position: position.add(new Vector3(0, 0.36, 0)),
    rotationY: -0.16,
  });
  createBox(scene, "porch-bench-back", materials.weatheredWood, {
    width: 0.95,
    height: 0.42,
    depth: 0.12,
    position: position.add(new Vector3(0, 0.58, -0.15)),
    rotationY: -0.16,
  });
  for (const x of [-0.34, 0.34]) {
    createBox(scene, "porch-bench-leg", materials.darkWood, {
      width: 0.09,
      height: 0.34,
      depth: 0.09,
      position: position.add(new Vector3(x, 0.17, 0.06)),
      rotationY: -0.16,
    });
  }
}

function createWoodPile(scene: Scene, materials: SceneMaterials, position: Vector3) {
  for (let index = 0; index < 5; index += 1) {
    createBox(scene, `stacked-firewood-${index}`, materials.logWood, {
      width: 0.72,
      height: 0.13,
      depth: 0.16,
      position: position.add(
        new Vector3(0, 0.08 + Math.floor(index / 2) * 0.14, (index % 2) * 0.18),
      ),
      rotationY: 0.18 + index * 0.05,
    });
  }
}

function createBarrel(scene: Scene, materials: SceneMaterials, position: Vector3) {
  const barrel = MeshBuilder.CreateCylinder(
    "water-barrel",
    { diameterTop: 0.42, diameterBottom: 0.46, height: 0.68, tessellation: 10 },
    scene,
  );
  barrel.position = position.add(new Vector3(0, 0.34, 0));
  barrel.material = materials.weatheredWood;

  for (const y of [0.16, 0.52]) {
    createBox(scene, "barrel-band", materials.darkWood, {
      width: 0.5,
      height: 0.06,
      depth: 0.5,
      position: position.add(new Vector3(0, y, 0)),
    });
  }
}

function createWindow(
  scene: Scene,
  materials: SceneMaterials,
  name: string,
  position: Vector3,
  width: number,
  height: number,
) {
  createBox(scene, `${name}-glow`, materials.windowGlow, {
    width,
    height,
    depth: 0.08,
    position,
  });
  createBox(scene, `${name}-top-frame`, materials.windowFrame, {
    width: width + 0.18,
    height: 0.08,
    depth: 0.1,
    position: position.add(new Vector3(0, height / 2 + 0.05, 0.02)),
  });
  createBox(scene, `${name}-bottom-frame`, materials.windowFrame, {
    width: width + 0.18,
    height: 0.08,
    depth: 0.1,
    position: position.add(new Vector3(0, -height / 2 - 0.05, 0.02)),
  });
  createBox(scene, `${name}-left-frame`, materials.windowFrame, {
    width: 0.08,
    height: height + 0.18,
    depth: 0.1,
    position: position.add(new Vector3(-width / 2 - 0.05, 0, 0.02)),
  });
  createBox(scene, `${name}-right-frame`, materials.windowFrame, {
    width: 0.08,
    height: height + 0.18,
    depth: 0.1,
    position: position.add(new Vector3(width / 2 + 0.05, 0, 0.02)),
  });
  createBox(scene, `${name}-crossbar`, materials.windowFrame, {
    width: width + 0.04,
    height: 0.05,
    depth: 0.11,
    position: position.add(new Vector3(0, 0, 0.04)),
  });
  createBox(scene, `${name}-mullion`, materials.windowFrame, {
    width: 0.05,
    height: height + 0.04,
    depth: 0.11,
    position: position.add(new Vector3(0, 0, 0.04)),
  });
}
