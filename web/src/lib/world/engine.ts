/**
 * RemiWorld v0.1 引擎：渲染、日落天空、第一人称移动与碰撞、交互射线。
 *
 * 职责边界：引擎只管"世界长什么样、玩家怎么动、瞄到了什么"；
 * 剧情/任务状态机在 script.ts，HUD 在 RemiWorld.tsx。
 */
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { Blocks } from "./blocks";
import {
  buildWorldMeshes,
  createWorldMaterials,
  type WorldMaterials,
  type WorldMeshes,
} from "./mesher";
import { createAtlasTexture, tileUvRect, TILE } from "./textures";
import type { LipSignal } from "@/types/avatar";
import {
  buildWorldMap,
  WATER_Y,
  type FlowerDeco,
  type WorldMap,
} from "./worldMap";
import { RemiActor } from "./remiActor";
import {
  RemiBehaviorController,
  type BehaviorId,
  type BehaviorState,
} from "./behavior";

export interface FocusInfo {
  id: string;
  label: string;
}

export interface EngineCallbacks {
  /** 准星瞄到可交互物（或离开）时触发 */
  onFocusChange(focus: FocusInfo | null): void;
  /** 玩家按 E / 点击命中可交互物。id 为 interactable id 或 "remi" */
  onInteract(id: string): void;
  onLockChange(locked: boolean): void;
  /** 玩家第一次走到 Remi 身边（每次会话只触发一次） */
  onNearRemi(): void;
  /** Remi 的日常行为变化（"在书架边看书"等，HUD 与对话上下文用） */
  onRemiActivity?(label: string): void;
}

const EYE_HEIGHT = 1.55;
const PLAYER_HALF = 0.3;
const PLAYER_HEIGHT = 1.72;
const GRAVITY = 20;
const JUMP_SPEED = 7;
const WALK_SPEED = 4.2;
const INTERACT_RANGE = 4.2;

interface SkyPreset {
  top: number;
  mid: number;
  horizon: number;
  fog: number;
  sun: number;
  hemiIntensity: number;
  dirIntensity: number;
}

/** 黄金时刻（进入世界时） */
const SKY_GOLDEN: SkyPreset = {
  top: 0x5e6fa3,
  mid: 0xcf7e63,
  horizon: 0xf7b977,
  fog: 0xe8956b,
  sun: 0xffd9a0,
  hemiIntensity: 0.85,
  dirIntensity: 1.7,
};

/** 点灯后加深的暮色（世界因对话而变化） */
const SKY_DUSK: SkyPreset = {
  top: 0x39406e,
  mid: 0x9c5e6a,
  horizon: 0xe89a6a,
  fog: 0xb87a66,
  sun: 0xffc68a,
  hemiIntensity: 0.62,
  dirIntensity: 1.15,
};

function makeSkyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor: { value: new THREE.Color(SKY_GOLDEN.top) },
      midColor: { value: new THREE.Color(SKY_GOLDEN.mid) },
      horizonColor: { value: new THREE.Color(SKY_GOLDEN.horizon) },
      sunColor: { value: new THREE.Color(SKY_GOLDEN.sun) },
      sunDir: { value: new THREE.Vector3(-0.82, 0.3, -0.2).normalize() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 topColor;
      uniform vec3 midColor;
      uniform vec3 horizonColor;
      uniform vec3 sunColor;
      uniform vec3 sunDir;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -0.12, 1.0);
        vec3 sky = h < 0.18
          ? mix(horizonColor, midColor, smoothstep(-0.12, 0.18, h))
          : mix(midColor, topColor, smoothstep(0.18, 0.85, h));
        float s = max(dot(d, normalize(sunDir)), 0.0);
        sky += sunColor * (pow(s, 350.0) * 1.2 + pow(s, 24.0) * 0.32 + pow(s, 5.0) * 0.12);
        gl_FragColor = vec4(sky, 1.0);
      }
    `,
  });
}

/** 把 PlaneGeometry 的 UV 重映射到图集瓦片范围 */
function remapUvToTile(geo: THREE.BufferGeometry, tile: number): void {
  const rect = tileUvRect(tile);
  const uv = geo.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(
      i,
      rect.u0 + uv.getX(i) * (rect.u1 - rect.u0),
      rect.v0 + uv.getY(i) * (rect.v1 - rect.v0),
    );
  }
  uv.needsUpdate = true;
}

function flowerTileFor(color: number): number {
  if (color === 0xf2d06b || color === 0xee9b6a) return TILE.FLOWER_YELLOW;
  if (color === 0xe2e8f0 || color === 0xeef0f4) return TILE.FLOWER_WHITE;
  return TILE.FLOWER_PINK;
}

interface Petal {
  mesh: THREE.Mesh;
  phase: number;
  speed: number;
}

export class RemiWorldEngine {
  readonly map: WorldMap;
  private container: HTMLElement;
  private callbacks: EngineCallbacks;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private atlas: THREE.Texture;
  private materials: WorldMaterials;
  private spriteMat: THREE.MeshLambertMaterial;
  private petals: Petal[] = [];
  private meshes: WorldMeshes;
  private skyMat: THREE.ShaderMaterial;
  private hemi: THREE.HemisphereLight;
  private dirLight: THREE.DirectionalLight;
  private lanternLight: THREE.PointLight;
  private lanternFlicker = 0;
  private plantedGroup = new THREE.Group();
  private remi: RemiActor;
  private behavior: RemiBehaviorController;
  private lipSignalRef: { current: LipSignal } | null = null;

  // 玩家状态（pos 为脚底中心）
  private pos = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private yaw = 0;
  private pitch = 0;
  private grounded = false;
  private keys = new Set<string>();

  private focused: FocusInfo | null = null;
  private interactEnabled = true;
  /** 实时对话面板打开时挂起 FPS 控制（让鼠标去点输入框） */
  private chatActive = false;
  /** 指针锁定不可用（iframe/被拒）时的兜底：按住鼠标拖动视角 */
  private fallbackControls = false;
  private dragging = false;
  private dragMovedPx = 0;
  private nearRemiFired = false;
  private lanternLit = false;
  private duskT = 0;
  private duskTarget = 0;

  private raf = 0;
  private lastT = 0;
  private disposed = false;
  private resizeObserver: ResizeObserver;
  private clouds: THREE.Group[] = [];

  constructor(container: HTMLElement, callbacks: EngineCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.map = buildWorldMap();

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = "block";

    this.camera = new THREE.PerspectiveCamera(72, 1, 0.08, 320);
    this.scene.fog = new THREE.Fog(SKY_GOLDEN.fog, 45, 200);

    // 天空球 + 像素图集 + 体素世界
    this.skyMat = makeSkyMaterial();
    const sky = new THREE.Mesh(new THREE.SphereGeometry(240, 24, 16), this.skyMat);
    this.scene.add(sky);

    this.atlas = createAtlasTexture();
    this.materials = createWorldMaterials(this.atlas);
    this.spriteMat = new THREE.MeshLambertMaterial({
      map: this.atlas,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
    });

    this.meshes = buildWorldMeshes(this.map.grid, this.materials);
    if (this.meshes.opaque) {
      this.meshes.opaque.castShadow = true;
      this.meshes.opaque.receiveShadow = true;
    }
    this.scene.add(this.meshes.group);

    // 海面
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(200, 48),
      new THREE.MeshLambertMaterial({
        color: 0x46708e,
        emissive: 0xb06a45,
        emissiveIntensity: 0.22,
        transparent: true,
        opacity: 0.94,
      }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(this.map.grid.sx / 2, WATER_Y, this.map.grid.sz / 2);
    this.scene.add(water);

    // 光照
    this.hemi = new THREE.HemisphereLight(0xffd9b0, 0x6a5444, SKY_GOLDEN.hemiIntensity);
    this.scene.add(this.hemi);
    this.scene.add(new THREE.AmbientLight(0x8a6a58, 0.55));

    this.dirLight = new THREE.DirectionalLight(0xffb070, SKY_GOLDEN.dirIntensity);
    const sunDir = (this.skyMat.uniforms.sunDir.value as THREE.Vector3).clone();
    this.dirLight.position
      .copy(sunDir)
      .multiplyScalar(90)
      .add(new THREE.Vector3(this.map.grid.sx / 2, 0, this.map.grid.sz / 2));
    this.dirLight.target.position.set(this.map.grid.sx / 2, 4, this.map.grid.sz / 2);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.set(2048, 2048);
    const sc = this.dirLight.shadow.camera;
    sc.left = -40;
    sc.right = 40;
    sc.top = 40;
    sc.bottom = -40;
    sc.near = 20;
    sc.far = 200;
    sc.updateProjectionMatrix();
    this.dirLight.shadow.bias = -0.0004;
    this.dirLight.shadow.normalBias = 0.06;
    this.scene.add(this.dirLight, this.dirLight.target);

    // 室内暖光 + 屏幕冷光
    for (const [lx, ly, lz] of this.map.interiorLights) {
      const p = new THREE.PointLight(0xffb877, 26, 12, 2);
      p.position.set(lx, ly, lz);
      this.scene.add(p);
    }
    const screenGlow = new THREE.PointLight(0x9fd8e8, 3.2, 4.5, 2);
    screenGlow.position.set(27.4, 5.6, 18.5);
    this.scene.add(screenGlow);

    // 门前灯笼的光，点亮前强度 0
    const [lbx, lby, lbz] = this.map.lanternBlock;
    this.lanternLight = new THREE.PointLight(0xffaa55, 0, 15, 2);
    this.lanternLight.position.set(lbx + 0.5, lby + 0.5, lbz + 0.5);
    this.scene.add(this.lanternLight);

    // 装饰花 + 种花容器 + 草丛
    for (const f of this.map.decoFlowers) this.scene.add(this.makeFlower(f));
    this.scene.add(this.plantedGroup);
    this.scene.add(this.buildGrassTufts());

    // 云
    for (let i = 0; i < 4; i++) {
      const cloud = new THREE.Group();
      const m = new THREE.MeshLambertMaterial({ color: 0xf6e3d3 });
      const n = 3 + Math.floor(Math.random() * 3);
      for (let j = 0; j < n; j++) {
        const box = new THREE.Mesh(new THREE.BoxGeometry(4 + Math.random() * 5, 1.4, 3 + Math.random() * 3), m);
        box.position.set(j * 3.4 - n * 1.5, Math.random() * 0.8, Math.random() * 2.5);
        cloud.add(box);
      }
      cloud.position.set(
        Math.random() * 160 - 60,
        26 + Math.random() * 9,
        Math.random() * 160 - 60,
      );
      this.clouds.push(cloud);
      this.scene.add(cloud);
    }

    // 雾中的远景小岛剪影（"世界不是一个盒子"）
    const cx = this.map.grid.sx / 2;
    const cz = this.map.grid.sz / 2;
    const silhouetteMat = new THREE.MeshLambertMaterial({ color: 0x6b5a50 });
    const distantSpecs: Array<[number, number, number]> = [
      [-1.0, -0.25, 150],
      [-0.55, 0.85, 165],
      [0.9, 0.65, 155],
    ];
    for (const [dx, dz, dist] of distantSpecs) {
      const dir = new THREE.Vector2(dx, dz).normalize();
      const island = new THREE.Group();
      const b1 = new THREE.Mesh(new THREE.BoxGeometry(34, 9, 20), silhouetteMat);
      const b2 = new THREE.Mesh(new THREE.BoxGeometry(18, 14, 12), silhouetteMat);
      b2.position.set(5, 5, 2);
      const b3 = new THREE.Mesh(new THREE.BoxGeometry(10, 20, 8), silhouetteMat);
      b3.position.set(-7, 6, -3);
      island.add(b1, b2, b3);
      island.position.set(cx + dir.x * dist, WATER_Y + 1.5, cz + dir.y * dist);
      this.scene.add(island);
    }

    // 水面上的日落反光带
    const sunDirH = new THREE.Vector2(-0.82, -0.2).normalize();
    const streak = new THREE.Mesh(
      new THREE.PlaneGeometry(5, 110),
      new THREE.MeshBasicMaterial({
        color: 0xffa05a,
        transparent: true,
        opacity: 0.2,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    streak.rotation.x = -Math.PI / 2;
    streak.rotation.z = Math.atan2(sunDirH.x, sunDirH.y);
    streak.position.set(cx + sunDirH.x * 70, WATER_Y + 0.06, cz + sunDirH.y * 70);
    this.scene.add(streak);

    // 飘落的花瓣
    const petalMat = new THREE.MeshBasicMaterial({
      color: 0xf6c6d8,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
    });
    const petalGeo = new THREE.PlaneGeometry(0.12, 0.12);
    for (let i = 0; i < 34; i++) {
      const mesh = new THREE.Mesh(petalGeo, petalMat);
      mesh.position.set(
        18 + Math.random() * 18,
        4 + Math.random() * 8,
        20 + Math.random() * 16,
      );
      mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      this.petals.push({
        mesh,
        phase: Math.random() * Math.PI * 2,
        speed: 0.18 + Math.random() * 0.2,
      });
      this.scene.add(mesh);
    }

    // Remi
    this.remi = new RemiActor();
    this.remi.group.position.set(
      this.map.remiSpawn.x,
      this.map.remiSpawn.y,
      this.map.remiSpawn.z,
    );
    this.remi.group.rotation.y = this.map.remiSpawn.yaw;
    this.scene.add(this.remi.group);
    void this.remi.load();

    // 日常行为：进入世界时她已经在墙钟安排的事情里（RW-P1-1）
    this.behavior = new RemiBehaviorController(this.remi, {
      onBehaviorChange: (_id, label) => this.callbacks.onRemiActivity?.(label),
    });

    // 玩家出生
    this.pos.set(this.map.spawn.x, this.map.spawn.y, this.map.spawn.z);
    this.yaw = this.map.spawn.yaw;

    // 后处理：bloom（灯笼/屏幕/太阳辉光）+ 输出色调映射 + 暗角
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(
      new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.4, 0.9),
    );
    this.composer.addPass(new OutputPass());
    this.composer.addPass(
      new ShaderPass({
        name: "VignetteWarmPass",
        uniforms: { tDiffuse: { value: null }, strength: { value: 0.3 } },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D tDiffuse;
          uniform float strength;
          varying vec2 vUv;
          void main() {
            vec4 c = texture2D(tDiffuse, vUv);
            float d = distance(vUv, vec2(0.5));
            c.rgb *= 1.0 - smoothstep(0.42, 0.86, d) * strength;
            gl_FragColor = c;
          }
        `,
      }),
    );

    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(container);
    this.onResize();

    this.bindEvents();
    this.lastT = performance.now();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  // ---------- 对外控制（由剧本层调用） ----------

  requestPointerLock(): void {
    try {
      const ret = this.renderer.domElement.requestPointerLock() as unknown;
      if (ret instanceof Promise) {
        ret.catch(() => this.enableFallbackControls());
      }
    } catch {
      this.enableFallbackControls();
    }
  }

  /** 直接进入拖动视角模式（调试模式或指针锁定不可用时） */
  enableFallbackControls(): void {
    if (this.fallbackControls) return;
    this.fallbackControls = true;
    this.callbacks.onLockChange(true);
  }

  /** 锁定或兜底模式任一生效，输入即可用 */
  private get controlsActive(): boolean {
    return this.pointerLocked || this.fallbackControls;
  }

  /** 调试/截图：把玩家直接放到指定位置朝向（?debug=1&cam=x,y,z,yaw,pitch） */
  teleport(x: number, y: number, z: number, yaw: number, pitch: number): void {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = pitch;
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.renderer.domElement;
  }

  setInteractEnabled(enabled: boolean): void {
    this.interactEnabled = enabled;
  }

  /**
   * 实时对话面板打开时挂起 FPS 控制：释放指针锁定、停下移动、
   * 不再因点击画布重新抢锁（让鼠标能去点输入框）。
   */
  setChatActive(active: boolean): void {
    this.chatActive = active;
    if (active) {
      this.keys.clear();
      if (this.pointerLocked) document.exitPointerLock();
    }
  }

  /** 点亮/熄灭门前灯笼（方块替换 + 点光源） */
  setLanternLit(lit: boolean): void {
    if (this.lanternLit === lit) return;
    this.lanternLit = lit;
    const [x, y, z] = this.map.lanternBlock;
    this.map.grid.set(x, y, z, lit ? Blocks.lanternLit.id : Blocks.lanternOff.id);
    this.rebuildWorld();
    this.lanternLight.intensity = lit ? 22 : 0;
  }

  /** 花圃开花（带生长动画） */
  plantFlowers(animate = true): void {
    if (this.plantedGroup.children.length > 0) return;
    for (const f of this.map.flowerPlantSpots) {
      const flower = this.makeFlower(f);
      if (animate) flower.scale.setScalar(0.01);
      this.plantedGroup.add(flower);
    }
  }

  /** 世界随剧情进入更深的暮色 */
  setDusk(target: boolean): void {
    this.duskTarget = target ? 1 : 0;
  }

  remiHappy(): void {
    this.remi.setHappy();
  }

  /** 对话情绪信号 → Remi 表情（RW-P1-3） */
  setRemiEmotion(emotion: string): void {
    this.remi.setEmotion(emotion);
  }

  /** TTS 口型信号源（RW-P1-3b）：传入 useRemiChat 暴露的 lipSignalRef，引擎每帧读取 */
  setLipSource(ref: { current: LipSignal } | null): void {
    this.lipSignalRef = ref;
  }

  /** 对话打开：Remi 停下手里的事、转向玩家（RW-P1-5 打断） */
  onDialogueOpen(): void {
    this.behavior.onDialogueOpen();
  }

  /** 对话结束：停顿片刻后回到之前的行为（RW-P1-5 恢复） */
  onDialogueClose(): void {
    this.behavior.onDialogueClose();
  }

  /** 给对话上下文 / HUD："她现在正在做什么" */
  getRemiActivity(): string {
    return this.behavior.getActivity().label;
  }

  /** 调试 / 截图：钉死某个日常行为 */
  forceBehavior(id: BehaviorId): void {
    this.behavior.forceBehavior(id);
  }

  /** 调试：当前行为状态机阶段 */
  get behaviorState(): BehaviorState {
    return this.behavior.getState();
  }

  distanceToRemi(): number {
    return this.pos.distanceTo(this.remi.group.position);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.unbindEvents();
    this.resizeObserver.disconnect();
    this.meshes.dispose();
    this.materials.dispose();
    this.spriteMat.dispose();
    this.atlas.dispose();
    this.composer.dispose();
    this.remi.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ---------- 内部 ----------

  private rebuildWorld(): void {
    this.scene.remove(this.meshes.group);
    this.meshes.dispose();
    this.meshes = buildWorldMeshes(this.map.grid, this.materials);
    if (this.meshes.opaque) {
      this.meshes.opaque.castShadow = true;
      this.meshes.opaque.receiveShadow = true;
    }
    this.scene.add(this.meshes.group);
  }

  /** 像素精灵十字面片小花 */
  private makeFlower(deco: FlowerDeco): THREE.Group {
    const group = new THREE.Group();
    const tile = flowerTileFor(deco.color);
    for (const rotY of [0, Math.PI / 2]) {
      const geo = new THREE.PlaneGeometry(0.8, 0.8);
      remapUvToTile(geo, tile);
      const mesh = new THREE.Mesh(geo, this.spriteMat);
      mesh.rotation.y = rotY + deco.x * 1.7;
      mesh.position.y = 0.4;
      group.add(mesh);
    }
    group.position.set(deco.x, deco.y, deco.z);
    return group;
  }

  /** 草地上的草丛（合并为单个网格） */
  private buildGrassTufts(): THREE.Mesh {
    const rect = tileUvRect(TILE.GRASS_TUFT);
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const grid = this.map.grid;
    const groundY = 3;

    const hash = (x: number, z: number) => {
      let h = (x * 374761393 + z * 668265263) | 0;
      h = (h ^ (h >>> 13)) * 1274126177;
      return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff;
    };

    for (let z = 0; z < grid.sz; z++) {
      for (let x = 0; x < grid.sx; x++) {
        const id = grid.get(x, groundY, z);
        const isGrass = id === Blocks.grass.id || id === Blocks.grassWarm.id;
        if (!isGrass || grid.get(x, groundY + 1, z) !== 0) continue;
        if (hash(x, z) > 0.2) continue;
        const wx = x + 0.3 + hash(x + 7, z) * 0.4;
        const wz = z + 0.3 + hash(x, z + 7) * 0.4;
        const wy = groundY + 1;
        const s = 0.55 + hash(x + 3, z + 3) * 0.3;
        for (const [ax, az] of [
          [1, 0],
          [0, 1],
        ] as const) {
          const base = positions.length / 3;
          positions.push(
            wx - ax * s * 0.5, wy, wz - az * s * 0.5,
            wx + ax * s * 0.5, wy, wz + az * s * 0.5,
            wx + ax * s * 0.5, wy + s, wz + az * s * 0.5,
            wx - ax * s * 0.5, wy + s, wz - az * s * 0.5,
          );
          for (let i = 0; i < 4; i++) normals.push(0, 1, 0);
          uvs.push(rect.u0, rect.v0, rect.u1, rect.v0, rect.u1, rect.v1, rect.u0, rect.v1);
          indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    return new THREE.Mesh(geo, this.spriteMat);
  }

  private onResize(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private onMouseMove = (e: MouseEvent): void => {
    const draggingLook = this.fallbackControls && this.dragging && !this.pointerLocked;
    if (!this.pointerLocked && !draggingLook) return;
    if (draggingLook) {
      this.dragMovedPx += Math.abs(e.movementX) + Math.abs(e.movementY);
    }
    this.yaw -= e.movementX * 0.0023;
    this.pitch -= e.movementY * 0.0023;
    const lim = Math.PI / 2 - 0.02;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  };

  private onMouseDown = (): void => {
    if (this.chatActive) return;
    if (this.fallbackControls && !this.pointerLocked) {
      this.dragging = true;
      this.dragMovedPx = 0;
    }
  };

  private onMouseUp = (): void => {
    this.dragging = false;
  };

  private onKey = (e: KeyboardEvent, down: boolean): void => {
    // 对话面板打开时，键盘归输入框（含 WASD 打字），引擎不拦截
    if (this.chatActive) return;
    if (down && e.code === "KeyE" && this.controlsActive && this.interactEnabled && this.focused) {
      this.callbacks.onInteract(this.focused.id);
      return;
    }
    if (down) this.keys.add(e.code);
    else this.keys.delete(e.code);
  };
  private onKeyDown = (e: KeyboardEvent): void => this.onKey(e, true);
  private onKeyUp = (e: KeyboardEvent): void => this.onKey(e, false);

  private onClick = (): void => {
    if (this.chatActive) return; // 对话中点击不抢指针锁定
    // 未激活时，点画布本身就是"进入"：先试指针锁定，失败自动转兜底模式
    if (!this.controlsActive) {
      this.requestPointerLock();
      return;
    }
    // 兜底模式下拖动视角松手时不要误触发交互
    if (this.fallbackControls && !this.pointerLocked && this.dragMovedPx > 6) return;
    if (this.interactEnabled && this.focused) {
      this.callbacks.onInteract(this.focused.id);
    }
  };

  private onLockChange = (): void => {
    if (!this.pointerLocked) this.keys.clear();
    this.callbacks.onLockChange(this.controlsActive);
  };

  private onLockError = (): void => {
    this.enableFallbackControls();
  };

  private bindEvents(): void {
    document.addEventListener("mousemove", this.onMouseMove);
    document.addEventListener("keydown", this.onKeyDown);
    document.addEventListener("keyup", this.onKeyUp);
    document.addEventListener("pointerlockchange", this.onLockChange);
    document.addEventListener("pointerlockerror", this.onLockError);
    document.addEventListener("mouseup", this.onMouseUp);
    this.renderer.domElement.addEventListener("mousedown", this.onMouseDown);
    this.renderer.domElement.addEventListener("click", this.onClick);
  }

  private unbindEvents(): void {
    document.removeEventListener("mousemove", this.onMouseMove);
    document.removeEventListener("keydown", this.onKeyDown);
    document.removeEventListener("keyup", this.onKeyUp);
    document.removeEventListener("pointerlockchange", this.onLockChange);
    document.removeEventListener("pointerlockerror", this.onLockError);
    document.removeEventListener("mouseup", this.onMouseUp);
    this.renderer.domElement.removeEventListener("mousedown", this.onMouseDown);
    this.renderer.domElement.removeEventListener("click", this.onClick);
  }

  /** AABB（脚底中心 pos）与实心体素求碰撞 */
  private collides(px: number, py: number, pz: number): boolean {
    const minX = px - PLAYER_HALF;
    const maxX = px + PLAYER_HALF;
    const minY = py;
    const maxY = py + PLAYER_HEIGHT;
    const minZ = pz - PLAYER_HALF;
    const maxZ = pz + PLAYER_HALF;
    for (let x = Math.floor(minX); x <= Math.floor(maxX); x++)
      for (let y = Math.floor(minY); y <= Math.floor(maxY); y++)
        for (let z = Math.floor(minZ); z <= Math.floor(maxZ); z++)
          if (this.map.grid.isSolid(x + 0.5, y + 0.5, z + 0.5)) return true;
    return false;
  }

  private stepPlayer(dt: number): void {
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const wish = new THREE.Vector3();
    if (this.controlsActive && !this.chatActive) {
      if (this.keys.has("KeyW")) wish.add(forward);
      if (this.keys.has("KeyS")) wish.sub(forward);
      if (this.keys.has("KeyD")) wish.add(right);
      if (this.keys.has("KeyA")) wish.sub(right);
    }
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(WALK_SPEED);
    this.vel.x = wish.x;
    this.vel.z = wish.z;

    if (this.controlsActive && this.keys.has("Space") && this.grounded) {
      this.vel.y = JUMP_SPEED;
      this.grounded = false;
    }
    this.vel.y -= GRAVITY * dt;

    // 分轴推进，碰撞即截断
    const nx = this.pos.x + this.vel.x * dt;
    if (!this.collides(nx, this.pos.y, this.pos.z)) this.pos.x = nx;
    const nz = this.pos.z + this.vel.z * dt;
    if (!this.collides(this.pos.x, this.pos.y, nz)) this.pos.z = nz;
    const ny = this.pos.y + this.vel.y * dt;
    if (this.collides(this.pos.x, ny, this.pos.z)) {
      if (this.vel.y < 0) {
        this.pos.y = Math.floor(ny) + 1;
        this.grounded = true;
      }
      this.vel.y = 0;
    } else {
      this.pos.y = ny;
      this.grounded = false;
    }

    // 掉海里 → 回出生点
    if (this.pos.y < -8) {
      this.pos.set(this.map.spawn.x, this.map.spawn.y, this.map.spawn.z);
      this.vel.set(0, 0, 0);
    }

    this.camera.position.set(this.pos.x, this.pos.y + EYE_HEIGHT, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");
  }

  private updateFocus(): void {
    let best: FocusInfo | null = null;
    let bestDist = INTERACT_RANGE;

    const origin = this.camera.position;
    const dir = this.camera.getWorldDirection(new THREE.Vector3());
    const ray = new THREE.Ray(origin, dir);
    const box = new THREE.Box3();
    const hit = new THREE.Vector3();

    for (const it of this.map.interactables) {
      box.min.set(it.box[0], it.box[1], it.box[2]);
      box.max.set(it.box[3], it.box[4], it.box[5]);
      if (ray.intersectBox(box, hit)) {
        const d = origin.distanceTo(hit);
        if (d < bestDist) {
          bestDist = d;
          best = { id: it.id, label: it.label };
        }
      }
    }

    // Remi：近距离 + 视线大致朝向她即可对话（比物件宽松）
    const remiPos = this.remi.group.position.clone().setY(this.remi.group.position.y + 1.2);
    const toRemi = remiPos.clone().sub(origin);
    const remiDist = toRemi.length();
    if (remiDist < 3.4 && toRemi.normalize().dot(dir) > 0.55 && remiDist < bestDist + 0.8) {
      best = { id: "remi", label: "Remi" };
    }

    if (best?.id !== this.focused?.id) {
      this.focused = best;
      this.callbacks.onFocusChange(best);
    }
  }

  private updateSky(dt: number): void {
    if (this.duskT !== this.duskTarget) {
      const dir = Math.sign(this.duskTarget - this.duskT);
      this.duskT = Math.max(0, Math.min(1, this.duskT + dir * dt * 0.25));
      const t = this.duskT;
      const lerpColor = (a: number, b: number) => new THREE.Color(a).lerp(new THREE.Color(b), t);
      (this.skyMat.uniforms.topColor.value as THREE.Color).copy(lerpColor(SKY_GOLDEN.top, SKY_DUSK.top));
      (this.skyMat.uniforms.midColor.value as THREE.Color).copy(lerpColor(SKY_GOLDEN.mid, SKY_DUSK.mid));
      (this.skyMat.uniforms.horizonColor.value as THREE.Color).copy(lerpColor(SKY_GOLDEN.horizon, SKY_DUSK.horizon));
      (this.skyMat.uniforms.sunColor.value as THREE.Color).copy(lerpColor(SKY_GOLDEN.sun, SKY_DUSK.sun));
      (this.scene.fog as THREE.Fog).color.copy(lerpColor(SKY_GOLDEN.fog, SKY_DUSK.fog));
      this.hemi.intensity = SKY_GOLDEN.hemiIntensity + (SKY_DUSK.hemiIntensity - SKY_GOLDEN.hemiIntensity) * t;
      this.dirLight.intensity = SKY_GOLDEN.dirIntensity + (SKY_DUSK.dirIntensity - SKY_GOLDEN.dirIntensity) * t;
    }

    if (this.lanternLit) {
      this.lanternFlicker += dt * 7;
      this.lanternLight.intensity = 22 + Math.sin(this.lanternFlicker) * 1.6 + Math.sin(this.lanternFlicker * 2.7) * 0.9;
    }
  }

  private loop(): void {
    if (this.disposed) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;

    this.stepPlayer(dt);
    this.updateFocus();
    this.updateSky(dt);

    // 种下的花生长动画
    for (const f of this.plantedGroup.children) {
      if (f.scale.x < 1) {
        const s = Math.min(1, f.scale.x + dt * 1.8);
        f.scale.setScalar(s);
      }
    }

    for (const cloud of this.clouds) {
      cloud.position.x += dt * 0.55;
      if (cloud.position.x > 130) cloud.position.x = -70;
    }

    // 花瓣飘落
    const t = now / 1000;
    for (const p of this.petals) {
      const m = p.mesh;
      m.position.y -= p.speed * dt;
      m.position.x += Math.sin(t * 1.2 + p.phase) * 0.35 * dt;
      m.position.z += Math.cos(t * 0.8 + p.phase) * 0.3 * dt;
      m.rotation.x += dt * 1.4;
      m.rotation.z += dt * 0.9;
      if (m.position.y < 4.05) {
        m.position.set(
          18 + Math.random() * 18,
          9 + Math.random() * 5,
          20 + Math.random() * 16,
        );
      }
    }

    // 行为调度先于角色渲染：决定她在做什么 / 朝哪 / 走不走
    this.behavior.update(dt, { x: this.pos.x, z: this.pos.z });
    // TTS 口型信号 → 嘴型（RW-P1-3b）
    const lip = this.lipSignalRef?.current;
    this.remi.setLip(lip?.envelope ?? 0, lip?.viseme ?? null);
    this.remi.update(dt, this.camera.position);

    if (!this.nearRemiFired && this.distanceToRemi() < 4.0) {
      this.nearRemiFired = true;
      this.callbacks.onNearRemi();
    }

    this.composer.render();
    this.raf = requestAnimationFrame(this.loop);
  }
}
