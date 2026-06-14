/**
 * RemiWorld — 方块调色板与体素网格。
 *
 * 风格基准：温暖黄昏下的 voxel / anime 3D 小岛（见 RemiWorld MVP 故事板）。
 * 外观来自 textures.ts 的像素纹理图集；color 仅作兜底/调试用途。
 */
import { TILE } from "./textures";

export const AIR = 0;

export type RenderClass = "opaque" | "translucent" | "emissive";

export interface BlockDef {
  id: number;
  name: string;
  /** 兜底色（调试用，渲染走纹理图集） */
  color: number;
  renderClass: RenderClass;
  /** 是否参与碰撞 */
  solid: boolean;
  /** 图集瓦片 [顶面, 侧面, 底面] */
  tiles: [number, number, number];
  /** 自发光方块的 HDR 顶点色倍增（>1 触发 bloom） */
  emissiveBoost?: [number, number, number];
}

function def(
  id: number,
  name: string,
  color: number,
  tiles: number | [number, number, number],
  opts: Partial<Pick<BlockDef, "renderClass" | "solid" | "emissiveBoost">> = {},
): BlockDef {
  return {
    id,
    name,
    color,
    tiles: typeof tiles === "number" ? [tiles, tiles, tiles] : tiles,
    renderClass: opts.renderClass ?? "opaque",
    solid: opts.solid ?? true,
    emissiveBoost: opts.emissiveBoost,
  };
}

export const Blocks = {
  grass: def(1, "草地", 0x6f9e4c, [TILE.GRASS_TOP, TILE.GRASS_SIDE, TILE.DIRT]),
  grassWarm: def(2, "草地·暖", 0x86a14e, [TILE.GRASS_TOP, TILE.GRASS_SIDE, TILE.DIRT]),
  dirt: def(3, "泥土", 0x7a5a3e, TILE.DIRT),
  sand: def(4, "沙滩", 0xd9c189, TILE.SAND),
  stone: def(5, "石头", 0x8d8a84, TILE.STONE),
  stonePath: def(6, "石板路", 0xa39c8f, TILE.STONE_PATH),
  plank: def(7, "木板", 0xb08454, TILE.PLANK),
  plankDark: def(8, "深木板", 0x7c5a38, TILE.PLANK_DARK),
  log: def(9, "原木", 0x6b4a2e, [TILE.LOG_TOP, TILE.LOG_SIDE, TILE.LOG_TOP]),
  plaster: def(10, "墙面", 0xe8dcc4, TILE.PLASTER),
  roof: def(11, "屋顶", 0x6e4631, TILE.ROOF),
  roofEdge: def(12, "屋檐", 0x5a3826, TILE.ROOF_EDGE),
  leaves: def(13, "树叶", 0x4f7d3a, TILE.LEAVES),
  leavesWarm: def(14, "树叶·暖", 0x7d8a3c, TILE.LEAVES_WARM),
  bookshelf: def(15, "书架", 0x8a623c, [TILE.PLANK_DARK, TILE.BOOKSHELF, TILE.PLANK_DARK]),
  bedSheet: def(16, "床单", 0xd7e3ea, [TILE.BED_SHEET, TILE.BED_SHEET, TILE.PLANK_DARK]),
  bedBlanket: def(17, "被子", 0x5d7fae, [TILE.BED_BLANKET, TILE.BED_BLANKET, TILE.PLANK_DARK]),
  desk: def(18, "书桌", 0x9a7048, TILE.DESK),
  screen: def(19, "屏幕", 0x9fd8e8, TILE.SCREEN, {
    renderClass: "emissive",
    emissiveBoost: [1.25, 1.5, 1.65],
  }),
  glass: def(20, "玻璃", 0xbfd9e4, TILE.GLASS, {
    renderClass: "translucent",
  }),
  fence: def(21, "栏杆", 0x8a6a44, TILE.FENCE),
  lanternOff: def(22, "灯笼·熄", 0x9a7a56, TILE.LANTERN_OFF),
  lanternLit: def(23, "灯笼·亮", 0xffc46b, TILE.LANTERN_LIT, {
    renderClass: "emissive",
    emissiveBoost: [2.2, 1.9, 1.45],
  }),
  mailbox: def(24, "邮箱", 0xb05548, [TILE.WHITE, TILE.MAILBOX, TILE.PLANK_DARK]),
  flowerSoil: def(25, "花圃土", 0x5e4430, [TILE.FLOWER_SOIL, TILE.DIRT, TILE.DIRT]),
  memoryFrame: def(26, "记忆相框", 0xc9a96a, TILE.MEMORY_FRAME),
  white: def(27, "白饰", 0xf2efe6, TILE.WHITE),
  water: def(28, "海水", 0x4d7a96, TILE.WHITE, {
    renderClass: "translucent",
    solid: false,
  }),
  lampPost: def(29, "灯柱", 0x6e5a42, [TILE.LOG_TOP, TILE.LAMP_POST, TILE.LOG_TOP]),
  rug: def(30, "地毯", 0xb4685f, [TILE.RUG, TILE.RUG, TILE.PLANK]),
} as const;

export type BlockName = keyof typeof Blocks;

export const BLOCK_DEFS: ReadonlyMap<number, BlockDef> = new Map(
  Object.values(Blocks).map((b) => [b.id, b]),
);

/** 固定尺寸体素网格。坐标为非负整数，y 向上。 */
export class VoxelGrid {
  readonly sx: number;
  readonly sy: number;
  readonly sz: number;
  readonly data: Uint8Array;

  constructor(sx: number, sy: number, sz: number) {
    this.sx = sx;
    this.sy = sy;
    this.sz = sz;
    this.data = new Uint8Array(sx * sy * sz);
  }

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.sx && y < this.sy && z < this.sz;
  }

  index(x: number, y: number, z: number): number {
    return (y * this.sz + z) * this.sx + x;
  }

  get(x: number, y: number, z: number): number {
    if (!this.inBounds(x, y, z)) return AIR;
    return this.data[this.index(x, y, z)];
  }

  set(x: number, y: number, z: number, id: number): void {
    if (!this.inBounds(x, y, z)) return;
    this.data[this.index(x, y, z)] = id;
  }

  /** 玩家碰撞用：这一格是否为实心 */
  isSolid(x: number, y: number, z: number): boolean {
    const id = this.get(Math.floor(x), Math.floor(y), Math.floor(z));
    if (id === AIR) return false;
    return BLOCK_DEFS.get(id)?.solid ?? false;
  }

  /** 填充长方体（含两端） */
  fill(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    id: number,
  ): void {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
      for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++)
        for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
          this.set(x, y, z, id);
  }
}
