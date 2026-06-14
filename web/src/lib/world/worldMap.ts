/**
 * RemiWorld v0.1 地图：黄昏浮空小岛。
 *
 * 区域（对应 v0.1 goal 的实体分区）：
 *  1. Remi 的房间/工作室 —— 出生点，床、电脑、日记本、书架、地毯
 *  2. 阳台 —— 西侧朝日落海面，栏杆与开口
 *  3. 庭院/小岛入口 —— 石板路、门前灯笼、长椅、邮箱、花圃、树
 *  4. 记忆墙 —— 房间北墙的实体相框区，点击由 Remi 讲述
 *  （第 5 区预留：见 REGION_5_PLACEHOLDER）
 */
import { AIR, Blocks, VoxelGrid } from "./blocks";

export const WORLD_SX = 56;
export const WORLD_SY = 24;
export const WORLD_SZ = 56;

/** 海平面（引擎里画一张大水面，不占体素） */
export const WATER_Y = 2.55;

/** 岛面行走层：草方块顶在 y=4 */
const GROUND_TOP = 3;
export const WALK_Y = GROUND_TOP + 1;

const CX = 28;
const CZ = 28;

/** 第 5 区域在 goal 消息里被截断了，先占位：布局在岛南侧留出扩展空间 */
export const REGION_5_PLACEHOLDER = { x: CX, z: 40 };

export interface StaticInteractable {
  id: string;
  label: string;
  /** 世界坐标 AABB [minX,minY,minZ,maxX,maxY,maxZ] */
  box: [number, number, number, number, number, number];
}

export interface FlowerDeco {
  x: number;
  y: number;
  z: number;
  color: number;
}

export interface WorldMap {
  grid: VoxelGrid;
  spawn: { x: number; y: number; z: number; yaw: number };
  remiSpawn: { x: number; y: number; z: number; yaw: number };
  interactables: StaticInteractable[];
  /** 门前任务灯笼的方块坐标 */
  lanternBlock: [number, number, number];
  /** 花圃里种花后出现花朵的位置 */
  flowerPlantSpots: FlowerDeco[];
  /** 开局就散落在草地上的装饰花 */
  decoFlowers: FlowerDeco[];
  /** 室内暖光点位（引擎挂 PointLight） */
  interiorLights: Array<[number, number, number]>;
  memoryCardIds: string[];
}

/** 确定性伪随机，保证两次进入世界长得一样 */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function islandRadius(theta: number): number {
  return 14 + 2.2 * Math.sin(theta * 3 + 1.7) + 1.4 * Math.sin(theta * 7 + 0.4);
}

export function buildWorldMap(): WorldMap {
  const g = new VoxelGrid(WORLD_SX, WORLD_SY, WORLD_SZ);
  const rng = makeRng(20260612);

  // ---- 小岛地形 ----
  for (let z = 0; z < WORLD_SZ; z++) {
    for (let x = 0; x < WORLD_SX; x++) {
      const dx = x + 0.5 - CX;
      const dz = z + 0.5 - CZ;
      const dist = Math.hypot(dx, dz);
      const r = islandRadius(Math.atan2(dz, dx));
      if (dist > r) continue;
      g.set(x, 0, z, Blocks.stone.id);
      g.set(x, 1, z, Blocks.stone.id);
      g.set(x, 2, z, Blocks.dirt.id);
      if (dist > r - 1.6) {
        g.set(x, GROUND_TOP, z, Blocks.sand.id);
      } else {
        g.set(
          x,
          GROUND_TOP,
          z,
          rng() < 0.18 ? Blocks.grassWarm.id : Blocks.grass.id,
        );
      }
    }
  }

  // ---- 1. 房间/工作室 ----
  const hx0 = 19;
  const hx1 = 29;
  const hz0 = 13;
  const hz1 = 21;
  const wallY0 = WALK_Y; // 4
  const wallY1 = WALK_Y + 3; // 7

  // 木板地板 + 中央地毯
  g.fill(hx0, GROUND_TOP, hz0, hx1, GROUND_TOP, hz1, Blocks.plank.id);
  g.fill(22, GROUND_TOP, 16, 26, GROUND_TOP, 18, Blocks.rug.id);

  // 四面墙（plaster），原木角柱，顶圈深木线脚
  for (const [x0, y0, z0, x1, y1, z1] of [
    [hx0, wallY0, hz0, hx1, wallY1, hz0],
    [hx0, wallY0, hz1, hx1, wallY1, hz1],
    [hx0, wallY0, hz0, hx0, wallY1, hz1],
    [hx1, wallY0, hz0, hx1, wallY1, hz1],
  ] as const) {
    g.fill(x0, y0, z0, x1, y1, z1, Blocks.plaster.id);
  }
  for (const [cx, cz] of [
    [hx0, hz0],
    [hx0, hz1],
    [hx1, hz0],
    [hx1, hz1],
  ] as const) {
    g.fill(cx, wallY0, cz, cx, wallY1, cz, Blocks.log.id);
  }
  g.fill(hx0, wallY1, hz0, hx1, wallY1, hz0, Blocks.plankDark.id);
  g.fill(hx0, wallY1, hz1, hx1, wallY1, hz1, Blocks.plankDark.id);
  g.fill(hx0, wallY1, hz0, hx0, wallY1, hz1, Blocks.plankDark.id);
  g.fill(hx1, wallY1, hz0, hx1, wallY1, hz1, Blocks.plankDark.id);

  // 南门（朝庭院）
  g.fill(24, WALK_Y, hz1, 24, WALK_Y + 1, hz1, AIR);
  // 南墙窗
  g.fill(21, WALK_Y + 1, hz1, 22, WALK_Y + 1, hz1, Blocks.glass.id);
  g.fill(27, WALK_Y + 1, hz1, 28, WALK_Y + 1, hz1, Blocks.glass.id);
  // 东墙窗
  g.fill(hx1, WALK_Y + 1, 16, hx1, WALK_Y + 1, 18, Blocks.glass.id);
  // 西墙：阳台门 + 小窗
  g.fill(hx0, WALK_Y, 16, hx0, WALK_Y + 1, 17, AIR);
  g.set(hx0, WALK_Y + 1, 14, Blocks.glass.id);

  // 平顶天花板 + 人字屋顶
  g.fill(hx0, wallY1 + 1, hz0, hx1, wallY1 + 1, hz1, Blocks.plankDark.id);
  const roofY0 = wallY1 + 1; // 8
  for (let z = hz0 - 1; z <= hz1 + 1; z++) {
    const d = Math.min(z - (hz0 - 1), hz1 + 1 - z);
    const y = roofY0 + Math.floor(d / 2) + (d === 0 ? 0 : 1);
    const block = d === 0 ? Blocks.roofEdge.id : Blocks.roof.id;
    g.fill(hx0 - 1, y, z, hx1 + 1, y, z, block);
    // 山墙封板
    if (z >= hz0 && z <= hz1) {
      for (let gy = roofY0 + 1; gy < y; gy++) {
        g.set(hx0, gy, z, Blocks.plaster.id);
        g.set(hx1, gy, z, Blocks.plaster.id);
      }
    }
  }
  // 烟囱
  g.fill(27, roofY0 + 3, 15, 27, roofY0 + 5, 15, Blocks.stone.id);

  // 家具：床（出生点旁）
  g.fill(26, WALK_Y, 14, 27, WALK_Y, 14, Blocks.bedBlanket.id);
  g.set(28, WALK_Y, 14, Blocks.bedSheet.id);
  // 床头小桌（日记本）
  g.set(26, WALK_Y, 16, Blocks.plankDark.id);
  // 书桌 + 电脑（东墙下）
  g.fill(28, WALK_Y, 17, 28, WALK_Y, 19, Blocks.desk.id);
  g.set(28, WALK_Y + 1, 18, Blocks.screen.id);
  // 书架（西墙下）
  g.fill(20, WALK_Y, 18, 20, WALK_Y + 2, 20, Blocks.bookshelf.id);

  // ---- 4. 记忆墙（北墙内侧 z=14 挂相框，背景换深木板） ----
  g.fill(20, wallY0, hz0, 28, wallY1 - 1, hz0, Blocks.plankDark.id);
  const memoryCardCells: Array<[number, number]> = [
    [21, WALK_Y + 1],
    [22, WALK_Y + 2],
    [23, WALK_Y + 1],
    [25, WALK_Y + 2],
    [26, WALK_Y + 1],
    [27, WALK_Y + 2],
  ];
  const memoryCardIds: string[] = [];
  memoryCardCells.forEach(([x, y], i) => {
    g.set(x, y, hz0 + 1, Blocks.memoryFrame.id);
    memoryCardIds.push(`mem_${i}`);
  });

  // ---- 2. 阳台（西侧朝海） ----
  const bx0 = 14;
  const bx1 = hx0 - 1; // 18
  const bz0 = 14;
  const bz1 = 19;
  g.fill(bx0, GROUND_TOP, bz0, bx1, GROUND_TOP, bz1, Blocks.plank.id);
  // 栏杆：西缘 + 南北缘
  g.fill(bx0, WALK_Y, bz0, bx0, WALK_Y, bz1, Blocks.fence.id);
  g.fill(bx0, WALK_Y, bz0, bx1, WALK_Y, bz0, Blocks.fence.id);
  g.fill(bx0, WALK_Y, bz1, bx1, WALK_Y, bz1, Blocks.fence.id);
  g.set(bx0, WALK_Y + 1, bz0, Blocks.log.id);
  g.set(bx0, WALK_Y + 1, bz1, Blocks.log.id);

  // ---- 3. 庭院/小岛入口 ----
  // 石板路：门口拓宽，向南延伸
  g.fill(23, GROUND_TOP, 22, 25, GROUND_TOP, 22, Blocks.stonePath.id);
  g.fill(24, GROUND_TOP, 23, 24, GROUND_TOP, 31, Blocks.stonePath.id);
  g.fill(23, GROUND_TOP, 26, 23, GROUND_TOP, 27, Blocks.stonePath.id);
  // 门前任务灯笼（初始熄灭）
  const lanternBlock: [number, number, number] = [26, WALK_Y + 2, 24];
  g.fill(26, WALK_Y, 24, 26, WALK_Y + 1, 24, Blocks.lampPost.id);
  g.set(...lanternBlock, Blocks.lanternOff.id);
  // 长椅（朝西看海）
  g.fill(20, WALK_Y, 27, 22, WALK_Y, 27, Blocks.plank.id);
  g.fill(20, WALK_Y + 1, 28, 22, WALK_Y + 1, 28, Blocks.plankDark.id);
  g.fill(20, WALK_Y, 28, 22, WALK_Y, 28, Blocks.plankDark.id);
  // 邮箱（路尽头）
  g.set(25, WALK_Y, 32, Blocks.log.id);
  g.set(25, WALK_Y + 1, 32, Blocks.mailbox.id);
  // 花圃（任务点）
  g.fill(27, GROUND_TOP, 26, 29, GROUND_TOP, 27, Blocks.flowerSoil.id);

  // 树 ×3
  const trees: Array<[number, number]> = [
    [34, 18],
    [17, 24],
    [33, 33],
  ];
  for (const [tx, tz] of trees) {
    g.fill(tx, WALK_Y, tz, tx, WALK_Y + 2, tz, Blocks.log.id);
    for (let lx = tx - 2; lx <= tx + 2; lx++) {
      for (let lz = tz - 2; lz <= tz + 2; lz++) {
        for (let ly = WALK_Y + 2; ly <= WALK_Y + 3; ly++) {
          const corner =
            Math.abs(lx - tx) === 2 && Math.abs(lz - tz) === 2 && rng() < 0.7;
          if (corner) continue;
          if (g.get(lx, ly, lz) === AIR) {
            g.set(
              lx,
              ly,
              lz,
              rng() < 0.3 ? Blocks.leavesWarm.id : Blocks.leaves.id,
            );
          }
        }
      }
    }
    g.fill(tx - 1, WALK_Y + 4, tz - 1, tx + 1, WALK_Y + 4, tz + 1, Blocks.leaves.id);
    g.set(tx, WALK_Y + 5, tz, Blocks.leavesWarm.id);
  }

  // ---- 装饰花（草地上随机散布，避开建筑和路） ----
  const FLOWER_COLORS = [0xe88ab0, 0xf2d06b, 0xe2e8f0, 0xc98ae8, 0xee9b6a];
  const decoFlowers: FlowerDeco[] = [];
  let attempts = 0;
  while (decoFlowers.length < 26 && attempts < 400) {
    attempts++;
    const x = Math.floor(rng() * WORLD_SX);
    const z = Math.floor(rng() * WORLD_SZ);
    const isGrass =
      g.get(x, GROUND_TOP, z) === Blocks.grass.id ||
      g.get(x, GROUND_TOP, z) === Blocks.grassWarm.id;
    if (!isGrass || g.get(x, WALK_Y, z) !== AIR) continue;
    decoFlowers.push({
      x: x + 0.3 + rng() * 0.4,
      y: WALK_Y,
      z: z + 0.3 + rng() * 0.4,
      color: FLOWER_COLORS[Math.floor(rng() * FLOWER_COLORS.length)],
    });
  }

  // 花圃种花后出现的花（粉色为主，对应故事板第 3 格）
  const flowerPlantSpots: FlowerDeco[] = [
    { x: 27.5, y: WALK_Y, z: 26.4, color: 0xe88ab0 },
    { x: 28.5, y: WALK_Y, z: 26.7, color: 0xf2a6c4 },
    { x: 29.4, y: WALK_Y, z: 26.3, color: 0xe88ab0 },
    { x: 28.0, y: WALK_Y, z: 27.5, color: 0xefc1d4 },
    { x: 29.0, y: WALK_Y, z: 27.4, color: 0xe88ab0 },
  ];

  const interactables: StaticInteractable[] = [
    { id: "bed", label: "床", box: [26, WALK_Y, 14, 29, WALK_Y + 1, 15] },
    {
      id: "desk_pc",
      label: "本地电脑",
      box: [28, WALK_Y, 17, 29, WALK_Y + 2, 20],
    },
    {
      id: "diary",
      label: "日记本",
      box: [26, WALK_Y, 16, 27, WALK_Y + 1, 17],
    },
    {
      id: "bookshelf",
      label: "书架",
      box: [20, WALK_Y, 18, 21, WALK_Y + 3, 21],
    },
    {
      id: "balcony_rail",
      label: "阳台",
      box: [bx0, WALK_Y, bz0, bx0 + 1, WALK_Y + 2, bz1 + 1],
    },
    {
      id: "lantern",
      label: "灯笼",
      box: [26, WALK_Y, 24, 27, WALK_Y + 3, 25],
    },
    {
      id: "bench",
      label: "长椅",
      box: [20, WALK_Y, 27, 23, WALK_Y + 2, 29],
    },
    {
      id: "mailbox",
      label: "邮箱",
      box: [25, WALK_Y, 32, 26, WALK_Y + 2, 33],
    },
    {
      id: "flowerbed",
      label: "花圃",
      box: [27, GROUND_TOP, 26, 30, WALK_Y + 1, 28],
    },
    ...memoryCardCells.map(([x, y], i) => ({
      id: `mem_${i}`,
      label: "记忆",
      box: [x, y, hz0 + 1, x + 1, y + 1, hz0 + 2] as [
        number,
        number,
        number,
        number,
        number,
        number,
      ],
    })),
  ];

  return {
    grid: g,
    spawn: { x: 24.5, y: WALK_Y, z: 16.5, yaw: 2.0 },
    remiSpawn: { x: 22.5, y: WALK_Y, z: 17.5, yaw: -Math.PI / 2 },
    interactables,
    lanternBlock,
    flowerPlantSpots,
    decoFlowers,
    interiorLights: [
      [24, WALK_Y + 2.6, 17],
      [27.5, WALK_Y + 1.4, 18],
    ],
    memoryCardIds,
  };
}
