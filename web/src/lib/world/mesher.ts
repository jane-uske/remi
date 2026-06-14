/**
 * 剔除式体素合并网格 + 像素纹理 UV + 逐顶点环境光遮蔽（AO）。
 *
 * AO 用经典 0fps 体素算法：每个面顶点查相邻两侧 + 对角是否被实心方块
 * 占据，角落自动变暗；并按 AO 翻转四边形对角线消除插值各向异性。
 * 小岛尺寸固定且很小，每次世界变化整体重建即可（< 5ms 量级）。
 */
import * as THREE from "three";
import { AIR, BLOCK_DEFS, VoxelGrid, type RenderClass } from "./blocks";
import { tileUvRect } from "./textures";

/** 每个面：4 个角（外侧逆时针）+ 法线 + 明暗系数 */
const FACES: ReadonlyArray<{
  corners: ReadonlyArray<readonly [number, number, number]>;
  normal: readonly [number, number, number];
  shade: number;
}> = [
  {
    // +X
    corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]],
    normal: [1, 0, 0],
    shade: 0.84,
  },
  {
    // -X
    corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
    normal: [-1, 0, 0],
    shade: 0.84,
  },
  {
    // +Y 顶面
    corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
    normal: [0, 1, 0],
    shade: 1.0,
  },
  {
    // -Y 底面
    corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
    normal: [0, -1, 0],
    shade: 0.55,
  },
  {
    // +Z
    corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
    normal: [0, 0, 1],
    shade: 0.74,
  },
  {
    // -Z
    corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
    normal: [0, 0, -1],
    shade: 0.74,
  },
];

/** AO 亮度曲线：0=两侧夹角 → 最暗 */
const AO_CURVE = [0.42, 0.62, 0.82, 1.0] as const;

interface GeoBuckets {
  positions: number[];
  normals: number[];
  colors: number[];
  uvs: number[];
  indices: number[];
}

function emptyBucket(): GeoBuckets {
  return { positions: [], normals: [], colors: [], uvs: [], indices: [] };
}

function bucketToGeometry(b: GeoBuckets): THREE.BufferGeometry | null {
  if (b.indices.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(b.positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(b.normals, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(b.colors, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(b.uvs, 2));
  geo.setIndex(b.indices);
  return geo;
}

/** 透明方块（玻璃/水）彼此相邻时也不画内面；与不透明相邻时由透明侧画 */
function faceVisible(selfClass: RenderClass, neighborId: number): boolean {
  if (neighborId === AIR) return true;
  const n = BLOCK_DEFS.get(neighborId);
  if (!n) return true;
  if (selfClass === "translucent") return n.renderClass !== "translucent";
  return n.renderClass === "translucent";
}

/** 共享材质组（图集纹理只建一次，重建网格时复用） */
export interface WorldMaterials {
  opaque: THREE.MeshLambertMaterial;
  translucent: THREE.MeshLambertMaterial;
  emissive: THREE.MeshBasicMaterial;
  dispose(): void;
}

export function createWorldMaterials(atlas: THREE.Texture): WorldMaterials {
  const opaque = new THREE.MeshLambertMaterial({ map: atlas, vertexColors: true });
  const translucent = new THREE.MeshLambertMaterial({
    map: atlas,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
  });
  const emissive = new THREE.MeshBasicMaterial({ map: atlas, vertexColors: true });
  return {
    opaque,
    translucent,
    emissive,
    dispose() {
      opaque.dispose();
      translucent.dispose();
      emissive.dispose();
    },
  };
}

export interface WorldMeshes {
  opaque: THREE.Mesh | null;
  translucent: THREE.Mesh | null;
  emissive: THREE.Mesh | null;
  group: THREE.Group;
  /** 只释放几何体，材质归 WorldMaterials 管 */
  dispose(): void;
}

/** 面内 UV：u/v ∈ {0,1}，与角点坐标的映射按面方向取 */
function cornerUv(
  normal: readonly [number, number, number],
  c: readonly [number, number, number],
): [number, number] {
  if (normal[0] === 1) return [1 - c[2], c[1]];
  if (normal[0] === -1) return [c[2], c[1]];
  if (normal[2] === 1) return [c[0], c[1]];
  if (normal[2] === -1) return [1 - c[0], c[1]];
  if (normal[1] === 1) return [c[0], c[2]];
  return [c[0], 1 - c[2]];
}

export function buildWorldMeshes(
  grid: VoxelGrid,
  materials: WorldMaterials,
): WorldMeshes {
  const buckets: Record<RenderClass, GeoBuckets> = {
    opaque: emptyBucket(),
    translucent: emptyBucket(),
    emissive: emptyBucket(),
  };

  /** AO 遮挡判定：只有不透明实体压暗角落 */
  const occludes = (x: number, y: number, z: number): boolean => {
    const id = grid.get(x, y, z);
    if (id === AIR) return false;
    return BLOCK_DEFS.get(id)?.renderClass === "opaque";
  };

  for (let y = 0; y < grid.sy; y++) {
    for (let z = 0; z < grid.sz; z++) {
      for (let x = 0; x < grid.sx; x++) {
        const id = grid.get(x, y, z);
        if (id === AIR) continue;
        const blockDef = BLOCK_DEFS.get(id);
        if (!blockDef) continue;
        const bucket = buckets[blockDef.renderClass];

        for (const face of FACES) {
          const [nx, ny, nz] = face.normal;
          const nId = grid.get(x + nx, y + ny, z + nz);
          if (!faceVisible(blockDef.renderClass, nId)) continue;

          // 瓦片选择：顶/侧/底
          const tile =
            ny === 1 ? blockDef.tiles[0] : ny === -1 ? blockDef.tiles[2] : blockDef.tiles[1];
          const rect = tileUvRect(tile);

          // 法线垂直的两条切向轴（AO 用）
          const tangents: Array<0 | 1 | 2> = [];
          if (nx === 0) tangents.push(0);
          if (ny === 0) tangents.push(1);
          if (nz === 0) tangents.push(2);
          const [ta, tb] = tangents;

          const isEmissive = blockDef.renderClass === "emissive";
          const boost = blockDef.emissiveBoost ?? [1, 1, 1];
          const base = bucket.positions.length / 3;
          const aos: number[] = [];

          for (const c of face.corners) {
            bucket.positions.push(x + c[0], y + c[1], z + c[2]);
            bucket.normals.push(nx, ny, nz);
            const [u, v] = cornerUv(face.normal, c);
            bucket.uvs.push(
              rect.u0 + u * (rect.u1 - rect.u0),
              rect.v0 + v * (rect.v1 - rect.v0),
            );

            if (isEmissive) {
              aos.push(3);
              bucket.colors.push(boost[0], boost[1], boost[2]);
              continue;
            }

            // AO：面外一层的两侧 + 对角
            const cell = [x + nx, y + ny, z + nz];
            const off = (axis: 0 | 1 | 2) => (c[axis] === 1 ? 1 : -1);
            const sideA = [...cell] as [number, number, number];
            sideA[ta] += off(ta);
            const sideB = [...cell] as [number, number, number];
            sideB[tb] += off(tb);
            const corner = [...sideA] as [number, number, number];
            corner[tb] += off(tb);
            const oa = occludes(...sideA) ? 1 : 0;
            const ob = occludes(...sideB) ? 1 : 0;
            const oc = occludes(...corner) ? 1 : 0;
            const ao = oa && ob ? 0 : 3 - (oa + ob + oc);
            aos.push(ao);

            const l = face.shade * AO_CURVE[ao];
            bucket.colors.push(l, l, l);
          }

          // 按 AO 翻转对角线，避免暗角插值出现"X"形伪影
          if (aos[0] + aos[2] > aos[1] + aos[3]) {
            bucket.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
          } else {
            bucket.indices.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
          }
        }
      }
    }
  }

  const opaqueGeo = bucketToGeometry(buckets.opaque);
  const translucentGeo = bucketToGeometry(buckets.translucent);
  const emissiveGeo = bucketToGeometry(buckets.emissive);

  const opaque = opaqueGeo ? new THREE.Mesh(opaqueGeo, materials.opaque) : null;
  const translucent = translucentGeo
    ? new THREE.Mesh(translucentGeo, materials.translucent)
    : null;
  const emissive = emissiveGeo ? new THREE.Mesh(emissiveGeo, materials.emissive) : null;

  const group = new THREE.Group();
  for (const m of [opaque, translucent, emissive]) {
    if (!m) continue;
    group.add(m);
  }

  return {
    opaque,
    translucent,
    emissive,
    group,
    dispose() {
      for (const m of [opaque, translucent, emissive]) {
        if (!m) continue;
        m.geometry.dispose();
      }
    },
  };
}
