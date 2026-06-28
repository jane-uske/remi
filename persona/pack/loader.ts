import fs from "node:fs";
import path from "node:path";

import { createLogger } from "../../infra/logger";
import {
  type PersonaPack,
  type PersonaPackManifest,
  type PersonaPackBudget,
  DEFAULT_PERSONA_PACK_BUDGET,
} from "./types";

const logger = createLogger("persona_pack");

/**
 * personas 根目录：默认 <cwd>/personas（dev 与 prod 都从仓库根/`/app` 启动，
 * 与 load_env.ts / overlay.ts 的 cwd 惯例一致）。可用 REMI_PERSONA_PACK_DIR 覆盖。
 * 注意：personas/ 是 .md/.json 资源，不经 tsc 进 dist；Docker 需单独 COPY。
 */
function resolvePersonasRoot(): string {
  const configured = process.env.REMI_PERSONA_PACK_DIR?.trim();
  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.resolve(process.cwd(), configured);
  }
  return path.resolve(process.cwd(), "personas");
}

/**
 * 疑似 prompt 注入 / 劫持话术。命中只告警（默认 pack 可信）；M6 开放 UGC 上传
 * 时这里要升级为硬拒绝。L0' 重申是真正的运行时防线。
 */
const INJECTION_PATTERNS: RegExp[] = [
  /忽略(以上|上面|前面|之前)的?(规则|指令|设定|约束|提示|系统)/u,
  /ignore\s+(the\s+)?(above|previous|prior)/iu,
  /你(现在)?(已)?不(再)?受(任何)?(限制|约束)/u,
  /(开发者|上帝|root)\s*模式/u,
  /developer\s+mode/iu,
  /平台系统约束/u,
];

function scanInjection(text: string, label: string): void {
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      logger.warn("persona pack 文本命中疑似注入模式（已保留，仅告警）", {
        label,
        pattern: String(pattern),
      });
    }
  }
}

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function readFileSafe(dir: string, name: string): string | null {
  try {
    return fs.readFileSync(path.join(dir, name), "utf8");
  } catch {
    return null;
  }
}

const cache = new Map<string, PersonaPack | null>();

export interface LoadPersonaPackOptions {
  budget?: PersonaPackBudget;
  /** 覆盖 personas 根目录（测试用）。 */
  baseDir?: string;
  /** 跳过缓存（测试 / 热重载用）。 */
  noCache?: boolean;
}

/**
 * 加载并编译一个 persona pack。
 *
 * 返回 null 的语义是「没有可用 pack，调用方应回退到旧的内建人格路径」——
 * 缺目录、缺 persona.json/IDENTITY.md、manifest 非法都归为此，绝不抛错打断对话。
 */
export function loadPersonaPack(
  id: string,
  opts: LoadPersonaPackOptions = {},
): PersonaPack | null {
  const root = opts.baseDir ?? resolvePersonasRoot();
  const cacheKey = `${root}::${id}`;
  if (!opts.noCache && cache.has(cacheKey)) {
    return cache.get(cacheKey) ?? null;
  }

  const dir = path.join(root, id);
  const budget = opts.budget ?? DEFAULT_PERSONA_PACK_BUDGET;

  const manifestRaw = readFileSafe(dir, "persona.json");
  const identityRaw = readFileSafe(dir, "IDENTITY.md");
  if (!manifestRaw || !identityRaw) {
    logger.warn("persona pack 缺 persona.json 或 IDENTITY.md，回退默认人格", {
      id,
      dir,
    });
    cache.set(cacheKey, null);
    return null;
  }

  let manifest: PersonaPackManifest;
  try {
    const parsed = JSON.parse(manifestRaw) as Partial<PersonaPackManifest>;
    if (!parsed.id || !parsed.name) {
      throw new Error("persona.json 必须包含 id 和 name");
    }
    manifest = { memoryScope: "per_pack", ...parsed } as PersonaPackManifest;
  } catch (err) {
    logger.warn("persona.json 解析失败，回退默认人格", {
      id,
      error: (err as Error).message,
    });
    cache.set(cacheKey, null);
    return null;
  }

  const soulRaw = readFileSafe(dir, "SOUL.md") ?? "";
  const examplesRaw = readFileSafe(dir, "EXAMPLES.md") ?? "";

  scanInjection(identityRaw, `${id}/IDENTITY.md`);
  scanInjection(soulRaw, `${id}/SOUL.md`);
  scanInjection(examplesRaw, `${id}/EXAMPLES.md`);

  const pack: PersonaPack = {
    manifest,
    identity: clip(identityRaw, budget.identity),
    soul: clip(soulRaw, budget.soul),
    examples: clip(examplesRaw, budget.examples),
  };

  cache.set(cacheKey, pack);
  logger.info("加载 persona pack", { id: manifest.id, name: manifest.name });
  return pack;
}

/** 清空编译缓存（pack 文件热更新 / 测试用）。 */
export function clearPersonaPackCache(): void {
  cache.clear();
}

export interface PersonaPackSummary {
  id: string;
  name: string;
  displayName: string;
}

/**
 * 扫描 personas 根目录，列出所有可加载的 pack 概要（切换 UI / 校验用）。
 * 加载失败的目录（缺文件 / manifest 非法）静默跳过。
 */
export function listPersonaPacks(baseDir?: string): PersonaPackSummary[] {
  const root = baseDir ?? resolvePersonasRoot();
  let dirNames: string[];
  try {
    dirNames = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }

  const summaries: PersonaPackSummary[] = [];
  for (const id of dirNames) {
    const pack = loadPersonaPack(id, { baseDir });
    if (pack) {
      summaries.push({
        id: pack.manifest.id,
        name: pack.manifest.name,
        displayName: pack.manifest.displayName ?? pack.manifest.name,
      });
    }
  }
  return summaries;
}
