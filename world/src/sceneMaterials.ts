import {
  Color3,
  Scene,
  StandardMaterial,
} from "@babylonjs/core";

import {
  remiWorldPalette,
  toColor3,
  toRgbTuple,
  type PaletteColor,
} from "./world/art/remiworldPalette";

export type SceneMaterials = ReturnType<typeof createMaterials>;

export function createMaterials(scene: Scene) {
  const grass = makeMaterial(scene, "grass", remiWorldPalette.grassBase);
  grass.specularColor = toColor3(remiWorldPalette.grassDark).scale(0.16);
  const water = makeMaterial(scene, "water", remiWorldPalette.water);
  water.alpha = 0.68;
  const windowGlow = makeMaterial(scene, "window-glow", remiWorldPalette.windowWarm);
  windowGlow.emissiveColor = toColor3(remiWorldPalette.windowWarm).scale(0.72);
  const lanternGlow = makeMaterial(scene, "lantern-glow", remiWorldPalette.lanternWarm);
  lanternGlow.emissiveColor = toColor3(remiWorldPalette.lanternWarm).scale(0.58);
  const placementGhost = makeMaterial(scene, "placement-ghost", [0.76, 0.84, 0.58]);
  placementGhost.alpha = 0.36;
  placementGhost.emissiveColor = new Color3(0.2, 0.28, 0.12);
  const placementGhostAccent = makeMaterial(
    scene,
    "placement-ghost-accent",
    [0.74, 0.84, 0.4],
  );
  placementGhostAccent.alpha = 0.52;
  placementGhostAccent.emissiveColor = new Color3(0.2, 0.26, 0.09);
  const smoke = makeMaterial(scene, "smoke", remiWorldPalette.smoke);
  smoke.alpha = 0.44;
  const distant = makeMaterial(scene, "distant-island", [0.18, 0.25, 0.25]);
  const distantLight = makeMaterial(scene, "distant-light", remiWorldPalette.windowWarm);
  distantLight.emissiveColor = toColor3(remiWorldPalette.windowWarm).scale(0.5);
  const cloud = makeMaterial(scene, "voxel-cloud", [0.82, 0.57, 0.5]);
  cloud.alpha = 0.62;

  return {
    apple: makeMaterial(scene, "apple", remiWorldPalette.apple),
    blueFlower: makeMaterial(scene, "blue-flower-mat", remiWorldPalette.blueFlower),
    cloud,
    creamFlower: makeMaterial(scene, "cream-flower-mat", remiWorldPalette.creamFlower),
    darkWood: makeMaterial(scene, "dark-wood", remiWorldPalette.woodDark),
    distant,
    distantLight,
    distantTree: makeMaterial(scene, "distant-tree", [0.16, 0.24, 0.18]),
    door: makeMaterial(scene, "door", remiWorldPalette.woodDark),
    earth: makeMaterial(scene, "earth", remiWorldPalette.earth),
    fence: makeMaterial(scene, "fence", [0.42, 0.25, 0.14]),
    grassBlade: makeMaterial(scene, "grass-blade", remiWorldPalette.grassDark),
    flowerStem: makeMaterial(scene, "flower-stem", remiWorldPalette.flowerStem),
    grass,
    lanternGlow,
    leaves: makeMaterial(scene, "leaves", remiWorldPalette.leafBase),
    leafShadow: makeMaterial(scene, "leaf-shadow", remiWorldPalette.leafDark),
    logWood: makeMaterial(scene, "log-wood", [0.4, 0.22, 0.12]),
    path: makeMaterial(scene, "path", remiWorldPalette.path),
    pathEdge: makeMaterial(scene, "path-edge", remiWorldPalette.pathEdge),
    placementGhost,
    placementGhostAccent,
    pinkFlower: makeMaterial(scene, "pink-flower-mat", remiWorldPalette.pinkFlower),
    roof: withEmissive(
      makeMaterial(scene, "roof", remiWorldPalette.roofDark),
      remiWorldPalette.roofDark,
      0.18,
    ),
    roofTrim: makeMaterial(scene, "roof-trim", [0.26, 0.13, 0.08]),
    smoke,
    stone: makeMaterial(scene, "stone", remiWorldPalette.stoneBase),
    stoneDark: makeMaterial(scene, "stone-dark", [0.32, 0.33, 0.32]),
    water,
    waterFoam: makeMaterial(scene, "water-foam", remiWorldPalette.waterFoam),
    weatheredWood: makeMaterial(scene, "weathered-wood", [0.34, 0.23, 0.15]),
    windowFrame: makeMaterial(scene, "window-frame", [0.16, 0.09, 0.06]),
    windowGlow,
    woodBlock: makeMaterial(scene, "wood-block", remiWorldPalette.woodBase),
    woodWall: makeMaterial(scene, "wood-wall", remiWorldPalette.woodBase),
    yellowFlower: makeMaterial(scene, "yellow-flower-mat", remiWorldPalette.yellowFlower),
  };
}

export function makeMaterial(
  scene: Scene,
  name: string,
  color: PaletteColor | [number, number, number],
) {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = Array.isArray(color)
    ? new Color3(...color)
    : new Color3(...toRgbTuple(color));
  return material;
}

function withEmissive(
  material: StandardMaterial,
  color: PaletteColor,
  scale: number,
) {
  material.emissiveColor = toColor3(color).scale(scale);
  return material;
}
