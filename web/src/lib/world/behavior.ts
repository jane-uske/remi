/**
 * RW-P1-1/2/5 — Remi 的日常行为调度器、注意力与打断恢复。
 *
 * 设计原则（见 docs/design/REMIWORLD_NORTH_STAR.md 硬约束 3/4）：
 * - 日常行为是本地确定性逻辑：零 token、可预测、可单测
 * - 调度由墙钟驱动：进入页面时她"已经在做某件事"，而不是被页面加载唤醒
 * - 行走是手工路点图上的直线段（不是寻路网格化，Phase 3 才做自由行走）
 *
 * 状态机：doing(行为中) → walking(换地方) → doing…
 *         任意状态 + 玩家靠近 → attending(转向玩家)，远离后回到任务
 *         任意状态 + 对话打开 → talking，对话结束 → 回到之前的行为（打断恢复）
 */

export type BehaviorId = "reading" | "window" | "flowers" | "bench" | "music";

export interface BehaviorSpot {
  id: BehaviorId;
  /** 给 HUD / 对话上下文用的中文描述 */
  label: string;
  /** 站位（行走层 y=4） */
  x: number;
  z: number;
  /** 做事时面向的朝向（actor 约定：朝向 = (sin yaw, 0, cos yaw)） */
  faceYaw: number;
  /** 微动作参数（喂给 actor 的程序化小动画） */
  motion: TaskMotion;
}

export interface TaskMotion {
  /** 头部低头幅度（看书低头、看窗外平视） */
  headPitch: number;
  /** 身体摆动幅度与频率（听音乐摇摆、发呆几乎不动） */
  swayAmp: number;
  swayFreq: number;
  /** 每隔几秒做一次"点头/翻页/弯腰"小动作（0 = 无） */
  nodEvery: number;
}

const WALK_Y = 4;

export const BEHAVIOR_SPOTS: readonly BehaviorSpot[] = [
  {
    id: "reading",
    label: "在书架边看书",
    x: 21.4,
    z: 19.0,
    faceYaw: -Math.PI / 2, // 朝西面向书架
    motion: { headPitch: 0.34, swayAmp: 0.008, swayFreq: 0.9, nodEvery: 6.5 },
  },
  {
    id: "window",
    label: "在窗边看海",
    x: 20.3,
    z: 16.5,
    faceYaw: -Math.PI / 2, // 朝西看向阳台外
    motion: { headPitch: -0.06, swayAmp: 0.006, swayFreq: 0.5, nodEvery: 0 },
  },
  {
    id: "flowers",
    label: "在花圃打理花",
    x: 28.3,
    z: 25.2,
    faceYaw: 0, // 朝南面向花圃
    motion: { headPitch: 0.42, swayAmp: 0.01, swayFreq: 0.7, nodEvery: 4.5 },
  },
  {
    id: "bench",
    label: "在长椅边发呆",
    x: 21.6,
    z: 26.2,
    faceYaw: -Math.PI / 2, // 朝西看夕阳
    motion: { headPitch: 0.05, swayAmp: 0.004, swayFreq: 0.35, nodEvery: 0 },
  },
  {
    id: "music",
    label: "在电脑前听音乐",
    x: 27.0,
    z: 18.3,
    faceYaw: Math.PI / 2, // 朝东面向书桌
    motion: { headPitch: 0.12, swayAmp: 0.02, swayFreq: 2.2, nodEvery: 0 },
  },
];

/** 手工路点图：节点都落在无家具的走道上 */
const NODES: Record<string, [number, number]> = {
  roomA: [22.5, 17.5],
  roomB: [25.5, 18.5],
  doorIn: [24.5, 20.2],
  doorOut: [24.5, 22.6],
  pathMid: [24.5, 26.0],
  reading: [21.4, 19.0],
  window: [20.3, 16.5],
  flowers: [28.3, 25.2],
  bench: [21.6, 26.2],
  music: [27.0, 18.3],
};

const EDGES: ReadonlyArray<[string, string]> = [
  ["window", "roomA"],
  ["reading", "roomA"],
  ["roomA", "roomB"],
  ["roomB", "music"],
  ["roomB", "doorIn"],
  ["doorIn", "doorOut"],
  ["doorOut", "pathMid"],
  ["pathMid", "flowers"],
  ["pathMid", "bench"],
];

const NEIGHBORS: Map<string, string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const [a, b] of EDGES) {
    if (!m.has(a)) m.set(a, []);
    if (!m.has(b)) m.set(b, []);
    m.get(a)!.push(b);
    m.get(b)!.push(a);
  }
  return m;
})();

/** 路点图 BFS：返回 from → to 的节点坐标序列（不含起点） */
export function findRoute(from: BehaviorId, to: BehaviorId): Array<[number, number]> {
  if (from === to) return [];
  const prev = new Map<string, string>();
  const queue: string[] = [from];
  const seen = new Set<string>([from]);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur === to) break;
    for (const n of NEIGHBORS.get(cur) ?? []) {
      if (seen.has(n)) continue;
      seen.add(n);
      prev.set(n, cur);
      queue.push(n);
    }
  }
  if (!prev.has(to)) return []; // 图是连通的，正常不会发生
  const path: string[] = [];
  for (let cur: string = to; cur !== from; cur = prev.get(cur)!) path.push(cur);
  path.reverse();
  return path.map((n) => NODES[n]);
}

/** 确定性 hash → [0,1) */
function hash01(n: number): number {
  let h = (n * 374761393 + 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff;
}

/** 行为窗口：每段 75~135 秒，由墙钟决定。进入页面时她"早就在做了"。 */
const SLOT_BASE_MS = 105_000;

export function scheduledBehaviorAt(epochMs: number): BehaviorId {
  const slot = Math.floor(epochMs / SLOT_BASE_MS);
  // 避免连续两段相同：用 slot 序列去重
  const pick = (s: number) =>
    BEHAVIOR_SPOTS[Math.floor(hash01(s) * BEHAVIOR_SPOTS.length)].id;
  let id = pick(slot);
  if (id === pick(slot - 1)) {
    id = BEHAVIOR_SPOTS[(BEHAVIOR_SPOTS.indexOf(BEHAVIOR_SPOTS.find((b) => b.id === id)!) + 1) % BEHAVIOR_SPOTS.length].id;
  }
  return id;
}

export function spotOf(id: BehaviorId): BehaviorSpot {
  return BEHAVIOR_SPOTS.find((b) => b.id === id)!;
}

// ---------------------------------------------------------------------------

export type BehaviorState = "doing" | "walking" | "attending" | "talking";

/** 控制器对角色的最小依赖面（便于单测 mock，也避免 import 引擎/three） */
export interface BehaviorPuppet {
  /** 当前位置（世界坐标，行走层） */
  getPosition(): { x: number; z: number };
  setPosition(x: number, z: number): void;
  /** 期望身体朝向（弧度，朝向 = (sin yaw, 0, cos yaw)），由 actor 平滑插值 */
  setDesiredYaw(yaw: number): void;
  /** attend/talk 时 actor 自行面向玩家 */
  setMode(mode: "task" | "attend" | "talk"): void;
  setTaskMotion(motion: TaskMotion | null): void;
  setWalking(walking: boolean): void;
}

const WALK_SPEED = 1.45;
const ATTEND_RANGE = 4.2;
const ATTEND_EXIT_RANGE = 5.5;
/** 对话结束后停顿一下再回去做事，不要机械地立刻转身 */
const RESUME_DELAY_S = 1.6;

export interface BehaviorEvents {
  /** 行为切换（含恢复）时通知（HUD / 对话上下文用） */
  onBehaviorChange?(id: BehaviorId, label: string): void;
}

export class RemiBehaviorController {
  private state: BehaviorState = "doing";
  private current: BehaviorId;
  private route: Array<[number, number]> = [];
  private routeTarget: BehaviorId | null = null;
  private resumeAt = 0;
  private pendingResume: BehaviorId | null = null;
  private timeS = 0;
  private forced: BehaviorId | null = null;

  constructor(
    private puppet: BehaviorPuppet,
    private events: BehaviorEvents = {},
    nowMs: number = Date.now(),
  ) {
    // 进入世界：她已经在墙钟安排的行为点上
    this.current = scheduledBehaviorAt(nowMs);
    const spot = spotOf(this.current);
    puppet.setPosition(spot.x, spot.z);
    this.applyDoing(spot);
  }

  /** 调试 / 截图用：钉死某个行为 */
  forceBehavior(id: BehaviorId): void {
    this.forced = id;
    const spot = spotOf(id);
    this.current = id;
    this.route = [];
    this.routeTarget = null;
    this.state = "doing";
    this.puppet.setPosition(spot.x, spot.z);
    this.applyDoing(spot);
  }

  getState(): BehaviorState {
    return this.state;
  }

  /** 给 HUD / 对话上下文："她正在做什么" */
  getActivity(): { id: BehaviorId; label: string; state: BehaviorState } {
    return { id: this.current, label: spotOf(this.current).label, state: this.state };
  }

  /** 对话打开：停下手里的事，面向玩家（RW-P1-5 打断） */
  onDialogueOpen(): void {
    if (this.state === "walking") {
      // 行走中被叫住：记住目的地，回头继续走
      this.pendingResume = this.routeTarget;
    } else {
      this.pendingResume = this.current;
    }
    this.state = "talking";
    this.puppet.setWalking(false);
    this.puppet.setTaskMotion(null);
    this.puppet.setMode("talk");
  }

  /** 对话结束：停顿片刻后回到之前的事（RW-P1-5 恢复） */
  onDialogueClose(): void {
    if (this.state !== "talking") return;
    this.state = "attending";
    this.resumeAt = this.timeS + RESUME_DELAY_S;
  }

  update(dt: number, playerPos: { x: number; z: number }, nowMs: number = Date.now()): void {
    this.timeS += dt;
    const pos = this.puppet.getPosition();
    const playerDist = Math.hypot(playerPos.x - pos.x, playerPos.z - pos.z);

    switch (this.state) {
      case "talking":
        return; // 对话中一切交给 talk 模式（面向玩家）

      case "attending": {
        // 对话刚结束的缓冲，或玩家凑得很近时的注视
        this.puppet.setMode("attend");
        const resumeReady = this.timeS >= this.resumeAt;
        if (resumeReady && playerDist > ATTEND_EXIT_RANGE) {
          this.resume();
        } else if (resumeReady && this.pendingResume !== null) {
          // 玩家还在身边也要回去做事（她有自己的生活），但眼神会继续瞟向玩家
          this.resume();
        }
        return;
      }

      case "walking": {
        this.stepWalk(dt);
        // 走路时玩家靠太近 → 停下来看着你
        if (playerDist < ATTEND_RANGE * 0.6) {
          this.pendingResume = this.routeTarget;
          this.state = "attending";
          this.resumeAt = this.timeS + 0.4;
          this.puppet.setWalking(false);
          this.puppet.setMode("attend");
        }
        return;
      }

      case "doing": {
        // 玩家走近：从手里的事中抬头（RW-P1-2 注意力）
        if (playerDist < ATTEND_RANGE) {
          this.pendingResume = this.current;
          this.state = "attending";
          this.resumeAt = this.timeS + 0.8;
          this.puppet.setTaskMotion(null);
          this.puppet.setMode("attend");
          return;
        }
        // 墙钟说该换地方了（调试钉死时不换）
        if (!this.forced) {
          const next = scheduledBehaviorAt(nowMs);
          if (next !== this.current) this.startWalkTo(next);
        }
        return;
      }
    }
  }

  // ---------- 内部 ----------

  private resume(): void {
    const target = this.pendingResume ?? this.current;
    this.pendingResume = null;
    const spot = spotOf(target);
    const pos = this.puppet.getPosition();
    const atSpot = Math.hypot(spot.x - pos.x, spot.z - pos.z) < 0.4;
    if (atSpot) {
      this.current = target;
      this.applyDoing(spot);
    } else {
      this.startWalkTo(target, true);
    }
  }

  private applyDoing(spot: BehaviorSpot): void {
    this.state = "doing";
    this.puppet.setWalking(false);
    this.puppet.setMode("task");
    this.puppet.setDesiredYaw(spot.faceYaw);
    this.puppet.setTaskMotion(spot.motion);
    this.events.onBehaviorChange?.(spot.id, spot.label);
  }

  private startWalkTo(target: BehaviorId, isResume = false): void {
    const pos = this.puppet.getPosition();
    // 从最近的"当前行为点"算路；恢复行走时人可能停在半路，直接续走剩余路点
    const route = findRoute(this.current, target);
    const points = route.length > 0 ? route : [[spotOf(target).x, spotOf(target).z] as [number, number]];
    // 丢掉已经走过的前缀（离当前位置更近的后续点）
    let startIdx = 0;
    if (isResume) {
      let best = Number.POSITIVE_INFINITY;
      points.forEach(([px, pz], i) => {
        const d = Math.hypot(px - pos.x, pz - pos.z);
        if (d < best) {
          best = d;
          startIdx = i;
        }
      });
    }
    this.route = points.slice(startIdx);
    this.routeTarget = target;
    this.state = "walking";
    this.puppet.setTaskMotion(null);
    this.puppet.setMode("task");
    this.puppet.setWalking(true);
  }

  private stepWalk(dt: number): void {
    const pos = this.puppet.getPosition();
    const next = this.route[0];
    if (!next) {
      // 到站
      const target = this.routeTarget!;
      this.routeTarget = null;
      this.current = target;
      const spot = spotOf(target);
      this.puppet.setPosition(spot.x, spot.z);
      this.applyDoing(spot);
      return;
    }
    const dx = next[0] - pos.x;
    const dz = next[1] - pos.z;
    const dist = Math.hypot(dx, dz);
    const step = WALK_SPEED * dt;
    this.puppet.setDesiredYaw(Math.atan2(dx, dz));
    if (dist <= step) {
      this.puppet.setPosition(next[0], next[1]);
      this.route.shift();
    } else {
      this.puppet.setPosition(pos.x + (dx / dist) * step, pos.z + (dz / dist) * step);
    }
  }
}

export { WALK_Y as BEHAVIOR_WALK_Y };
