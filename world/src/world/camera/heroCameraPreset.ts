import { Vector3 } from "@babylonjs/core";

export interface HeroCameraPreset {
  position: Vector3Record;
  target: Vector3Record;
  remiStandZone: Vector3Record;
  fovDegrees: number;
}

export interface Vector3Record {
  x: number;
  y: number;
  z: number;
}

export function getHeroCameraPreset(): HeroCameraPreset {
  return {
    position: { x: 0.85, y: 1.48, z: 7.3 },
    target: { x: -2.85, y: 0.98, z: -0.95 },
    remiStandZone: { x: -2.2, y: 0, z: 2.35 },
    fovDegrees: 40,
  };
}

export function toVector3(vector: Vector3Record) {
  return new Vector3(vector.x, vector.y, vector.z);
}

export function toRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}
