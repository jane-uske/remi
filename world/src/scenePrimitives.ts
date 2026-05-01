import {
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";

export function createBox(
  scene: Scene,
  name: string,
  material: StandardMaterial,
  options: {
    width: number;
    height: number;
    depth: number;
    position: Vector3;
    rotationY?: number;
    parent?: TransformNode;
  },
) {
  const box = MeshBuilder.CreateBox(
    name,
    {
      width: options.width,
      height: options.height,
      depth: options.depth,
    },
    scene,
  );
  box.position = options.position;
  box.rotation.y = options.rotationY ?? 0;
  box.material = material;
  box.parent = options.parent ?? null;
  return box;
}
