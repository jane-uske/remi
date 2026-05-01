import { Color3 } from "@babylonjs/core";

export interface PaletteColor {
  r: number;
  g: number;
  b: number;
}

export const remiWorldPalette = {
  skyTop: { r: 0.42, g: 0.39, b: 0.62 },
  skyHorizon: { r: 0.93, g: 0.58, b: 0.36 },
  grassBase: { r: 0.38, g: 0.49, b: 0.3 },
  grassDark: { r: 0.23, g: 0.36, b: 0.2 },
  woodBase: { r: 0.48, g: 0.26, b: 0.13 },
  woodDark: { r: 0.25, g: 0.13, b: 0.08 },
  roofDark: { r: 0.21, g: 0.1, b: 0.06 },
  stoneBase: { r: 0.52, g: 0.5, b: 0.43 },
  lanternWarm: { r: 1, g: 0.62, b: 0.18 },
  windowWarm: { r: 1, g: 0.74, b: 0.36 },
  shadowTint: { r: 0.22, g: 0.2, b: 0.35 },

  apple: { r: 0.64, g: 0.12, b: 0.11 },
  blueFlower: { r: 0.34, g: 0.47, b: 0.75 },
  creamFlower: { r: 0.86, g: 0.75, b: 0.52 },
  earth: { r: 0.39, g: 0.27, b: 0.17 },
  flowerStem: { r: 0.22, g: 0.34, b: 0.17 },
  leafBase: { r: 0.24, g: 0.39, b: 0.2 },
  leafDark: { r: 0.14, g: 0.25, b: 0.13 },
  path: { r: 0.68, g: 0.57, b: 0.39 },
  pathEdge: { r: 0.42, g: 0.3, b: 0.18 },
  pinkFlower: { r: 0.78, g: 0.36, b: 0.5 },
  smoke: { r: 0.58, g: 0.5, b: 0.58 },
  water: { r: 0.34, g: 0.52, b: 0.61 },
  waterFoam: { r: 0.67, g: 0.78, b: 0.72 },
  yellowFlower: { r: 0.86, g: 0.62, b: 0.24 },
} satisfies Record<string, PaletteColor>;

export function toColor3(color: PaletteColor) {
  return new Color3(color.r, color.g, color.b);
}

export function toRgbTuple(color: PaletteColor): [number, number, number] {
  return [color.r, color.g, color.b];
}
