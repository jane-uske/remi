import {
  Color3,
  DynamicTexture,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";

import { createFlower } from "../buildObjects";
import { createBox } from "../scenePrimitives";
import { type SceneMaterials } from "../sceneMaterials";
import { getHeroCameraPreset } from "../world/camera/heroCameraPreset";

export function createGarden(scene: Scene, materials: SceneMaterials) {
  const heroCamera = getHeroCameraPreset();

  createFenceLine(scene, materials, -4.55, -0.45, 6, 0);
  createFenceLine(scene, materials, 3.6, 0.7, 5, Math.PI / 2);
  createVoxelTree(scene, materials, new Vector3(3.95, 0, 1.45), true, 0.82);
  createVoxelTree(scene, materials, new Vector3(-4.65, 0, 0.65), false, 0.9);

  createBox(scene, "garden-bed-front-edge", materials.pathEdge, {
    width: 3.7,
    height: 0.08,
    depth: 0.12,
    position: new Vector3(0.1, 0.06, 1.72),
  });
  createBox(scene, "garden-bed-back-edge", materials.pathEdge, {
    width: 3.2,
    height: 0.08,
    depth: 0.12,
    position: new Vector3(0.04, 0.06, -0.98),
  });
  createBox(scene, "garden-bed-left-edge", materials.pathEdge, {
    width: 0.12,
    height: 0.08,
    depth: 2.58,
    position: new Vector3(-1.82, 0.06, 0.33),
  });

  for (let index = 0; index < 16; index += 1) {
    const isBlue = index % 3 === 0;
    const x = -0.35 + Math.sin(index * 1.7) * 2.6;
    const z = 0.25 + Math.cos(index * 1.1) * 1.5;
    createFlower(scene, materials, new Vector3(x, 0, z), isBlue);
  }
  for (let cluster = 0; cluster < 3; cluster += 1) {
    createLowFlowerCluster(
      scene,
      materials,
      new Vector3(-1.1 + cluster * 0.62, 0, 1.08 + Math.sin(cluster) * 0.3),
      cluster,
    );
  }

  for (let index = 0; index < 15; index += 1) {
    const x = -1.45 + (index % 5) * 0.78 + Math.sin(index * 1.3) * 0.06;
    const z = -0.94 + Math.floor(index / 5) * 0.68 + Math.cos(index * 1.7) * 0.08;
    createGrassTuft(scene, materials, new Vector3(x, 0, z), index * 0.37);
  }

  createRemiStandIn(
    scene,
    materials,
    new Vector3(
      heroCamera.remiStandZone.x,
      heroCamera.remiStandZone.y,
      heroCamera.remiStandZone.z,
    ),
  );

  createBox(scene, "garden-sign-post", materials.darkWood, {
    width: 0.16,
    height: 0.9,
    depth: 0.16,
    position: new Vector3(2.55, 0.45, -0.15),
  });
  const sign = MeshBuilder.CreatePlane("garden-sign", { width: 1.25, height: 0.58 }, scene);
  sign.position = new Vector3(2.55, 0.95, -0.05);
  sign.rotation.y = Math.PI;
  sign.material = createSignMaterial(scene);
  createBox(scene, "garden-sign-top-rail", materials.darkWood, {
    width: 1.42,
    height: 0.08,
    depth: 0.08,
    position: new Vector3(2.55, 1.27, -0.02),
  });
  createBox(scene, "garden-sign-bottom-rail", materials.darkWood, {
    width: 1.42,
    height: 0.08,
    depth: 0.08,
    position: new Vector3(2.55, 0.62, -0.02),
  });
}

function createVoxelTree(
  scene: Scene,
  materials: SceneMaterials,
  position: Vector3,
  withFruit: boolean,
  scale: number,
) {
  createBox(scene, "tree-trunk", materials.darkWood, {
    width: 0.42 * scale,
    height: 1.12 * scale,
    depth: 0.42 * scale,
    position: position.add(new Vector3(0, 0.56 * scale, 0)),
  });
  for (const offset of [
    new Vector3(0, 1.38, 0),
    new Vector3(0.35, 1.45, 0.04),
    new Vector3(-0.35, 1.45, -0.04),
    new Vector3(0.04, 1.68, 0.3),
    new Vector3(-0.06, 1.66, -0.3),
  ]) {
    createBox(scene, "tree-leaf-cube", materials.leaves, {
      width: 0.78 * scale,
      height: 0.62 * scale,
      depth: 0.78 * scale,
      position: position.add(offset.scale(scale)),
      rotationY: offset.x,
    });
  }

  if (!withFruit) {
    return;
  }

  for (const offset of [
    new Vector3(0.34, 1.7, 0.48),
    new Vector3(-0.46, 1.55, -0.42),
    new Vector3(0.18, 2.05, -0.36),
  ]) {
    const fruit = MeshBuilder.CreateSphere(
      "apple",
      { diameter: 0.12 * scale, segments: 8 },
      scene,
    );
    fruit.position = position.add(offset.scale(scale));
    fruit.material = materials.apple;
  }
}

function createGrassTuft(
  scene: Scene,
  materials: SceneMaterials,
  position: Vector3,
  rotationY: number,
) {
  for (let blade = 0; blade < 5; blade += 1) {
    createBox(scene, `grass-tuft-${blade}`, materials.grassBlade, {
      width: 0.022,
      height: 0.12 + (blade % 3) * 0.025,
      depth: 0.022,
      position: position.add(
        new Vector3((blade - 2) * 0.038, 0.064 + (blade % 3) * 0.012, Math.sin(blade) * 0.035),
      ),
      rotationY: rotationY + blade * 0.48,
    });
  }
}

function createLowFlowerCluster(
  scene: Scene,
  materials: SceneMaterials,
  position: Vector3,
  index: number,
) {
  const colors = [
    materials.blueFlower,
    materials.pinkFlower,
    materials.yellowFlower,
    materials.creamFlower,
  ];
  for (let petal = 0; petal < 5; petal += 1) {
    const blossom = MeshBuilder.CreateBox(
      `low-flower-cluster-${index}-${petal}`,
      { width: 0.07, height: 0.04, depth: 0.07 },
      scene,
    );
    blossom.position = position.add(
      new Vector3(
        Math.cos(petal * Math.PI * 0.5) * 0.16,
        0.15 + petal * 0.01,
        Math.sin(petal * Math.PI * 0.5) * 0.12,
      ),
    );
    blossom.rotation.y = petal * 0.62;
    blossom.material = colors[(index + petal) % colors.length];
  }
}

function createRemiStandIn(
  scene: Scene,
  materials: SceneMaterials,
  position: Vector3,
) {
  const shadow = MeshBuilder.CreateCylinder(
    "remi-stand-placeholder-shadow",
    { diameter: 0.54, height: 0.012, tessellation: 18 },
    scene,
  );
  shadow.position = position.add(new Vector3(0, 0.012, 0));
  shadow.scaling.z = 0.58;
  shadow.material = materials.leafShadow;

  createBox(scene, "remi-stand-placeholder-body", materials.creamFlower, {
    width: 0.24,
    height: 0.68,
    depth: 0.16,
    position: position.add(new Vector3(0, 0.4, 0)),
  });
  createBox(scene, "remi-stand-placeholder-accent", materials.blueFlower, {
    width: 0.3,
    height: 0.2,
    depth: 0.18,
    position: position.add(new Vector3(0, 0.72, 0)),
  });
  const head = MeshBuilder.CreateSphere(
    "remi-stand-placeholder-head",
    { diameter: 0.24, segments: 8 },
    scene,
  );
  head.position = position.add(new Vector3(0, 0.98, 0));
  head.material = materials.blueFlower;
}

function createFenceLine(
  scene: Scene,
  materials: SceneMaterials,
  x: number,
  z: number,
  count: number,
  rotationY: number,
) {
  for (let index = 0; index < count; index += 1) {
    const offset = index * 0.58;
    const position =
      rotationY === 0
        ? new Vector3(x + offset, 0.33, z)
        : new Vector3(x, 0.33, z + offset);
    createBox(scene, `fence-post-${index}`, materials.fence, {
      width: 0.12,
      height: 0.66,
      depth: 0.12,
      position,
    });
  }
  if (rotationY === 0) {
    createBox(scene, "fence-rail-low", materials.fence, {
      width: (count - 1) * 0.58,
      height: 0.08,
      depth: 0.08,
      position: new Vector3(x + ((count - 1) * 0.58) / 2, 0.34, z),
    });
    createBox(scene, "fence-rail-high", materials.fence, {
      width: (count - 1) * 0.58,
      height: 0.08,
      depth: 0.08,
      position: new Vector3(x + ((count - 1) * 0.58) / 2, 0.52, z),
    });
    return;
  }

  createBox(scene, "fence-rail-low", materials.fence, {
    width: 0.08,
    height: 0.08,
    depth: (count - 1) * 0.58,
    position: new Vector3(x, 0.34, z + ((count - 1) * 0.58) / 2),
  });
  createBox(scene, "fence-rail-high", materials.fence, {
    width: 0.08,
    height: 0.08,
    depth: (count - 1) * 0.58,
    position: new Vector3(x, 0.52, z + ((count - 1) * 0.58) / 2),
  });
}

function createSignMaterial(scene: Scene) {
  const texture = new DynamicTexture("garden-sign-texture", 512, scene, true);
  texture.drawText(
    "Remi's Garden",
    62,
    290,
    "bold 54px sans-serif",
    "#f5d9a9",
    "#67401f",
    true,
  );
  const material = new StandardMaterial("garden-sign-material", scene);
  material.diffuseTexture = texture;
  material.emissiveColor = new Color3(0.18, 0.11, 0.05);
  material.backFaceCulling = false;
  return material;
}
