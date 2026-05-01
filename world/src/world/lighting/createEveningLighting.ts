import {
  Color3,
  Color4,
  DefaultRenderingPipeline,
  DirectionalLight,
  DynamicTexture,
  FreeCamera,
  HemisphericLight,
  ImageProcessingConfiguration,
  Mesh,
  MeshBuilder,
  PointLight,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";

import {
  remiWorldPalette,
  toColor3,
  type PaletteColor,
} from "../art/remiworldPalette";

export interface EveningLightingPreset {
  clearColor: RgbaColor;
  fog: {
    color: PaletteColor;
    start: number;
    end: number;
  };
  sky: {
    intensity: number;
    direction: Vector3Record;
    diffuse: PaletteColor;
    groundColor: PaletteColor;
  };
  sun: {
    direction: Vector3Record;
    diffuse: PaletteColor;
    specular: PaletteColor;
    intensity: number;
    discPosition: Vector3Record;
  };
  windows: {
    intensity: number;
    range: number;
  };
  lanterns: {
    intensityScale: number;
    rangeScale: number;
  };
  shadows: {
    enabled: boolean;
    mapSize: number;
    darkness: number;
  };
  postProcess: {
    bloomEnabled: boolean;
    bloomThreshold: number;
    bloomWeight: number;
    bloomKernel: number;
    fxaaEnabled: boolean;
    vignetteEnabled: boolean;
    depthOfFieldEnabled: boolean;
    exposure: number;
    contrast: number;
  };
}

export interface RgbaColor extends PaletteColor {
  a: number;
}

export interface Vector3Record {
  x: number;
  y: number;
  z: number;
}

export interface EveningLightingRig {
  sun: DirectionalLight;
  sky: HemisphericLight;
  shadowGenerator: ShadowGenerator;
  pipeline: DefaultRenderingPipeline;
  preset: EveningLightingPreset;
}

const SKY_TEXTURE_SIZE = 256;

export function getEveningLightingPreset(): EveningLightingPreset {
  return {
    clearColor: { r: 0.45, g: 0.39, b: 0.62, a: 1 },
    fog: {
      color: { r: 0.58, g: 0.51, b: 0.68 },
      start: 8.5,
      end: 28,
    },
    sky: {
      intensity: 0.72,
      direction: { x: 0.18, y: 1, z: 0.04 },
      diffuse: { r: 0.7, g: 0.6, b: 0.78 },
      groundColor: remiWorldPalette.shadowTint,
    },
    sun: {
      direction: { x: -0.4, y: -0.68, z: -0.34 },
      diffuse: { r: 1, g: 0.62, b: 0.28 },
      specular: { r: 0.42, g: 0.26, b: 0.15 },
      intensity: 1.42,
      discPosition: { x: -10.5, y: 2.45, z: -18 },
    },
    windows: {
      intensity: 0.42,
      range: 2.15,
    },
    lanterns: {
      intensityScale: 0.68,
      rangeScale: 0.78,
    },
    shadows: {
      enabled: true,
      mapSize: 2048,
      darkness: 0.82,
    },
    postProcess: {
      bloomEnabled: true,
      bloomThreshold: 0.78,
      bloomWeight: 0.26,
      bloomKernel: 34,
      fxaaEnabled: true,
      vignetteEnabled: true,
      depthOfFieldEnabled: false,
      exposure: 1,
      contrast: 1.06,
    },
  };
}

export function createEveningLighting(
  scene: Scene,
  camera: FreeCamera,
  preset = getEveningLightingPreset(),
): EveningLightingRig {
  scene.clearColor = toColor4(preset.clearColor);
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogColor = toColor3(preset.fog.color);
  scene.fogStart = preset.fog.start;
  scene.fogEnd = preset.fog.end;

  createSkyDome(scene);

  const sky = new HemisphericLight(
    "dusk-sky-fill",
    toSceneVector3(preset.sky.direction),
    scene,
  );
  sky.intensity = preset.sky.intensity;
  sky.diffuse = toColor3(preset.sky.diffuse);
  sky.groundColor = toColor3(preset.sky.groundColor);
  sky.specular = Color3.Black();

  const sun = new DirectionalLight(
    "low-evening-sun-key",
    toSceneVector3(preset.sun.direction),
    scene,
  );
  sun.intensity = preset.sun.intensity;
  sun.diffuse = toColor3(preset.sun.diffuse);
  sun.specular = toColor3(preset.sun.specular);

  const shadowGenerator = new ShadowGenerator(preset.shadows.mapSize, sun);
  shadowGenerator.usePercentageCloserFiltering = true;
  shadowGenerator.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
  shadowGenerator.bias = 0.001;
  shadowGenerator.normalBias = 0.018;
  shadowGenerator.darkness = preset.shadows.darkness;

  const pipeline = createPostProcessPipeline(scene, camera, preset);

  return {
    sun,
    sky,
    shadowGenerator,
    pipeline,
    preset,
  };
}

export function registerEveningLightingMeshes(
  scene: Scene,
  rig: EveningLightingRig,
) {
  const shadowRenderList = rig.shadowGenerator.getShadowMap()?.renderList;

  for (const mesh of scene.meshes) {
    if (!(mesh instanceof Mesh) || shouldSkipLightingMesh(mesh.name)) {
      continue;
    }

    if (shouldReceiveShadows(mesh.name)) {
      mesh.receiveShadows = true;
    }

    if (shadowRenderList && shouldCastShadows(mesh.name)) {
      shadowRenderList.push(mesh);
    }
  }

  addWindowLights(scene, rig.preset);
  tuneLanternLights(scene, rig.preset);
}

function createPostProcessPipeline(
  scene: Scene,
  camera: FreeCamera,
  preset: EveningLightingPreset,
) {
  const pipeline = new DefaultRenderingPipeline(
    "remi-world-evening-post",
    true,
    scene,
    [camera],
  );
  pipeline.samples = 4;
  pipeline.fxaaEnabled = preset.postProcess.fxaaEnabled;
  pipeline.bloomEnabled = preset.postProcess.bloomEnabled;
  pipeline.bloomThreshold = preset.postProcess.bloomThreshold;
  pipeline.bloomWeight = preset.postProcess.bloomWeight;
  pipeline.bloomKernel = preset.postProcess.bloomKernel;
  pipeline.depthOfFieldEnabled = preset.postProcess.depthOfFieldEnabled;
  pipeline.glowLayerEnabled = true;
  if (pipeline.glowLayer) {
    pipeline.glowLayer.intensity = 0.22;
  }

  const imageProcessing = scene.imageProcessingConfiguration;
  imageProcessing.toneMappingEnabled = true;
  imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
  imageProcessing.exposure = preset.postProcess.exposure;
  imageProcessing.contrast = preset.postProcess.contrast;
  imageProcessing.vignetteEnabled = preset.postProcess.vignetteEnabled;
  imageProcessing.vignetteWeight = 0.56;
  imageProcessing.vignetteStretch = 0.58;

  return pipeline;
}

function addWindowLights(scene: Scene, preset: EveningLightingPreset) {
  const windowGlowMeshes = scene.meshes.filter(
    (mesh): mesh is Mesh =>
      mesh instanceof Mesh && mesh.name.endsWith("-window-glow"),
  );

  for (const mesh of windowGlowMeshes) {
    const light = new PointLight(
      `${mesh.name}-warm-light`,
      mesh.getAbsolutePosition().add(new Vector3(0, 0.05, 0.28)),
      scene,
    );
    light.diffuse = toColor3(remiWorldPalette.windowWarm);
    light.specular = new Color3(0.28, 0.16, 0.08);
    light.intensity = preset.windows.intensity;
    light.range = preset.windows.range;
  }
}

function tuneLanternLights(scene: Scene, preset: EveningLightingPreset) {
  for (const light of scene.lights) {
    if (!(light instanceof PointLight) || light.name !== "warm-lantern-light") {
      continue;
    }

    light.diffuse = toColor3(remiWorldPalette.lanternWarm);
    light.specular = new Color3(0.28, 0.14, 0.04);
    light.intensity *= preset.lanterns.intensityScale;
    light.range *= preset.lanterns.rangeScale;
  }
}

function createSkyDome(scene: Scene) {
  const texture = new DynamicTexture(
    "sunset-sky-gradient",
    { width: SKY_TEXTURE_SIZE, height: SKY_TEXTURE_SIZE },
    scene,
    false,
  );
  const context = texture.getContext();
  const gradient = context.createLinearGradient(0, 0, 0, SKY_TEXTURE_SIZE);
  gradient.addColorStop(0, "#4f5278");
  gradient.addColorStop(0.38, "#847096");
  gradient.addColorStop(0.72, "#b88178");
  gradient.addColorStop(1, "#d9a775");
  context.fillStyle = gradient;
  context.fillRect(0, 0, SKY_TEXTURE_SIZE, SKY_TEXTURE_SIZE);
  texture.update(false);

  const skyMaterial = new StandardMaterial("sunset-sky-material", scene);
  skyMaterial.disableLighting = true;
  skyMaterial.backFaceCulling = false;
  skyMaterial.diffuseColor = Color3.Black();
  skyMaterial.emissiveColor = toColor3(remiWorldPalette.skyTop).scale(0.92);
  skyMaterial.emissiveTexture = texture;
  skyMaterial.specularColor = Color3.Black();

  const skyDome = MeshBuilder.CreateSphere(
    "sunset-sky-dome",
    {
      diameter: 80,
      segments: 32,
      sideOrientation: Mesh.BACKSIDE,
    },
    scene,
  );
  skyDome.material = skyMaterial;
  skyDome.infiniteDistance = true;
  skyDome.applyFog = false;
  skyDome.isPickable = false;
}

function shouldSkipLightingMesh(name: string) {
  return (
    name.includes("sky") ||
    name.includes("sun") ||
    name.includes("glow") ||
    name.includes("smoke") ||
    name.includes("cloud") ||
    name.includes("water") ||
    name.includes("foam") ||
    name.includes("placement")
  );
}

function shouldReceiveShadows(name: string) {
  return (
    name.includes("island") ||
    name.includes("earth") ||
    name.includes("grass") ||
    name.includes("path") ||
    name.includes("foundation") ||
    name.includes("step") ||
    name.includes("expanded-land") ||
    name.includes("garden-bed")
  );
}

function shouldCastShadows(name: string) {
  return !(
    name.includes("round-island") ||
    name.includes("earth-edge") ||
    name.includes("path-stone") ||
    name.includes("porch-step") ||
    name.includes("garden-bed")
  );
}

function toColor4(color: RgbaColor) {
  return new Color4(color.r, color.g, color.b, color.a);
}

function toSceneVector3(vector: Vector3Record) {
  return new Vector3(vector.x, vector.y, vector.z);
}
