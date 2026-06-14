/**
 * 程序生成的像素纹理图集（16px 瓦片 × 8×8 格）。
 *
 * 高保真化的第一层：让方块从"色块"变成"材质"。全部确定性生成
 * （同一 seed 永远长一样），不依赖任何美术资产。
 */
import * as THREE from "three";

const TILE_PX = 16;
const TILES_PER_ROW = 8;
const ATLAS_PX = TILE_PX * TILES_PER_ROW;

/** 瓦片索引（行优先） */
export const TILE = {
  GRASS_TOP: 0,
  GRASS_SIDE: 1,
  DIRT: 2,
  SAND: 3,
  STONE: 4,
  STONE_PATH: 5,
  PLANK: 6,
  PLANK_DARK: 7,
  LOG_SIDE: 8,
  LOG_TOP: 9,
  PLASTER: 10,
  ROOF: 11,
  ROOF_EDGE: 12,
  LEAVES: 13,
  LEAVES_WARM: 14,
  BOOKSHELF: 15,
  BED_SHEET: 16,
  BED_BLANKET: 17,
  DESK: 18,
  SCREEN: 19,
  GLASS: 20,
  FENCE: 21,
  LANTERN_OFF: 22,
  LANTERN_LIT: 23,
  MAILBOX: 24,
  FLOWER_SOIL: 25,
  MEMORY_FRAME: 26,
  WHITE: 27,
  LAMP_POST: 28,
  RUG: 29,
  FLOWER_PINK: 30,
  FLOWER_YELLOW: 31,
  FLOWER_WHITE: 32,
  GRASS_TUFT: 33,
} as const;

export type TileId = (typeof TILE)[keyof typeof TILE];

export interface UvRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

/** 瓦片在图集里的 UV 范围（含半像素内缩防渗色） */
export function tileUvRect(tile: number): UvRect {
  const col = tile % TILES_PER_ROW;
  const row = Math.floor(tile / TILES_PER_ROW);
  const inset = 0.5 / ATLAS_PX;
  return {
    u0: col / TILES_PER_ROW + inset,
    u1: (col + 1) / TILES_PER_ROW - inset,
    // canvas 自上而下，纹理 flipY 后 v=1 在画布顶部
    v1: 1 - row / TILES_PER_ROW - inset,
    v0: 1 - (row + 1) / TILES_PER_ROW + inset,
  };
}

type Rgb = [number, number, number];
type Rgba = [number, number, number, number];

function hex(c: number): Rgb {
  return [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];
}

function shade(c: Rgb, f: number): Rgb {
  return [
    Math.max(0, Math.min(255, c[0] * f)),
    Math.max(0, Math.min(255, c[1] * f)),
    Math.max(0, Math.min(255, c[2] * f)),
  ];
}

/** 确定性 hash → [0,1) */
function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 1274126177) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = (h * 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff;
}

type Painter = (px: number, py: number) => Rgba;

function noisy(base: Rgb, amp: number, seed: number): Painter {
  return (px, py) => {
    const f = 1 + (hash(px, py, seed) - 0.5) * amp;
    const [r, g, b] = shade(base, f);
    return [r, g, b, 255];
  };
}

function grassTop(base: Rgb): Painter {
  const n = noisy(base, 0.18, 11);
  return (px, py) => {
    const h = hash(px, py, 12);
    if (h < 0.07) return [...shade(base, 1.28), 255];
    if (h > 0.93) return [...shade(base, 0.74), 255];
    return n(px, py);
  };
}

function grassSide(grass: Rgb, dirt: Rgb): Painter {
  return (px, py) => {
    const fringe = 3 + Math.floor(hash(px, 0, 21) * 3);
    if (py < fringe) {
      const f = 1 + (hash(px, py, 22) - 0.5) * 0.2;
      return [...shade(grass, py === fringe - 1 ? f * 0.8 : f), 255];
    }
    return [...shade(dirt, 1 + (hash(px, py, 23) - 0.5) * 0.22), 255];
  };
}

function planks(base: Rgb, seed: number): Painter {
  return (px, py) => {
    let f = 1 + (hash(px, py, seed) - 0.5) * 0.12;
    if (py % 4 === 3) f *= 0.74; // 板缝
    else if (hash(px, Math.floor(py / 4), seed + 1) < 0.16) f *= 0.86; // 木纹
    return [...shade(base, f), 255];
  };
}

function cobble(base: Rgb, seed: number): Painter {
  return (px, py) => {
    if (px % 4 === 0 || py % 4 === 0) return [...shade(base, 0.68), 255];
    const cell = hash(Math.floor(px / 4), Math.floor(py / 4), seed);
    const f = 0.9 + cell * 0.26 + (hash(px, py, seed + 1) - 0.5) * 0.08;
    return [...shade(base, f), 255];
  };
}

function shingles(base: Rgb): Painter {
  return (px, py) => {
    const row = Math.floor(py / 4);
    const off = row % 2 === 0 ? 0 : 3;
    let f = 0.92 + hash(Math.floor((px + off) / 5), row, 31) * 0.22;
    if (py % 4 === 3) f *= 0.62; // 每排瓦下沿阴影
    else if ((px + off) % 5 === 0) f *= 0.8; // 瓦间竖缝
    return [...shade(base, f), 255];
  };
}

function leaves(base: Rgb, seed: number): Painter {
  return (px, py) => {
    const h = hash(px, py, seed);
    if (h < 0.07) return [...shade(base, 0.5), 255];
    if (h > 0.9) return [...shade(base, 1.32), 255];
    return [...shade(base, 1 + (hash(px, py, seed + 5) - 0.5) * 0.3), 255];
  };
}

function logSide(base: Rgb): Painter {
  return (px, py) => {
    const stripe = 0.84 + hash(Math.floor(px / 2), 0, 41) * 0.32;
    const f = stripe * (1 + (hash(px, py, 42) - 0.5) * 0.14);
    return [...shade(base, f), 255];
  };
}

function logTop(base: Rgb): Painter {
  return (px, py) => {
    const d = Math.max(Math.abs(px - 7.5), Math.abs(py - 7.5));
    const ring = Math.floor(d) % 3 === 1 ? 0.78 : 1.04;
    return [...shade(base, ring * (1 + (hash(px, py, 43) - 0.5) * 0.1)), 255];
  };
}

function bookshelf(wood: Rgb): Painter {
  const SPINES: Rgb[] = [
    hex(0xa8524a),
    hex(0x4a6e8a),
    hex(0x8a8a4a),
    hex(0x6a4a8a),
    hex(0xb08454),
    hex(0x4a8a6e),
  ];
  return (px, py) => {
    const isWood = py <= 1 || py >= 14 || py === 7 || py === 8 || px <= 0 || px >= 15;
    if (isWood) return [...shade(wood, 1 + (hash(px, py, 51) - 0.5) * 0.14), 255];
    const shelf = py < 7 ? 0 : 1;
    const slot = Math.floor((px - 1) / 2);
    if (hash(slot, shelf, 52) < 0.12) return [...shade(wood, 0.5), 255]; // 空格
    const c = SPINES[Math.floor(hash(slot, shelf, 53) * SPINES.length)];
    const f = px % 2 === 0 ? 0.8 : 1.0;
    return [...shade(c, f), 255];
  };
}

function screen(): Painter {
  const bg = hex(0x101c30);
  const cyan = hex(0x7fe8ff);
  return (px, py) => {
    if (px === 0 || px === 15 || py === 0 || py === 15)
      return [...shade(cyan, 0.45), 255];
    if (py >= 3 && py <= 12 && px >= 2 && px <= 13 && hash(px, py, 61) < 0.3) {
      return [...shade(cyan, 0.55 + hash(px, py, 62) * 0.6), 255];
    }
    if (px === 12 && py === 13) return [...cyan, 255]; // 光标
    return [...shade(bg, 1 + (hash(px, py, 63) - 0.5) * 0.2), 255];
  };
}

function glass(): Painter {
  const frame = hex(0x8a6a44);
  const pane = hex(0xcfe6ef);
  return (px, py) => {
    if (px === 0 || px === 15 || py === 0 || py === 15) return [...frame, 255];
    if (px === py || px === py + 1) return [...pane, 120]; // 斜向高光
    return [...pane, 58];
  };
}

function lantern(lit: boolean): Painter {
  const frame = hex(0x3a3028);
  return (px, py) => {
    const edge = px <= 1 || px >= 14 || py <= 1 || py >= 14;
    const bars = px === 8 || py === 8;
    if (edge || bars) return [...shade(frame, 1 + (hash(px, py, 71) - 0.5) * 0.2), 255];
    if (!lit) return [...shade(hex(0x8a6f50), 1 + (hash(px, py, 72) - 0.5) * 0.18), 255];
    const d = Math.hypot(px - 7.5, py - 7.5) / 8;
    const warm = shade(hex(0xfff0c0), 1 - d * 0.45);
    return [warm[0], Math.max(0, warm[1] - d * 60), Math.max(0, warm[2] - d * 130), 255];
  };
}

function soilRows(base: Rgb): Painter {
  return (px, py) => {
    const ridge = py % 4 < 2 ? 0.72 : 1.05;
    return [...shade(base, ridge * (1 + (hash(px, py, 81) - 0.5) * 0.2)), 255];
  };
}

function memoryFrame(): Painter {
  const gold = hex(0xc9a96a);
  return (px, py) => {
    if (px <= 1 || px >= 14 || py <= 1 || py >= 14) {
      const corner = (px <= 1 || px >= 14) && (py <= 1 || py >= 14);
      return [...shade(gold, corner ? 1.3 : 1 + (hash(px, py, 91) - 0.5) * 0.15), 255];
    }
    // 相片：暖色天空 + 地面 + 一颗小太阳
    if (px === 11 && py === 4) return [...hex(0xffe49a), 255];
    if (py < 8) return [...shade(hex(0xe8b88a), 1 + (hash(px, py, 92) - 0.5) * 0.08), 255];
    return [...shade(hex(0x9a7a5a), 1 + (hash(px, py, 93) - 0.5) * 0.1), 255];
  };
}

function rug(base: Rgb): Painter {
  const border = hex(0x8f4f48);
  const accent = hex(0xe0b478);
  return (px, py) => {
    if (px <= 1 || px >= 14 || py <= 1 || py >= 14)
      return [...shade(border, 1 + (hash(px, py, 95) - 0.5) * 0.1), 255];
    const d = Math.abs(px - 7.5) + Math.abs(py - 7.5);
    if (d >= 4 && d < 6) return [...accent, 255];
    return [...shade(base, 1 + (hash(px, py, 96) - 0.5) * 0.12), 255];
  };
}

function quilt(base: Rgb, seed: number): Painter {
  return (px, py) => {
    let f = 1 + (hash(px, py, seed) - 0.5) * 0.08;
    if ((px + py) % 6 === 0) f *= 0.9;
    return [...shade(base, f), 255];
  };
}

function mailbox(base: Rgb): Painter {
  return (px, py) => {
    if (py === 5 && px >= 4 && px <= 11) return [...shade(base, 0.4), 255]; // 投信口
    if (px === 13 && py === 2) return [...hex(0xf2d06b), 255]; // 小旗
    return [...shade(base, 1 + (hash(px, py, 97) - 0.5) * 0.16), 255];
  };
}

function flowerSprite(petal: Rgb): Painter {
  const stem = hex(0x4e7a36);
  const core = hex(0xffe080);
  return (px, py) => {
    // 花茎与叶
    if (px === 8 && py >= 7 && py <= 14) return [...stem, 255];
    if ((px === 6 && py === 11) || (px === 7 && py === 10)) return [...shade(stem, 1.25), 255];
    if ((px === 10 && py === 12) || (px === 9 && py === 11)) return [...shade(stem, 1.25), 255];
    // 花冠（菱形五瓣）
    const dx = Math.abs(px - 8);
    const dy = Math.abs(py - 4);
    if (dx + dy <= 2) {
      if (dx === 0 && dy === 0) return [...core, 255];
      return [...shade(petal, 1 - (dx + dy) * 0.08), 255];
    }
    return [0, 0, 0, 0];
  };
}

function grassTuft(): Painter {
  const blades = [2, 4, 6, 9, 11, 13];
  return (px, py) => {
    for (const bx of blades) {
      if (px !== bx) continue;
      const h = 4 + Math.floor(hash(bx, 0, 98) * 6);
      if (py >= 16 - h) {
        const g = hex(hash(bx, 1, 99) < 0.5 ? 0x5e8a3e : 0x7da14e);
        return [...shade(g, py === 16 - h ? 1.3 : 1), 255];
      }
    }
    return [0, 0, 0, 0];
  };
}

function painterFor(tile: number): Painter {
  switch (tile) {
    case TILE.GRASS_TOP: return grassTop(hex(0x6f9e4c));
    case TILE.GRASS_SIDE: return grassSide(hex(0x6f9e4c), hex(0x7a5a3e));
    case TILE.DIRT: return noisy(hex(0x7a5a3e), 0.22, 1);
    case TILE.SAND: return noisy(hex(0xd9c189), 0.12, 2);
    case TILE.STONE: return cobble(hex(0x8d8a84), 3);
    case TILE.STONE_PATH: return cobble(hex(0xa39c8f), 4);
    case TILE.PLANK: return planks(hex(0xb08454), 5);
    case TILE.PLANK_DARK: return planks(hex(0x7c5a38), 6);
    case TILE.LOG_SIDE: return logSide(hex(0x6b4a2e));
    case TILE.LOG_TOP: return logTop(hex(0x8a6a44));
    case TILE.PLASTER: return noisy(hex(0xe8dcc4), 0.07, 7);
    case TILE.ROOF: return shingles(hex(0x6e4631));
    case TILE.ROOF_EDGE: return shingles(hex(0x5a3826));
    case TILE.LEAVES: return leaves(hex(0x4f7d3a), 8);
    case TILE.LEAVES_WARM: return leaves(hex(0x7d8a3c), 9);
    case TILE.BOOKSHELF: return bookshelf(hex(0x8a623c));
    case TILE.BED_SHEET: return quilt(hex(0xe6edf2), 10);
    case TILE.BED_BLANKET: return quilt(hex(0x5d7fae), 11);
    case TILE.DESK: return planks(hex(0x9a7048), 12);
    case TILE.SCREEN: return screen();
    case TILE.GLASS: return glass();
    case TILE.FENCE: return planks(hex(0x8a6a44), 13);
    case TILE.LANTERN_OFF: return lantern(false);
    case TILE.LANTERN_LIT: return lantern(true);
    case TILE.MAILBOX: return mailbox(hex(0xb05548));
    case TILE.FLOWER_SOIL: return soilRows(hex(0x5e4430));
    case TILE.MEMORY_FRAME: return memoryFrame();
    case TILE.WHITE: return noisy(hex(0xf2efe6), 0.05, 14);
    case TILE.LAMP_POST: return logSide(hex(0x6e5a42));
    case TILE.RUG: return rug(hex(0xb4685f));
    case TILE.FLOWER_PINK: return flowerSprite(hex(0xe88ab0));
    case TILE.FLOWER_YELLOW: return flowerSprite(hex(0xf2d06b));
    case TILE.FLOWER_WHITE: return flowerSprite(hex(0xeef0f4));
    case TILE.GRASS_TUFT: return grassTuft();
    default: return () => [255, 0, 255, 255];
  }
}

/** 生成图集纹理（仅浏览器环境调用） */
export function createAtlasTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_PX;
  canvas.height = ATLAS_PX;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(ATLAS_PX, ATLAS_PX);

  const tiles = Object.values(TILE);
  for (const tile of tiles) {
    const paint = painterFor(tile);
    const ox = (tile % TILES_PER_ROW) * TILE_PX;
    const oy = Math.floor(tile / TILES_PER_ROW) * TILE_PX;
    for (let py = 0; py < TILE_PX; py++) {
      for (let px = 0; px < TILE_PX; px++) {
        const [r, g, b, a] = paint(px, py);
        const i = ((oy + py) * ATLAS_PX + ox + px) * 4;
        img.data[i] = r;
        img.data[i + 1] = g;
        img.data[i + 2] = b;
        img.data[i + 3] = a;
      }
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
