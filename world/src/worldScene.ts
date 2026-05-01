import {
  Color3,
  Engine,
  FreeCamera,
  Mesh,
  PointLight,
  Scene,
  Vector3,
} from "@babylonjs/core";
import "@babylonjs/core/Debug/debugLayer";

import {
  createBuildObject,
  type PlacedObject,
} from "./buildObjects";
import {
  createLandCellMesh,
  type RenderedLandCell,
} from "./buildLandCells";
import {
  createBackgroundIslands,
  createIslandBase,
} from "./prefabs/background";
import { createCottage } from "./prefabs/cottage";
import { createGarden } from "./prefabs/garden";
import { createWaterfront } from "./prefabs/waterfront";
import {
  createWorldEvent,
  type WorldEvent,
} from "./worldEvents";
import { constrainPlayerPosition } from "./worldNavigation";
import {
  createMaterials,
  type SceneMaterials,
} from "./sceneMaterials";
import {
  createEveningLighting,
  registerEveningLightingMeshes,
} from "./world/lighting/createEveningLighting";
import {
  getHeroCameraPreset,
  toRadians,
  toVector3 as toHeroVector3,
} from "./world/camera/heroCameraPreset";
import {
  getWorldObjectControlHint,
  type WorldObjectKind,
} from "./worldObjects";
import {
  createLandCellRecord,
  findLatestRemovableLandStatus,
  getLandCellKey,
  getLandLocationLabel,
  getLandRemoveStatus,
  type LandCellRecord,
  type LandFillStatus,
} from "./worldExpansion";
import {
  createPlacedObjectRecord,
  type PlacedObjectRecord,
} from "./worldPlacedObjects";
import {
  findTargetPlacedObjectIndex,
  findTargetPlacedObjectIndexFromRay,
  findNearbyValidPlacementStatus,
  getPlacementLocationLabel,
  type PlacementStatus,
} from "./worldPlacement";
import {
  getInvalidLandFillHint,
  getInvalidLandRemoveHint,
  getInvalidPlacementHint,
  getPlacedObjectTargets,
  getPlacementStatusFromCamera,
  getRawPlacementPoint,
  type CurrentPlacementStatus,
} from "./worldPlacementFlow";
import {
  createPlacementPreview,
  updatePlacementPreview,
} from "./worldPlacementPreview";
import { createViewControl } from "./worldViewControl";
import {
  getVisualEffectFrame,
  type VisualEffectFrame,
} from "./worldVisualEffects";

export interface RemiWorldSceneOptions {
  initialObject: WorldObjectKind;
  heroShotMode?: boolean;
  initialPlacedObjects?: readonly PlacedObjectRecord[];
  initialLandCells?: readonly LandCellRecord[];
  onWorldEvent?: (event: WorldEvent) => void;
  onHintChange?: (hint: string) => void;
  onPlacedObjectsChange?: (records: readonly PlacedObjectRecord[]) => void;
  onLandCellsChange?: (records: readonly LandCellRecord[]) => void;
}

export interface RemiWorldScene {
  selectObject: (kind: WorldObjectKind) => void;
  placeSelectedObject: () => WorldEvent | null;
  removeTargetObject: () => WorldEvent | null;
  removeLatestObject: () => WorldEvent | null;
  clearPlacedObjects: () => void;
  clearLandCells: () => void;
  dispose: () => void;
}

type SmokePuff = {
  mesh: Mesh;
  basePosition: Vector3;
  index: number;
};

type LanternLight = {
  light: PointLight;
  baseIntensity: number;
};

type LanternGlowMesh = {
  mesh: Mesh;
  baseScaling: Vector3;
};

type VisualEffectTargets = {
  lanternLights: LanternLight[];
  lanternGlowMeshes: LanternGlowMesh[];
  smokePuffs: SmokePuff[];
};

const CAMERA_HEIGHT = 1.45;

export function createRemiWorldScene(
  canvas: HTMLCanvasElement,
  options: RemiWorldSceneOptions,
): RemiWorldScene {
  const engine = new Engine(canvas, true, {
    antialias: true,
    stencil: true,
  });
  const scene = new Scene(engine);
  const heroCamera = getHeroCameraPreset();

  const camera = new FreeCamera(
    "first-person-camera",
    toHeroVector3(heroCamera.position),
    scene,
  );
  camera.minZ = 0.05;
  camera.fov = toRadians(heroCamera.fovDegrees);
  camera.attachControl(canvas, false);
  camera.setTarget(toHeroVector3(heroCamera.target));
  let yaw = camera.rotation.y;
  let pitch = camera.rotation.x;

  const lightingRig = createEveningLighting(scene, camera);

  const materials = createMaterials(scene);
  const placementPreview = createPlacementPreview(scene, materials);
  placementPreview.root.setEnabled(options.heroShotMode !== true);
  createIslandBase(scene, materials);
  createCottage(scene, materials);
  createGarden(scene, materials);
  createWaterfront(scene, materials);
  createBackgroundIslands(scene, materials);
  registerEveningLightingMeshes(scene, lightingRig);
  const visualTargets = collectVisualEffectTargets(scene);

  const placedObjects: PlacedObject[] = [];
  const landCells: RenderedLandCell[] = [];
  const keys = new Set<string>();
  let selectedObject = options.initialObject;
  let disposed = false;
  let viewControlActive = false;
  let elapsedSeconds = 0;
  let nextPlacedObjectId = 1;
  let nextLandCellId = 1;
  restoreInitialLandCells();
  restoreInitialPlacedObjects();
  let currentPlacementStatus: CurrentPlacementStatus = getPlacementStatusFromCamera(
    camera,
    selectedObject,
    placedObjects,
    getLandCellRecords(),
  );
  const viewControl = createViewControl({
    canvas,
    document,
    onActiveChange(active) {
      viewControlActive = active;
    },
    onDeactivate() {
      keys.clear();
      options.onHintChange?.("View control paused. Click the island view to control camera.");
    },
  });

  const onKeyDown = (event: KeyboardEvent) => {
    if (isInspectorShortcut(event) && isDevMode()) {
      event.preventDefault();
      toggleInspector(scene);
      return;
    }

    if (event.key === "Escape" && viewControlActive) {
      event.preventDefault();
      viewControl.disable();
      return;
    }

    keys.add(event.key.toLowerCase());
  };
  const onKeyUp = (event: KeyboardEvent) => keys.delete(event.key.toLowerCase());
  const onMouseMove = (event: MouseEvent) => {
    if (!viewControlActive) {
      return;
    }

    yaw += event.movementX * 0.0023;
    pitch = clamp(pitch + event.movementY * 0.0023, -0.82, 0.72);
  };
  const onPointerDown = (event: PointerEvent) => {
    if (event.button === 2) {
      event.preventDefault();
      const removed = removeTargetObject();
      if (removed) {
        options.onWorldEvent?.(removed);
      }
      return;
    }

    if (event.button !== 0) {
      return;
    }

    if (viewControlActive) {
      const placed = placeSelectedObject();
      if (placed) {
        options.onWorldEvent?.(placed);
      }
      return;
    }

    viewControl.enable();
    options.onHintChange?.(getWorldObjectControlHint(selectedObject));
  };
  const onContextMenu = (event: MouseEvent) => event.preventDefault();
  const onResize = () => engine.resize();

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("resize", onResize);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("contextmenu", onContextMenu);

  scene.onBeforeRenderObservable.add(() => {
    const deltaSeconds = engine.getDeltaTime() / 1000;
    elapsedSeconds += deltaSeconds;
    camera.rotation.x = pitch;
    camera.rotation.y = yaw;
    if (viewControlActive) {
      updatePlayerMovement(camera, keys, deltaSeconds, getLandCellRecords());
    }
    refreshPlacementStatus();
    const frame = getVisualEffectFrame(elapsedSeconds);
    applyVisualEffects(frame, materials, visualTargets, elapsedSeconds);
    updatePlacementPreview(
      placementPreview,
      materials,
      selectedObject,
      currentPlacementStatus,
      frame.previewAlpha,
    );
  });

  engine.runRenderLoop(() => {
    scene.render();
  });

  return {
    selectObject(kind) {
      selectedObject = kind;
    },
    placeSelectedObject,
    removeTargetObject,
    removeLatestObject: removeLatestPlacedObject,
    clearPlacedObjects,
    clearLandCells,
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("resize", onResize);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("contextmenu", onContextMenu);
      viewControl.dispose();
      engine.dispose();
    },
  };

  function placeSelectedObject(): WorldEvent | null {
    refreshPlacementStatus();
    if (selectedObject === "land_fill") {
      return placeLandCell();
    }

    let placementStatus = currentPlacementStatus as PlacementStatus;
    if (!placementStatus.ok && placementStatus.reason === "occupied") {
      placementStatus = findNearbyValidPlacementStatus(
        placementStatus.point,
        camera.position,
        getPlacedObjectTargets(placedObjects),
        getLandCellRecords(),
      );
    }

    if (!placementStatus.ok) {
      options.onHintChange?.(
        getInvalidPlacementHint(placementStatus.reason),
      );
      return null;
    }

    const position = toVector3(placementStatus.point);
    createBuildObject(
      scene,
      materials,
      selectedObject,
      position,
      placedObjects,
      `placed-${nextPlacedObjectId}`,
    );
    nextPlacedObjectId += 1;
    emitPlacedObjectsChange();
    return createWorldEvent({
      actorId: "player",
      type: "player_placed_object",
      objectKind: selectedObject,
      locationLabel: getPlacementLocationLabel(position),
    });
  }

  function placeLandCell(): WorldEvent | null {
    const status = currentPlacementStatus as LandFillStatus;
    if (!status.ok) {
      options.onHintChange?.(getInvalidLandFillHint(status.reason));
      return null;
    }

    const record = createLandCellRecord(status.cell, `land-${nextLandCellId}`);
    landCells.push(createLandCellMesh(scene, materials, record));
    nextLandCellId += 1;
    emitLandCellsChange();
    return createWorldEvent({
      actorId: "player",
      type: "player_expanded_land",
      locationLabel: getLandLocationLabel(status.cell),
    });
  }

  function removeTargetObject(): WorldEvent | null {
    refreshPlacementStatus();
    if (selectedObject === "land_fill") {
      return removeLandCell();
    }

    if (placedObjects.length === 0) {
      options.onHintChange?.("Nothing placed yet. Add one small detail first.");
      return null;
    }

    const ray = camera.getForwardRay(8);
    let targetIndex = findTargetPlacedObjectIndexFromRay(
      getPlacedObjectTargets(placedObjects),
      ray.origin,
      ray.direction,
    );
    if (targetIndex < 0) {
      const fallbackIndex = findTargetPlacedObjectIndex(
        getPlacedObjectTargets(placedObjects),
        currentPlacementStatus.point,
      );
      if (fallbackIndex >= 0) {
        targetIndex = fallbackIndex;
      } else {
        options.onHintChange?.("Aim the crosshair at a placed detail, then right-click or press R.");
        return null;
      }
    }

    const [target] = placedObjects.splice(targetIndex, 1);
    const location = getPlacementLocationLabel(target.root.position);
    target.root.dispose(false, true);
    emitPlacedObjectsChange();
    return createWorldEvent({
      actorId: "player",
      type: "player_removed_object",
      objectKind: target.kind,
      locationLabel: location,
    });
  }

  function removeLatestPlacedObject(): WorldEvent | null {
    if (placedObjects.length === 0) {
      options.onHintChange?.("Nothing placed yet. Add one small detail first.");
      return null;
    }

    const [target] = placedObjects.splice(placedObjects.length - 1, 1);
    const location = getPlacementLocationLabel(target.root.position);
    target.root.dispose(false, true);
    emitPlacedObjectsChange();
    return createWorldEvent({
      actorId: "player",
      type: "player_removed_object",
      objectKind: target.kind,
      locationLabel: location,
    });
  }

  function removeLandCell(): WorldEvent | null {
    let status = getLandRemoveStatus(
      getRawPlacementPoint(camera),
      getLandCellRecords(),
      getPlacedObjectTargets(placedObjects),
    );
    if (!status.ok && status.reason === "no_land") {
      status = findLatestRemovableLandStatus(
        getLandCellRecords(),
        getPlacedObjectTargets(placedObjects),
      );
    }
    if (!status.ok) {
      options.onHintChange?.(getInvalidLandRemoveHint(status.reason));
      return null;
    }

    const targetKey = getLandCellKey(status.cell);
    const targetIndex = landCells.findIndex(
      (cell) => getLandCellKey(cell.record.cell) === targetKey,
    );
    if (targetIndex < 0) {
      options.onHintChange?.("Aim at a filled shoreline patch before removing land.");
      return null;
    }

    const [target] = landCells.splice(targetIndex, 1);
    target.root.dispose(false, true);
    emitLandCellsChange();
    return createWorldEvent({
      actorId: "player",
      type: "player_removed_land",
      locationLabel: getLandLocationLabel(status.cell),
    });
  }

  function clearPlacedObjects() {
    for (const object of placedObjects) {
      object.root.dispose(false, true);
    }
    placedObjects.splice(0, placedObjects.length);
    emitPlacedObjectsChange();
    options.onHintChange?.("Local island layout cleared.");
  }

  function clearLandCells() {
    for (const cell of landCells) {
      cell.root.dispose(false, true);
    }
    landCells.splice(0, landCells.length);
    emitLandCellsChange();
    options.onHintChange?.("Local island layout cleared.");
  }

  function restoreInitialLandCells() {
    for (const record of options.initialLandCells ?? []) {
      landCells.push(createLandCellMesh(scene, materials, record));
      const idNumber = Number.parseInt(record.id.replace("land-", ""), 10);
      if (Number.isFinite(idNumber)) {
        nextLandCellId = Math.max(nextLandCellId, idNumber + 1);
      }
    }
  }

  function restoreInitialPlacedObjects() {
    for (const record of options.initialPlacedObjects ?? []) {
      createBuildObject(
        scene,
        materials,
        record.kind,
        toVector3(record.position),
        placedObjects,
        record.id,
      );
      const idNumber = Number.parseInt(record.id.replace("placed-", ""), 10);
      if (Number.isFinite(idNumber)) {
        nextPlacedObjectId = Math.max(nextPlacedObjectId, idNumber + 1);
      }
    }
  }

  function emitPlacedObjectsChange() {
    options.onPlacedObjectsChange?.(
      placedObjects.map((object) =>
        createPlacedObjectRecord(
          object.kind,
          object.root.position,
          object.id,
        ),
      ),
    );
  }

  function emitLandCellsChange() {
    options.onLandCellsChange?.(getLandCellRecords());
  }

  function getLandCellRecords() {
    return landCells.map((cell) => cell.record);
  }

  function refreshPlacementStatus() {
    currentPlacementStatus = getPlacementStatusFromCamera(
      camera,
      selectedObject,
      placedObjects,
      getLandCellRecords(),
    );
  }
}

function updatePlayerMovement(
  camera: FreeCamera,
  keys: Set<string>,
  delta: number,
  landCells: readonly LandCellRecord[],
) {
  const forward = camera.getForwardRay().direction.clone();
  forward.y = 0;
  forward.normalize();
  const right = Vector3.Cross(forward, Vector3.Up()).normalize();
  const move = new Vector3(0, 0, 0);

  if (keys.has("w") || keys.has("arrowup")) move.addInPlace(forward);
  if (keys.has("s") || keys.has("arrowdown")) move.subtractInPlace(forward);
  if (keys.has("d") || keys.has("arrowright")) move.subtractInPlace(right);
  if (keys.has("a") || keys.has("arrowleft")) move.addInPlace(right);

  if (move.length() === 0) {
    return;
  }

  move.normalize();
  const previous = camera.position.clone();
  const candidate = previous.add(move.scale(2.9 * delta));
  const constrained = constrainPlayerPosition(candidate, previous, landCells);
  camera.position.x = constrained.x;
  camera.position.y = CAMERA_HEIGHT;
  camera.position.z = constrained.z;
}

function collectVisualEffectTargets(scene: Scene): VisualEffectTargets {
  const lanternLights = scene.lights
    .filter(
      (light): light is PointLight =>
        light instanceof PointLight && light.name === "warm-lantern-light",
    )
    .map((light) => ({
      light,
      baseIntensity: light.intensity,
    }));
  const lanternGlowMeshes = scene.meshes
    .filter(
      (mesh): mesh is Mesh =>
        mesh instanceof Mesh && mesh.name === "warm-lantern-glow",
    )
    .map((mesh) => ({
      mesh,
      baseScaling: mesh.scaling.clone(),
    }));
  const smokePuffs = scene.meshes
    .filter(
      (mesh): mesh is Mesh =>
        mesh instanceof Mesh && mesh.name.startsWith("smoke-puff-"),
    )
    .map((mesh, index) => ({
      mesh,
      basePosition: mesh.position.clone(),
      index,
    }));

  return {
    lanternLights,
    lanternGlowMeshes,
    smokePuffs,
  };
}

function applyVisualEffects(
  frame: VisualEffectFrame,
  materials: SceneMaterials,
  targets: VisualEffectTargets,
  seconds: number,
) {
  for (const target of targets.lanternLights) {
    target.light.intensity = target.baseIntensity * frame.lampIntensity;
  }

  for (const target of targets.lanternGlowMeshes) {
    target.mesh.scaling = target.baseScaling.scale(frame.lampGlowScale);
  }

  for (const puff of targets.smokePuffs) {
    const loopedLift = (frame.smokeLift + puff.index * 0.09) % 0.72;
    puff.mesh.position.x =
      puff.basePosition.x + Math.sin(seconds * 0.45 + puff.index) * 0.05 + frame.smokeSway;
    puff.mesh.position.y = puff.basePosition.y + loopedLift;
    puff.mesh.position.z =
      puff.basePosition.z + Math.cos(seconds * 0.36 + puff.index) * 0.04;
  }

  materials.smoke.alpha = frame.smokeAlpha;
  materials.water.alpha = frame.waterAlpha;
  materials.water.emissiveColor = new Color3(0.02, 0.08 + frame.waterGlow * 0.08, 0.1);
}

function toVector3(point: { x: number; y: number; z: number }) {
  return new Vector3(point.x, point.y, point.z);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isInspectorShortcut(event: KeyboardEvent) {
  return event.altKey && event.shiftKey && event.key.toLowerCase() === "i";
}

function isDevMode() {
  const meta = import.meta as ImportMeta & {
    env?: {
      DEV?: boolean;
    };
  };
  return meta.env?.DEV === true;
}

function toggleInspector(scene: Scene) {
  if (scene.debugLayer.isVisible()) {
    scene.debugLayer.hide();
    return;
  }

  void scene.debugLayer.show({
    embedMode: true,
    showInspector: true,
  });
}
