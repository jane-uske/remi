/**
 * 世界里的 Remi：优先加载默认 VRM（与 /remi 展台同一模型源）；
 * VRM 文件缺失/加载失败时退回体素小人（蓝发女仆 chibi），保持 voxel 画风一致。
 *
 * 活人感 v0.1：呼吸、眨眼、眼神跟随玩家、靠近时转身面向你、开心时小跳。
 * v0.2 再做：行走/寻路、走到窗边、情绪管线接入（emotionToVrm 已有现成映射）。
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { VRM } from "@pixiv/three-vrm";
import { VRMHumanBoneName, VRMLoaderPlugin } from "@pixiv/three-vrm";
import { getDefaultVrmUrl } from "@/lib/avatar/modelUrls";
import type { TaskMotion } from "./behavior";

/** 与 vrmViewer 同语义：模型默认面向 +Z，可用 NEXT_PUBLIC_VRM_YAW 修正 */
function getVrmYawRadians(): number {
  const raw = process.env.NEXT_PUBLIC_VRM_YAW;
  if (raw === undefined || raw.trim() === "") return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

const HEAD_YAW_LIMIT = 0.65;
const HEAD_PITCH_LIMIT = 0.35;
/** 做事时偶尔"瞟一眼"玩家的头部转动上限 */
const GLANCE_LIMIT = 0.32;

function makeNameplate(): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(20, 16, 28, 0.55)";
  ctx.beginPath();
  ctx.roundRect(58, 8, 140, 48, 24);
  ctx.fill();
  ctx.font = "bold 30px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffe9d6";
  ctx.fillText("Remi ❀", 128, 34);
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  sprite.scale.set(1.15, 0.29, 1);
  return sprite;
}

/** 体素兜底小人。整体朝 +Z，脚底在 y=0。 */
function buildVoxelRemi(): {
  root: THREE.Group;
  head: THREE.Group;
  mouth: THREE.Mesh;
} {
  const root = new THREE.Group();
  const mat = (color: number) => new THREE.MeshLambertMaterial({ color });
  const box = (
    w: number,
    h: number,
    d: number,
    color: number,
    x: number,
    y: number,
    z: number,
    parent: THREE.Object3D = root,
  ) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  const HAIR = 0x6fa9e0;
  const SKIN = 0xf6dcc8;
  const DRESS = 0x3c4668;
  const WHITE = 0xf4f1e8;

  // 鞋/腿（白色裤袜）
  box(0.13, 0.1, 0.2, 0x3a3440, -0.09, 0.05, 0.02);
  box(0.13, 0.1, 0.2, 0x3a3440, 0.09, 0.05, 0.02);
  box(0.12, 0.34, 0.13, WHITE, -0.09, 0.27, 0);
  box(0.12, 0.34, 0.13, WHITE, 0.09, 0.27, 0);
  // 裙摆（下宽上窄两段）+ 围裙
  box(0.5, 0.18, 0.34, DRESS, 0, 0.51, 0);
  box(0.42, 0.16, 0.3, DRESS, 0, 0.66, 0);
  box(0.3, 0.3, 0.02, WHITE, 0, 0.58, 0.165);
  // 上身 + 袖子 + 手
  box(0.34, 0.3, 0.24, DRESS, 0, 0.88, 0);
  box(0.1, 0.26, 0.12, DRESS, -0.24, 0.9, 0);
  box(0.1, 0.26, 0.12, DRESS, 0.24, 0.9, 0);
  box(0.09, 0.09, 0.1, SKIN, -0.24, 0.71, 0);
  box(0.09, 0.09, 0.1, SKIN, 0.24, 0.71, 0);
  // 白色衣领
  box(0.2, 0.06, 0.18, WHITE, 0, 1.04, 0.03);

  // 头（独立 group，便于注视玩家）
  const head = new THREE.Group();
  head.position.set(0, 1.1, 0);
  root.add(head);
  box(0.4, 0.36, 0.36, SKIN, 0, 0.18, 0.02, head);
  // 头发：顶盖 + 后发 + 刘海 + 侧发
  box(0.44, 0.14, 0.4, HAIR, 0, 0.4, 0, head);
  box(0.44, 0.3, 0.14, HAIR, 0, 0.22, -0.15, head);
  box(0.44, 0.12, 0.1, HAIR, 0, 0.32, 0.16, head);
  box(0.08, 0.3, 0.12, HAIR, -0.22, 0.18, 0.08, head);
  box(0.08, 0.3, 0.12, HAIR, 0.22, 0.18, 0.08, head);
  // 女仆头饰
  box(0.18, 0.06, 0.22, WHITE, 0, 0.48, 0.02, head);
  // 眼睛 + 腮红
  box(0.06, 0.09, 0.02, 0x2e4a8a, -0.09, 0.16, 0.205, head);
  box(0.06, 0.09, 0.02, 0x2e4a8a, 0.09, 0.16, 0.205, head);
  box(0.05, 0.03, 0.015, 0xefb4a8, -0.15, 0.09, 0.2, head);
  box(0.05, 0.03, 0.015, 0xefb4a8, 0.15, 0.09, 0.2, head);
  // 嘴（说话时按 envelope 纵向张开；静止是一条细线）
  const mouth = box(0.07, 0.022, 0.02, 0x9a4a44, 0, 0.04, 0.205, head);

  return { root, head, mouth };
}

export class RemiActor {
  /** 角色根节点（脚底原点），由引擎摆位置/朝向 */
  readonly group = new THREE.Group();

  private vrm: VRM | null = null;
  private voxelHead: THREE.Group | null = null;
  private voxelMouth: THREE.Mesh | null = null;
  private bodyRoot: THREE.Object3D | null = null;
  private lookTarget = new THREE.Object3D();
  private nameplate: THREE.Sprite;

  private time = Math.random() * 10;
  private blinkAt = 1.5;
  private blinkPhase = 0;
  private happyUntil = 0;
  private restY = 0;
  private emotion = "neutral";
  private exprWeights = { happy: 0, sad: 0, angry: 0, relaxed: 0, surprised: 0 };
  // 口型（RW-P1-3b）：TTS 播放时由 lipSignal 驱动
  private lipEnvelope = 0;
  private lipViseme: { name: string; weight: number } | null = null;
  private lipAa = 0;
  private lipOh = 0;

  // 行为系统（behavior.ts 的 BehaviorPuppet 实现面）
  private mode: "task" | "attend" | "talk" = "task";
  private desiredYaw = 0;
  private taskMotion: TaskMotion | null = null;
  private walking = false;
  private nodClock = 0;

  constructor() {
    this.group.add(this.lookTarget);
    this.nameplate = makeNameplate();
    this.nameplate.position.set(0, 1.95, 0);
    this.group.add(this.nameplate);
  }

  // ---- BehaviorPuppet 接口（由 RemiBehaviorController 驱动） ----

  setMode(mode: "task" | "attend" | "talk"): void {
    this.mode = mode;
  }

  setDesiredYaw(yaw: number): void {
    this.desiredYaw = yaw;
  }

  setTaskMotion(motion: TaskMotion | null): void {
    this.taskMotion = motion;
    this.nodClock = 0;
  }

  setWalking(walking: boolean): void {
    this.walking = walking;
  }

  getPosition(): { x: number; z: number } {
    return { x: this.group.position.x, z: this.group.position.z };
  }

  setPosition(x: number, z: number): void {
    this.group.position.x = x;
    this.group.position.z = z;
  }

  async load(): Promise<void> {
    this.desiredYaw = this.group.rotation.y;
    try {
      const loader = new GLTFLoader();
      loader.register((parser) => new VRMLoaderPlugin(parser));
      const gltf = await loader.loadAsync(getDefaultVrmUrl());
      const vrm = gltf.userData.vrm as VRM | undefined;
      if (!vrm) throw new Error("no vrm in gltf");
      this.vrm = vrm;
      vrm.scene.rotation.y = getVrmYawRadians();
      vrm.scene.traverse((o) => {
        o.castShadow = true;
        o.frustumCulled = false;
      });
      if (vrm.lookAt) vrm.lookAt.target = this.lookTarget;
      this.group.add(vrm.scene);
      const height = new THREE.Box3().setFromObject(vrm.scene).max.y;
      this.nameplate.position.y = height + 0.35;
    } catch {
      // VRM 资源不存在（public/vrm 下的 .vrm 不进 git）→ 体素小人兜底
      const { root, head, mouth } = buildVoxelRemi();
      this.voxelHead = head;
      this.voxelMouth = mouth;
      this.bodyRoot = root;
      this.group.add(root);
      this.nameplate.position.y = 1.95;
    }
  }

  setHappy(): void {
    this.happyUntil = this.time + 1.6;
  }

  /** 由对话情绪信号驱动的表情（RW-P1-3）。映射到 VRM 标准表情预设。 */
  setEmotion(emotion: string): void {
    this.emotion = String(emotion || "neutral").toLowerCase();
    if (this.emotion === "happy" || this.emotion === "joy") this.setHappy();
  }

  /**
   * TTS 口型信号（RW-P1-3b）。envelope=0–1 RMS 音量；
   * viseme 存在时优先按音素张嘴，否则用 envelope 驱动张合。
   */
  setLip(envelope: number, viseme: { name: string; weight: number } | null): void {
    this.lipEnvelope = Math.max(0, Math.min(1, envelope || 0));
    this.lipViseme = viseme ?? null;
  }

  update(dt: number, playerEye: THREE.Vector3): void {
    this.time += dt;
    this.lookTarget.position.copy(this.group.worldToLocal(playerEye.clone()));

    // 朝向：做事时面向任务方向（眼神仍会瞟玩家），attend/talk 时身体转向玩家
    const toPlayer = playerEye.clone().sub(this.group.position);
    const targetYaw =
      this.mode === "task" ? this.desiredYaw : Math.atan2(toPlayer.x, toPlayer.z);
    let dYaw = targetYaw - this.group.rotation.y;
    while (dYaw > Math.PI) dYaw -= Math.PI * 2;
    while (dYaw < -Math.PI) dYaw += Math.PI * 2;
    const turnSpeed = this.mode === "task" ? 3 : 5;
    this.group.rotation.y += dYaw * Math.min(1, dt * turnSpeed);

    // 任务小动作：周期性点头/翻页/弯腰
    let nod = 0;
    if (this.taskMotion && this.taskMotion.nodEvery > 0) {
      this.nodClock += dt;
      const tIn = this.nodClock % this.taskMotion.nodEvery;
      if (tIn < 0.7) nod = Math.sin((tIn / 0.7) * Math.PI) * 0.16;
    }

    // 开心小跳 / 呼吸 / 行走起伏
    const happy = this.time < this.happyUntil;
    const hop = happy
      ? Math.abs(Math.sin((this.happyUntil - this.time) * Math.PI * 2.5)) * 0.12
      : 0;
    const breathe = Math.sin(this.time * 1.7) * 0.012;
    const walkBob = this.walking ? Math.abs(Math.sin(this.time * 7.2)) * 0.05 : 0;
    const sway = this.taskMotion
      ? Math.sin(this.time * this.taskMotion.swayFreq * Math.PI * 2) *
        this.taskMotion.swayAmp
      : this.walking
        ? Math.sin(this.time * 7.2) * 0.025
        : 0;

    const body = this.vrm?.scene ?? this.bodyRoot;
    if (body) {
      body.position.y = this.restY + breathe + hop + walkBob;
      body.rotation.z = sway;
    }

    if (this.vrm) {
      this.updateVrm(dt, happy, nod);
    } else if (this.voxelHead) {
      this.updateVoxelHead(dt, nod);
    }
  }

  /** 体素头：task 模式低头做事 + 瞟玩家，attend/talk 全幅度注视 */
  private updateVoxelHead(dt: number, nod: number): void {
    const head = this.voxelHead!;
    const local = this.lookTarget.position;
    const yawToPlayer = Math.atan2(local.x, local.z);
    let headYaw: number;
    let headPitch: number;
    if (this.mode === "task") {
      headYaw = THREE.MathUtils.clamp(yawToPlayer, -GLANCE_LIMIT, GLANCE_LIMIT);
      headPitch = (this.taskMotion?.headPitch ?? 0) + nod;
    } else {
      headYaw = THREE.MathUtils.clamp(yawToPlayer, -HEAD_YAW_LIMIT, HEAD_YAW_LIMIT);
      headPitch = -THREE.MathUtils.clamp(
        Math.atan2(local.y - 1.3, Math.hypot(local.x, local.z)),
        -HEAD_PITCH_LIMIT,
        HEAD_PITCH_LIMIT,
      );
    }
    head.rotation.y += (headYaw - head.rotation.y) * Math.min(1, dt * 6);
    head.rotation.x += (headPitch - head.rotation.x) * Math.min(1, dt * 6);

    // 口型（RW-P1-3b）：嘴按张合量纵向拉伸（oh 时更圆 → 略加宽）
    if (this.voxelMouth) {
      const lip = this.lipTargets();
      const open = Math.max(lip.aa, lip.oh);
      const lk = Math.min(1, dt * 18);
      this.lipAa += (open - this.lipAa) * lk;
      this.voxelMouth.scale.y = 1 + this.lipAa * 5.5;
      this.voxelMouth.scale.x = 1 + lip.oh * 0.6;
    }
  }

  /** 口型目标权重：viseme 优先（aa/ih/ee→Aa，oh/oo→Oh），否则用 envelope 驱动 Aa */
  private lipTargets(): { aa: number; oh: number } {
    const v = this.lipViseme;
    if (v && v.name !== "sil") {
      const w = Math.max(0, Math.min(1, v.weight));
      if (v.name === "oh" || v.name === "oo") return { aa: 0, oh: w };
      if (v.name === "aa" || v.name === "ih" || v.name === "ee")
        return { aa: w, oh: 0 };
      return { aa: w * 0.52, oh: 0 }; // 辅音等：小幅张合
    }
    // 无 viseme：音量包络驱动张嘴（略带非线性，安静时基本闭合）
    const e = this.lipEnvelope;
    return { aa: e > 0.06 ? Math.min(1, e * 1.3) : 0, oh: 0 };
  }

  private updateVrm(dt: number, happy: boolean, nod: number): void {
    const vrm = this.vrm!;
    const humanoid = vrm.humanoid;

    // 手臂自然下垂（VRM 默认 T-pose）
    const lUpper = humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftUpperArm);
    const rUpper = humanoid.getNormalizedBoneNode(VRMHumanBoneName.RightUpperArm);
    if (lUpper) lUpper.rotation.z = 1.15;
    if (rUpper) rUpper.rotation.z = -1.15;

    // 头部：task 模式低头做事 + 小幅瞟玩家；attend/talk 朝向玩家（眼神由 vrm.lookAt 处理）
    const head = humanoid.getNormalizedBoneNode(VRMHumanBoneName.Head);
    if (head) {
      const local = this.lookTarget.position;
      const yawToPlayer = Math.atan2(local.x, local.z);
      const headYaw =
        this.mode === "task"
          ? THREE.MathUtils.clamp(yawToPlayer * 0.5, -GLANCE_LIMIT, GLANCE_LIMIT)
          : THREE.MathUtils.clamp(yawToPlayer * 0.65, -HEAD_YAW_LIMIT, HEAD_YAW_LIMIT);
      const headPitch =
        this.mode === "task" ? (this.taskMotion?.headPitch ?? 0) + nod : 0;
      head.rotation.y += (headYaw - head.rotation.y) * Math.min(1, dt * 5);
      head.rotation.x += (headPitch - head.rotation.x) * Math.min(1, dt * 5);
    }

    // 呼吸：脊柱轻微摆动；做事时叠加任务姿态（看书/弯腰打理）
    const spine = humanoid.getNormalizedBoneNode(VRMHumanBoneName.Spine);
    if (spine) {
      const taskLean =
        this.mode === "task" ? (this.taskMotion?.headPitch ?? 0) * 0.35 : 0;
      spine.rotation.x = Math.sin(this.time * 1.7) * 0.022 + taskLean + nod * 0.3;
    }

    // 眨眼 + 表情
    const em = vrm.expressionManager;
    if (em) {
      if (this.time > this.blinkAt) {
        this.blinkPhase += dt * 12;
        if (this.blinkPhase >= Math.PI) {
          this.blinkPhase = 0;
          this.blinkAt = this.time + 2.2 + Math.random() * 3.2;
          em.setValue("blink", 0);
        } else {
          em.setValue("blink", Math.sin(this.blinkPhase));
        }
      }
      // 情绪表情：朝目标权重平滑过渡（happy 在 hop 期间额外加强）
      const target = this.emotionTargets(happy);
      const k = Math.min(1, dt * 4);
      this.exprWeights.happy += (target.happy - this.exprWeights.happy) * k;
      this.exprWeights.sad += (target.sad - this.exprWeights.sad) * k;
      this.exprWeights.angry += (target.angry - this.exprWeights.angry) * k;
      this.exprWeights.relaxed += (target.relaxed - this.exprWeights.relaxed) * k;
      this.exprWeights.surprised +=
        (target.surprised - this.exprWeights.surprised) * k;
      em.setValue("happy", this.exprWeights.happy);
      em.setValue("sad", this.exprWeights.sad);
      em.setValue("angry", this.exprWeights.angry);
      em.setValue("relaxed", this.exprWeights.relaxed);
      em.setValue("surprised", this.exprWeights.surprised);

      // 口型（RW-P1-3b）：Aa/Oh 朝目标快速跟随
      const lip = this.lipTargets();
      const lk = Math.min(1, dt * 18);
      this.lipAa += (lip.aa - this.lipAa) * lk;
      this.lipOh += (lip.oh - this.lipOh) * lk;
      em.setValue("aa", this.lipAa);
      em.setValue("oh", this.lipOh);
    }

    vrm.update(dt);
  }

  /** 情绪名 → VRM 标准表情目标权重 */
  private emotionTargets(happy: boolean): typeof this.exprWeights {
    const w = { happy: 0.16, sad: 0, angry: 0, relaxed: 0.12, surprised: 0 };
    switch (this.emotion) {
      case "happy":
      case "joy":
      case "excited":
        w.happy = 0.9;
        break;
      case "sad":
      case "down":
      case "lonely":
        w.sad = 0.8;
        w.happy = 0;
        break;
      case "angry":
      case "annoyed":
        w.angry = 0.7;
        w.happy = 0;
        break;
      case "calm":
      case "relaxed":
      case "gentle":
        w.relaxed = 0.6;
        break;
      case "surprised":
      case "shock":
        w.surprised = 0.8;
        break;
    }
    if (happy) w.happy = Math.max(w.happy, 0.9);
    return w;
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}
