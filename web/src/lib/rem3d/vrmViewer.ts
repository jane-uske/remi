import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { VRM } from "@pixiv/three-vrm";
import {
  VRMLoaderPlugin,
  VRMExpressionPresetName,
  VRMHumanBoneName,
  VRMUtils,
} from "@pixiv/three-vrm";
import type {
  AvatarActionCommand,
  AvatarFrameState,
  AvatarIntent,
  LipSignal,
  RemiState,
  RemiTurnState,
} from "@/types/avatar";

/** 关闭每帧「归一化骨骼 → 蒙皮」的自动同步，改由我们直接写 raw 骨骼，否则摆好的手臂会被覆盖回 T-pose */
const VRM_LOADER_OPTIONS = { autoUpdateHumanBones: false as const };
import {
  applyExpressionWeights,
  getEmotionExpressionWeights,
  mergeExpressionWeights,
  type VrmExpressionWeights,
} from "./emotionToVrm";
import {
  mergeAvatarRuntimeSnapshot,
  pushAvatarDevtoolsLog,
} from "./devtoolsStore";
import {
  faceToExpressionWeights,
  lipSyncToExpressionWeights,
  visemeSignalToExpressionWeights,
} from "./faceToVrm";
import { SpeechMotionController } from "./speechMotion";

export type VrmViewerState = "loading" | "ready" | "error";

/**
 * 默认 `public/vrm/1497262518610234440.vrm`（可被 `NEXT_PUBLIC_VRM_URL` 覆盖）。
 * `.env` 里若写 `NEXT_PUBLIC_VRM_URL=`（空字符串），须视为未设置。
 */
export function getDefaultVrmUrl(): string {
  const raw = process.env.NEXT_PUBLIC_VRM_URL;
  if (typeof raw === "string" && raw.trim() !== "") {
    const t = raw.trim();
    // 无 scheme、无 leading / 的 `host:port/...` 会被当成相对路径，嵌进当前 URL
    if (/^[\w.-]+:\d+\//i.test(t)) return `http://${t}`;
    return t;
  }
  return "/vrm/1497262518610234440.vrm";
}

/**
 * Radians to rotate VRM around Y after load (camera at +Z, looks toward origin).
 * Default 0: many exports already face the camera; π was flipping them to show the back.
 * If your model faces away, set `NEXT_PUBLIC_VRM_YAW=3.14159` (or `-3.14159`).
 */
function getVrmYawRadians(): number {
  const raw = process.env.NEXT_PUBLIC_VRM_YAW;
  if (raw === undefined || raw.trim() === "") return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/** `full` 全身入镜；`upper` 上半身特写（拉近 + 注视偏上，腿部多在画外） */
function getVrmFramingMode(): "full" | "upper" {
  const raw = process.env.NEXT_PUBLIC_VRM_FRAMING?.trim().toLowerCase();
  if (raw === "upper" || raw === "bust" || raw === "half") return "upper";
  return "full";
}

/**
 * VRMC_node_constraint 会每帧把目标骨骼拉回作者绑定的姿势，与我们的手臂下垂逻辑冲突。
 * 设为 `0` 或 `false` 则保留约束（少数模型头发/饰品依赖它）。
 */
function shouldDisableVrmNodeConstraints(): boolean {
  const raw = process.env.NEXT_PUBLIC_VRM_DISABLE_NODE_CONSTRAINT?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return true;
}

/** 相对路径转为绝对 URL，避免少数环境下 Loader 解析异常 */
function resolveAssetUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (/^[\w.-]+:\d+\//i.test(url)) return `http://${url}`;
  if (typeof window !== "undefined" && url.startsWith("/")) {
    return `${window.location.origin}${url}`;
  }
  return url;
}

/**
 * 上臂从绑定姿势转向世界「向下」时 applied 的比例（略小于 1 留一点自然松弛）。
 * 与局部 euler 的 X/Y/Z 无关——不同绑定同名轴含义不同，故不用 rotateX 冒充「前摆」。
 */
const ARM_HANG_DOWN_BLEND = 0.94;

/**
 * 肘部前屈（弧度）：在「前臂」骨骼局部空间用 rotateX，多数 VRM 肘铰链接近绕局部 X；约 0.45–0.55。
 */
const ELBOW_RELAX_FLEX_RAD = 0.5;
const HAPPY_HOP_DURATION_MS = 820;
const HAPPY_HOP_HEIGHT = 0.1;
const FRAME_LIPSYNC_MAX_AGE_MS = 220;
const DEBUG_PUBLISH_INTERVAL_MS = 180;

/** 轻微偏暖的 albedo，减轻 ACES 下肤色发灰（衣物会一起略变暖，幅度很小） */
function warmTintSkinMaterials(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!mat) continue;
      const m = mat as THREE.MeshStandardMaterial;
      if (m.color?.isColor) {
        m.color.r = Math.min(1, m.color.r * 1.045);
        m.color.g = Math.min(1, m.color.g * 1.025);
        m.color.b = Math.min(1, m.color.b * 0.985);
      }
    }
  });
}

/**
 * 最小 3D 展示：VRM 加载 + 表情 + 轻微骨骼摆动（呼吸 / 点头感）。
 */
export class RemVrmViewer {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private vrm: VRM | null = null;
  private clock = new THREE.Clock();
  private raf = 0;
  private disposed = false;
  private currentEmotion = "neutral";
  /** 情绪切换时短暂增强头部动作 */
  private gestureT = 0;
  private loopStarted = false;
  private remState: RemiState = "idle";
  private turnState: RemiTurnState = "confirmed_end";
  private activeAction: (AvatarActionCommand & { endAtMs: number }) | null = null;
  private currentIntent: AvatarIntent | null = null;
  private currentFrame: AvatarFrameState | null = null;
  private emotionCue:
    | {
        kind: "happy_hop";
        startAtMs: number;
        durationMs: number;
      }
    | null = null;
  private sceneRestY = 0;
  private readonly speechMotion = new SpeechMotionController();

  readonly onStateChange?: (s: VrmViewerState, err?: string) => void;
  private readonly getLipEnvelope?: () => number;
  /** 与 TTS 播放同步；在 Web Audio 包络不可用时用于口型回退 */
  private readonly getVoiceActive?: () => boolean;
  private readonly getLipViseme?: () => LipSignal["viseme"] | null;
  private runtimeState: VrmViewerState = "loading";
  private lastDebugPublishAt = 0;

  /** 模型文件里的上臂/前臂静止四元数（T/A pose），每帧在此基础上做局部旋转，避免与绑定姿势冲突 */
  private readonly armRest = {
    lu: new THREE.Quaternion(),
    ru: new THREE.Quaternion(),
    ll: new THREE.Quaternion(),
    rl: new THREE.Quaternion(),
    lSh: new THREE.Quaternion(),
    rSh: new THREE.Quaternion(),
  };
  private hasArmRest = false;
  /** 躯干静止四元数；每帧先回正再叠微动作，避免长时间累加扭曲。 */
  private readonly torsoRest = {
    hips: new THREE.Quaternion(),
    spine: new THREE.Quaternion(),
    chest: new THREE.Quaternion(),
    neck: new THREE.Quaternion(),
  };

  /** 上臂「朝世界下垂」计算复用（见 applyUpperHangTowardWorldDown） */
  private readonly _armHang = {
    qWOld: new THREE.Quaternion(),
    qDelta: new THREE.Quaternion(),
    qWNew: new THREE.Quaternion(),
    qPWorld: new THREE.Quaternion(),
    qPInv: new THREE.Quaternion(),
    vDir: new THREE.Vector3(),
    vAxis: new THREE.Vector3(),
    vDown: new THREE.Vector3(0, -1, 0),
    /** 肩→肘，多数 VRM 骨骼局部 +X 沿大臂 */
    vArmAlong: new THREE.Vector3(1, 0, 0),
    /** vDir×vDown≈0（上臂竖直）时与 vDir 叉乘求旋转轴 */
    auxAxis: new THREE.Vector3(1, 0, 0),
    auxAxis2: new THREE.Vector3(0, 0, 1),
    shoulderW: new THREE.Vector3(),
    elbowW: new THREE.Vector3(),
  };

  constructor(
    container: HTMLElement,
    options?: {
      modelUrl?: string;
      onStateChange?: (s: VrmViewerState, err?: string) => void;
      /** TTS RMS envelope 0–1 from Web Audio (useAudioBase64Queue.lipEnvelopeRef) */
      getLipEnvelope?: () => number;
      /** 是否正在播放 TTS（用于口型回退） */
      getVoiceActive?: () => boolean;
      /** 上层 lip signal 内的 viseme 提示 */
      getLipViseme?: () => LipSignal["viseme"] | null;
    },
  ) {
    this.container = container;
    this.onStateChange = options?.onStateChange;
    this.getLipEnvelope = options?.getLipEnvelope;
    this.getVoiceActive = options?.getVoiceActive;
    this.getLipViseme = options?.getLipViseme;

    const w = container.clientWidth || 320;
    const h = container.clientHeight || 360;

    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.domElement.style.touchAction = "none";
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    // FOV 略宽便于同一距离内纳入肩与下垂手臂；具体距离在 load 后按包围盒计算
    this.camera = new THREE.PerspectiveCamera(40, w / h, 0.08, 80);
    this.camera.position.set(0, 1.42, 1.38);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 1.12, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    // 平移：右键拖动画布 / 中键拖动；Ctrl+左键拖（部分环境）也可平移
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = true;
    this.controls.panSpeed = 0.85;
    this.controls.minDistance = 0.45;
    this.controls.maxDistance = 6;
    this.controls.minPolarAngle = 0.28;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.update();

    this.renderer.domElement.addEventListener(
      "contextmenu",
      (e) => e.preventDefault(),
    );

    // 偏暖的半球光 + 主光 + 补光，肤色更接近自然室内/日光感
    const hemi = new THREE.HemisphereLight(0xfff0e8, 0x4a3f38, 0.92);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xfff5f0, 0.95);
    key.position.set(2.2, 4.2, 2.8);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffe8dc, 0.42);
    fill.position.set(-2.0, 2.4, 1.8);
    this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xd4e8ff, 0.28);
    rim.position.set(-0.5, 1.6, -2.2);
    this.scene.add(rim);

    const url = options?.modelUrl ?? getDefaultVrmUrl();
    void this.load(resolveAssetUrl(url));
  }

  private async load(url: string): Promise<void> {
    this.runtimeState = "loading";
    this.onStateChange?.("loading");
    pushAvatarDevtoolsLog("runtime", "viewer loading", { url });
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser, VRM_LOADER_OPTIONS));

    try {
      const gltf = await loader.loadAsync(url);
      const vrm = gltf.userData.vrm as VRM | undefined;
      if (!vrm) {
        throw new Error("VRM 数据缺失");
      }
      if (this.disposed) {
        VRMUtils.deepDispose(vrm.scene);
        return;
      }
      this.vrm = vrm;
      if (shouldDisableVrmNodeConstraints()) {
        const v = vrm as { nodeConstraintManager?: unknown };
        v.nodeConstraintManager = undefined;
      }
      const yaw = getVrmYawRadians();
      if (yaw !== 0) vrm.scene.rotation.y = yaw;
      this.sceneRestY = vrm.scene.position.y;
      this.scene.add(vrm.scene);
      warmTintSkinMaterials(vrm.scene);
      applyExpressionWeights(vrm, getEmotionExpressionWeights(this.currentEmotion));
      // 先跑一帧 VRM，再采样骨骼作为「绑定姿势」，避免未初始化时误把抬手/T 姿当成 rest
      vrm.update(0);
      vrm.scene.updateMatrixWorld(true);
      this.captureTorsoRestPose(vrm);
      this.captureArmRestPose(vrm);
      this.applyIdlePose(0);
      vrm.scene.updateMatrixWorld(true);
      this.frameCameraToModelUpperBody();
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.runtimeState = "ready";
      this.onStateChange?.("ready");
      pushAvatarDevtoolsLog("runtime", "viewer ready", { url });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.runtimeState = "error";
      this.onStateChange?.("error", msg);
      pushAvatarDevtoolsLog("runtime", "viewer error", { url, msg });
    }
  }

  /**
   * 按包围盒设初始机位。`full`：全身偏靠画面下方；`upper`：上半身特写（腿多在画外）。
   * 之后仍可用右键/中键平移、左键旋转、滚轮缩放。
   */
  private frameCameraToModelUpperBody(): void {
    const vrm = this.vrm;
    if (!vrm) return;

    const framing = getVrmFramingMode();

    const box = new THREE.Box3().setFromObject(vrm.scene);
    if (box.isEmpty()) {
      this.controls.target.set(0, 1.05, 0);
      this.camera.position.set(0, 1.45, 1.55);
    } else {
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      if (size.y < 1e-4) return;

      const vFov = (this.camera.fov * Math.PI) / 180;
      const aspect = Math.max(this.camera.aspect, 0.45);
      const margin = framing === "upper" ? 1.15 : 1.2;

      // 用于算距离的「有效高度」：上半身模式只用约半高，拉近后自然裁掉腿部
      const effectiveHeight =
        framing === "upper" ? size.y * 0.52 : size.y;

      let targetY: number;
      if (framing === "upper") {
        targetY = center.y + size.y * 0.08;
      } else {
        targetY = center.y - size.y * 0.14;
      }

      const target = new THREE.Vector3(center.x, targetY, center.z);

      // 全身：整体上移注视点与机位（世界 +Y），人物在屏幕里更靠下、贴近画布底侧
      if (framing === "full") {
        target.y += size.y * 0.4;
      } else {
        target.y += size.y * 0.05;
      }

      this.controls.target.copy(target);

      const distH = (effectiveHeight * margin) / (2 * Math.tan(vFov / 2));
      const distW = (size.x * margin) / (2 * Math.tan(vFov / 2) * aspect);
      const dist = Math.min(Math.max(distH, distW, 0.4), 12);

      const camYOffset =
        framing === "upper" ? size.y * 0.07 : size.y * 0.11;
      this.camera.position.set(
        target.x,
        target.y + camYOffset,
        target.z + dist,
      );

      this.controls.minDistance = Math.max(0.22, dist * 0.32);
      this.controls.maxDistance = Math.max(3.5, dist * 3.2);
    }

    const d = this.camera.position.distanceTo(this.controls.target);
    this.camera.near = Math.max(0.015, d * 0.015);
    this.camera.far = Math.max(50, d * 30);
    this.camera.updateProjectionMatrix();
  }

  private captureArmRestPose(vrm: VRM): void {
    const h = vrm.humanoid;
    if (!h) return;
    const q = (name: VRMHumanBoneName, target: THREE.Quaternion) => {
      const n = h.getRawBoneNode(name);
      if (n) target.copy(n.quaternion);
    };
    q(VRMHumanBoneName.LeftUpperArm, this.armRest.lu);
    q(VRMHumanBoneName.RightUpperArm, this.armRest.ru);
    q(VRMHumanBoneName.LeftLowerArm, this.armRest.ll);
    q(VRMHumanBoneName.RightLowerArm, this.armRest.rl);
    q(VRMHumanBoneName.LeftShoulder, this.armRest.lSh);
    q(VRMHumanBoneName.RightShoulder, this.armRest.rSh);
    this.hasArmRest =
      !!h.getRawBoneNode(VRMHumanBoneName.LeftUpperArm) &&
      !!h.getRawBoneNode(VRMHumanBoneName.RightUpperArm);
  }

  private captureTorsoRestPose(vrm: VRM): void {
    const h = vrm.humanoid;
    if (!h) return;
    const q = (name: VRMHumanBoneName, target: THREE.Quaternion) => {
      const n = h.getRawBoneNode(name);
      if (n) target.copy(n.quaternion);
    };
    q(VRMHumanBoneName.Hips, this.torsoRest.hips);
    q(VRMHumanBoneName.Spine, this.torsoRest.spine);
    q(VRMHumanBoneName.Chest, this.torsoRest.chest);
    q(VRMHumanBoneName.Neck, this.torsoRest.neck);
  }

  startLoop(): void {
    if (this.loopStarted) return;
    this.loopStarted = true;
    const tick = () => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(tick);
      const delta = this.clock.getDelta();
      const t = this.clock.elapsedTime;

      if (this.vrm) {
        // 先跑 VRM 内部（LookAt / 表情系统 / SpringBone…），再写 raw 骨骼与口型，避免被 humanoid 同步冲掉
        this.vrm.update(delta);
        this.applyIdlePose(t);
        this.applySpeechMotion(delta, t);
        this.vrm.expressionManager?.update();
      }

      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** 待机：呼吸 + 躯干/头/肩微动 + 情绪手势（直接写 raw 骨骼，需配合 autoUpdateHumanBones: false） */
  private applyIdlePose(t: number): void {
    const vrm = this.vrm;
    if (!vrm?.humanoid) return;
    vrm.scene.position.y = this.sceneRestY;

    const hips = vrm.humanoid.getRawBoneNode(VRMHumanBoneName.Hips);
    const spine = vrm.humanoid.getRawBoneNode(VRMHumanBoneName.Spine);
    const chest = vrm.humanoid.getRawBoneNode(VRMHumanBoneName.Chest);
    const luArm = vrm.humanoid.getRawBoneNode(VRMHumanBoneName.LeftUpperArm);
    const ruArm = vrm.humanoid.getRawBoneNode(VRMHumanBoneName.RightUpperArm);
    const llArm = vrm.humanoid.getRawBoneNode(VRMHumanBoneName.LeftLowerArm);
    const rlArm = vrm.humanoid.getRawBoneNode(VRMHumanBoneName.RightLowerArm);
    const lSh = vrm.humanoid.getRawBoneNode(VRMHumanBoneName.LeftShoulder);
    const rSh = vrm.humanoid.getRawBoneNode(VRMHumanBoneName.RightShoulder);
    const neck = vrm.humanoid.getRawBoneNode(VRMHumanBoneName.Neck);

    if (hips) hips.quaternion.copy(this.torsoRest.hips);
    if (spine) spine.quaternion.copy(this.torsoRest.spine);
    if (chest) chest.quaternion.copy(this.torsoRest.chest);
    if (neck) neck.quaternion.copy(this.torsoRest.neck);

    const breath = Math.sin(t * 1.35) * 0.024;
    const sway = Math.sin(t * 0.38) * 0.018;
    const listeningActive = this.turnState === "listening_active";
    const listeningHold = this.turnState === "listening_hold";
    const likelyEnd =
      this.turnState === "likely_end" || this.turnState === "confirmed_end";
    const entering = this.turnState === "assistant_entering";
    const preparingToSpeak = likelyEnd || entering;
    const energyFactor =
      this.currentIntent?.energy === 3 ? 1.3
      : this.currentIntent?.energy === 2 ? 1.12
      : this.currentIntent?.energy === 0 ? 0.72
      : 1;
    const inwardFactor =
      this.currentIntent?.gesture === "shrink_in" || this.currentEmotion === "sad"
        ? 1
        : 0;
    const leanInFactor =
      this.currentIntent?.gesture === "lean_in" || listeningActive ? 1 : 0;
    const openUpFactor = preparingToSpeak ? 1 : 0;
    const tiltFactor =
      this.currentIntent?.gesture === "tilt_head" || listeningHold ? 1 : 0;
    const swayFactor =
      listeningActive ? 0.5
      : listeningHold ? 0.38
      : preparingToSpeak ? 0.7
      : 1;
    if (hips) {
      hips.rotation.y = sway * energyFactor * swayFactor * (1 - inwardFactor * 0.25);
      hips.rotation.z =
        Math.sin(t * 0.31) * 0.012 * energyFactor * (0.75 + swayFactor * 0.25);
      hips.rotation.x += openUpFactor * 0.012 - inwardFactor * 0.01;
    }
    if (spine) {
      spine.rotation.x =
        breath * energyFactor -
        inwardFactor * 0.045 -
        leanInFactor * 0.036 +
        openUpFactor * 0.026;
      spine.rotation.y = Math.sin(t * 0.42) * 0.025 * energyFactor * swayFactor;
      spine.rotation.z += tiltFactor * -0.024;
    }
    if (chest) {
      chest.rotation.x =
        breath * 0.62 * energyFactor -
        inwardFactor * 0.075 -
        leanInFactor * 0.048 +
        openUpFactor * 0.04;
      chest.rotation.y += preparingToSpeak ? Math.sin(t * 1.8) * 0.014 : 0;
      chest.rotation.z = inwardFactor * -0.035 + tiltFactor * -0.04;
    }
    if (neck) {
      if (inwardFactor > 0) {
        neck.rotation.x -= 0.038;
        neck.rotation.z -= 0.018;
      }
      neck.rotation.x += leanInFactor * 0.028 - openUpFactor * 0.012;
      neck.rotation.z += tiltFactor * -0.05;
      neck.rotation.y += listeningActive ? Math.sin(t * 1.2) * 0.012 : 0;
    }

    if (this.gestureT > 0) {
      this.gestureT = Math.max(0, this.gestureT - 0.02);
    }
    const g = this.gestureT;
    const now = Date.now();

    if (this.activeAction && now >= this.activeAction.endAtMs) {
      this.activeAction = null;
    }
    if (this.emotionCue && now >= this.emotionCue.startAtMs + this.emotionCue.durationMs) {
      this.emotionCue = null;
    }
    const action = this.activeAction;

    // 头部由 vrm.update 内 LookAt 控制，此处不再改 head/neck，避免每帧叠加或抢视线

    const e = this.currentEmotion;

    if (e === "neutral" && luArm && ruArm && llArm && rlArm) {
      this.applyNeutralHangingArms(
        t,
        luArm,
        ruArm,
        llArm,
        rlArm,
        lSh,
        rSh,
      );
    } else if (luArm && ruArm) {
      let lr = 0;
      let rr = 0;
      if (e === "happy") {
        rr = 0.35 + g * 0.2;
      } else if (e === "curious") {
        lr = 0.25;
        rr = 0.1;
      } else if (e === "shy") {
        lr = 0.45;
        rr = 0.45;
      } else if (e === "sad") {
        lr = -0.18;
        rr = -0.18;
      }
      if (leanInFactor > 0) {
        lr += 0.08 * leanInFactor;
        rr += 0.08 * leanInFactor;
      }
      if (openUpFactor > 0) {
        lr -= 0.08 * openUpFactor;
        rr += 0.08 * openUpFactor;
      }
      const armWiggle = Math.sin(t * 1.05) * 0.028;
      ruArm.rotation.z = rr + armWiggle;
      luArm.rotation.z = -lr - armWiggle * 0.95;
      ruArm.rotation.x = 0.38 + Math.sin(t * 0.72) * 0.018;
      luArm.rotation.x = 0.38 + Math.sin(t * 0.68) * 0.018;
      if (llArm && rlArm) {
        rlArm.rotation.x = 0.28 + Math.sin(t * 0.88) * 0.04;
        llArm.rotation.x = 0.28 + Math.sin(t * 0.9) * 0.04;
      }
    }

    if (chest && this.remState === "thinking") {
      chest.rotation.y += Math.sin(t * 1.8) * 0.045;
    }

    if (this.emotionCue?.kind === "happy_hop") {
      const hopT = Math.max(
        0,
        Math.min(1, (now - this.emotionCue.startAtMs) / this.emotionCue.durationMs),
      );
      const lift = Math.sin(Math.PI * hopT);
      const settle = hopT > 0.68 ? Math.sin((hopT - 0.68) * Math.PI * 3.125) * 0.01 : 0;
      vrm.scene.position.y = this.sceneRestY + HAPPY_HOP_HEIGHT * lift + settle;
      if (hips) hips.rotation.x -= 0.11 * lift;
      if (chest) {
        chest.rotation.x += 0.16 * lift;
        chest.rotation.y += Math.sin(hopT * Math.PI * 2) * 0.03;
      }
      if (luArm && ruArm) {
        luArm.rotation.z -= 0.16 + 0.24 * lift;
        ruArm.rotation.z += 0.16 + 0.24 * lift;
        luArm.rotation.x += 0.06 * lift;
        ruArm.rotation.x += 0.06 * lift;
      }
      if (llArm && rlArm) {
        llArm.rotation.x += 0.08 * lift;
        rlArm.rotation.x += 0.08 * lift;
      }
    }

    if (action && ruArm && luArm && chest) {
      const k = Math.max(0.2, Math.min(1, action.intensity || 0.6));
      if (action.action === "nod") {
        chest.rotation.x += Math.sin(t * 7.5) * 0.06 * k;
      } else if (action.action === "shake_head") {
        chest.rotation.y += Math.sin(t * 8.2) * 0.11 * k;
      } else if (action.action === "wave") {
        ruArm.rotation.z += 0.5 * k;
        ruArm.rotation.x += Math.sin(t * 10.5) * 0.28 * k;
      } else if (action.action === "tilt_head") {
        chest.rotation.z += 0.12 * k;
      } else if (action.action === "shrug") {
        chest.rotation.y += Math.sin(t * 8.4) * 0.06 * k;
        if (lSh) lSh.rotation.z -= 0.22 * k;
        if (rSh) rSh.rotation.z += 0.22 * k;
      }
    }
  }

  /** 说话态：嘴型、眨眼、眼神与轻量头胸部微动作统一从播放包络驱动。 */
  private applySpeechMotion(delta: number, elapsed: number): void {
    const vrm = this.vrm;
    if (!vrm?.humanoid) return;

    const speech = this.speechMotion.update({
      delta,
      elapsed,
      emotion: this.currentEmotion,
      remState: this.remState,
      lipEnvelope: this.getLipEnvelope?.() ?? 0,
      voiceActive: this.getVoiceActive?.() ?? false,
    });

    const chest = vrm.humanoid.getRawBoneNode(VRMHumanBoneName.Chest);
    const neck = vrm.humanoid.getRawBoneNode(VRMHumanBoneName.Neck);
    if (chest) {
      chest.rotation.x += speech.chestPitch;
      chest.rotation.y += speech.chestYaw;
      chest.rotation.z += speech.chestRoll;
    }
    if (neck) {
      neck.rotation.x += speech.neckPitch;
      neck.rotation.y += speech.neckYaw;
      neck.rotation.z += speech.neckRoll;
    }

    const expressionWeights = mergeExpressionWeights(
      getEmotionExpressionWeights(this.currentEmotion),
      this.getFrameExpressionWeights(),
      this.getTurnStateExpressionWeights(),
      this.getIntentAccentWeights(),
      this.getActionExpressionWeights(),
      speech.expressions,
      this.getLipOverrideWeights(),
    );

    applyExpressionWeights(vrm, expressionWeights);
    this.publishDebugSnapshot(expressionWeights);
  }

  private getActionExpressionWeights(): VrmExpressionWeights | null {
    const action = this.activeAction;
    if (!action) return null;
    const k = Math.max(0.18, Math.min(1, action.intensity || 0.6));
    if (action.action === "eyebrow_raise") {
      return {
        [VRMExpressionPresetName.Surprised]: 0.2 + 0.32 * k,
        [VRMExpressionPresetName.LookUp]: 0.04 + 0.08 * k,
      };
    }
    return null;
  }

  private getTurnStateExpressionWeights(): VrmExpressionWeights | null {
    switch (this.turnState) {
      case "listening_active":
        return {
          [VRMExpressionPresetName.Relaxed]: 0.09,
          [VRMExpressionPresetName.LookUp]: 0.04,
        };
      case "listening_hold":
        return {
          [VRMExpressionPresetName.Relaxed]: 0.05,
          [VRMExpressionPresetName.LookDown]: 0.03,
        };
      case "likely_end":
      case "confirmed_end":
        return {
          [VRMExpressionPresetName.Relaxed]: 0.06,
          [VRMExpressionPresetName.Surprised]: 0.04,
        };
      case "assistant_entering":
        return {
          [VRMExpressionPresetName.Relaxed]: 0.08,
          [VRMExpressionPresetName.Surprised]: 0.06,
          [VRMExpressionPresetName.LookUp]: 0.03,
        };
      case "interrupted_by_user":
        return {
          [VRMExpressionPresetName.Sad]: 0.08,
          [VRMExpressionPresetName.Angry]: 0.04,
        };
      default:
        return null;
    }
  }

  private getIntentAccentWeights(): VrmExpressionWeights | null {
    switch (this.currentIntent?.facialAccent) {
      case "brow_furrow":
        return {
          [VRMExpressionPresetName.Angry]: 0.28,
          [VRMExpressionPresetName.Sad]: 0.22,
        };
      case "brow_raise":
        return {
          [VRMExpressionPresetName.Surprised]: 0.24,
        };
      case "soft_smile":
        return {
          [VRMExpressionPresetName.Happy]: 0.16,
          [VRMExpressionPresetName.Relaxed]: 0.08,
        };
      case "sad_mouth":
        return {
          [VRMExpressionPresetName.Sad]: 0.3,
        };
      default:
        return null;
    }
  }

  private getFrameExpressionWeights(): VrmExpressionWeights | null {
    return faceToExpressionWeights(this.currentFrame?.face);
  }

  private getLipOverrideWeights(): VrmExpressionWeights | null {
    const now = Date.now();
    if (
      this.currentFrame?.lipSync &&
      this.currentFrame.lipSyncAtMs != null &&
      now - this.currentFrame.lipSyncAtMs <= FRAME_LIPSYNC_MAX_AGE_MS
    ) {
      return lipSyncToExpressionWeights(this.currentFrame.lipSync);
    }
    return visemeSignalToExpressionWeights(this.getLipViseme?.() ?? null);
  }

  private publishDebugSnapshot(expressionWeights: VrmExpressionWeights): void {
    const now = Date.now();
    if (now - this.lastDebugPublishAt < DEBUG_PUBLISH_INTERVAL_MS) return;
    this.lastDebugPublishAt = now;
    mergeAvatarRuntimeSnapshot({
      ts: now,
      emotion: this.currentEmotion,
      remState: this.remState,
      voiceActive: this.getVoiceActive?.() ?? false,
      lipEnvelope: this.getLipEnvelope?.() ?? 0,
      expressionWeights,
      activeAction: this.activeAction,
      activeCue: this.emotionCue?.kind ?? null,
      runtimeState: this.runtimeState,
      intent: this.currentIntent,
    });
  }

  private triggerEmotionCue(kind: "happy_hop", durationMs: number): void {
    this.emotionCue = {
      kind,
      startAtMs: Date.now(),
      durationMs,
    };
  }

  /**
   * 上臂：在绑定姿势上，把「沿大臂指向」在世界系里转向接近「向下」（几何最短路径），再换算回局部四元数。
   * 不调用 rotateX/Y/Z 叠「假想前摆」——局部轴在每条骨骼上含义不同，Z 往往是内外翻（你遇到的情况）。
   */
  private applyUpperHangTowardWorldDown(
    bone: THREE.Object3D,
    restQuat: THREE.Quaternion,
    lowerArm: THREE.Object3D,
  ): void {
    const vrm = this.vrm;
    if (!vrm) return;

    const h = this._armHang;
    bone.quaternion.copy(restQuat);
    vrm.scene.updateMatrixWorld(true);

    bone.getWorldQuaternion(h.qWOld);
    // 用肩→肘世界方向作为大臂朝向，避免右侧镜像骨骼局部 +X 与左侧含义不一致导致单手落不下来
    bone.getWorldPosition(h.shoulderW);
    lowerArm.getWorldPosition(h.elbowW);
    h.vDir.subVectors(h.elbowW, h.shoulderW);
    if (h.vDir.lengthSq() < 1e-12) {
      h.vDir.copy(h.vArmAlong).applyQuaternion(h.qWOld).normalize();
    } else {
      h.vDir.normalize();
    }

    h.vAxis.crossVectors(h.vDir, h.vDown);
    let axLen = h.vAxis.length();
    // 上臂与世界「下」几乎共线时叉积为 0：竖直上举会整段 return，手永远举着
    if (axLen < 1e-7) {
      const align = h.vDir.dot(h.vDown);
      if (align > 0.985) return;
      h.vAxis.crossVectors(h.vDir, h.auxAxis);
      axLen = h.vAxis.length();
      if (axLen < 1e-7) {
        h.vAxis.crossVectors(h.vDir, h.auxAxis2);
        axLen = h.vAxis.length();
      }
      if (axLen < 1e-7) return;
    }
    h.vAxis.divideScalar(axLen);

    let angle = h.vDir.angleTo(h.vDown);
    angle *= ARM_HANG_DOWN_BLEND;
    // 旧版 cap 在 ~86°，从「上举」到自然下垂需接近 180°，会导致单手永远落不下来
    angle = Math.min(angle, Math.PI * 0.96);

    h.qDelta.setFromAxisAngle(h.vAxis, angle);
    h.qWNew.copy(h.qDelta).multiply(h.qWOld);

    const parent = bone.parent;
    if (!parent) return;
    parent.getWorldQuaternion(h.qPWorld);
    h.qPInv.copy(h.qPWorld).invert();
    bone.quaternion.copy(h.qPInv.multiply(h.qWNew));
  }

  /**
   * 双臂自然下垂：上臂用世界空间算法；前臂仅在局部叠一小段屈肘（多数绑定为 rotateX）。
   */
  private applyNeutralHangingArms(
    t: number,
    luArm: THREE.Object3D,
    ruArm: THREE.Object3D,
    llArm: THREE.Object3D,
    rlArm: THREE.Object3D,
    lSh: THREE.Object3D | null,
    rSh: THREE.Object3D | null,
  ): void {
    const elbowWiggle = 0.02;
    if (!this.hasArmRest) return;

    this.applyUpperHangTowardWorldDown(luArm, this.armRest.lu, llArm);
    this.applyUpperHangTowardWorldDown(ruArm, this.armRest.ru, rlArm);
    this.vrm!.scene.updateMatrixWorld(true);

    llArm.quaternion.copy(this.armRest.ll);
    llArm.rotateX(
      ELBOW_RELAX_FLEX_RAD + Math.sin(t * 0.85) * elbowWiggle,
    );
    rlArm.quaternion.copy(this.armRest.rl);
    rlArm.rotateX(
      ELBOW_RELAX_FLEX_RAD + Math.sin(t * 0.88) * elbowWiggle,
    );

    if (lSh) lSh.quaternion.copy(this.armRest.lSh);
    if (rSh) rSh.quaternion.copy(this.armRest.rSh);
  }

  setEmotion(emotion: string): void {
    const next = String(emotion || "neutral").toLowerCase();
    if (next === this.currentEmotion) return;
    this.currentEmotion = next;
    this.gestureT = 1;
    if (next === "happy") {
      this.triggerEmotionCue("happy_hop", HAPPY_HOP_DURATION_MS);
    }
  }

  setState(state: RemiState): void {
    this.remState = state;
  }

  setTurnState(state: RemiTurnState): void {
    this.turnState = state;
  }

  setIntent(intent: AvatarIntent | null): void {
    const prevGesture = this.currentIntent?.gesture;
    const prevEmotion = this.currentIntent?.emotion;
    this.currentIntent = intent;
    if (
      intent?.gesture === "happy_hop" &&
      (prevGesture !== "happy_hop" || prevEmotion !== intent.emotion)
    ) {
      this.triggerEmotionCue("happy_hop", intent.holdMs || HAPPY_HOP_DURATION_MS);
    }
  }

  setFrame(frame: AvatarFrameState | null): void {
    this.currentFrame = frame;
  }

  playAction(action: string, intensity: number, duration: number): void {
    const safeDuration = Number.isFinite(duration)
      ? Math.max(200, Math.min(duration, 4000))
      : 700;
    this.activeAction = {
      action,
      intensity: Number.isFinite(intensity) ? intensity : 0.6,
      duration: safeDuration,
      endAtMs: Date.now() + safeDuration,
    };
    this.gestureT = 1;
  }

  resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w <= 0 || h <= 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.controls.update();
  }

  dispose(): void {
    this.disposed = true;
    this.speechMotion.reset();
    cancelAnimationFrame(this.raf);
    this.controls.dispose();
    if (this.vrm) {
      this.scene.remove(this.vrm.scene);
      VRMUtils.deepDispose(this.vrm.scene);
      this.vrm = null;
    }
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }
}
