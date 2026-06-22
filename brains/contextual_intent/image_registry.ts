// ── CIO-P2: 会话级有序多图注册表 + 指代消解 ─────────────────────────
// 把单张 lastBySession 升级为有序多图栈。
// 仍是 shadow 模式——registry 被填充，指代消解结果只进日志。

import type { ImageRegistryEntry } from "./types";

const MAX_ENTRIES = 20;
const registries = new Map<string, ImageRegistryEntry[]>();

/** 获取或创建某连接的图片注册表 */
export function getOrCreateRegistry(connId: string): ImageRegistryEntry[] {
  let reg = registries.get(connId);
  if (!reg) {
    reg = [];
    registries.set(connId, reg);
  }
  return reg;
}

/** 注册一张图片到会话栈（FIFO，超过 MAX_ENTRIES 淘汰最旧的） */
export function registerImage(
  connId: string,
  entry: ImageRegistryEntry,
): void {
  const reg = getOrCreateRegistry(connId);
  reg.push(entry);
  if (reg.length > MAX_ENTRIES) reg.shift();
}

/** 获取某连接的全部注册图片（空数组 = 无图） */
export function getRegistry(connId: string): ImageRegistryEntry[] {
  return registries.get(connId) ?? [];
}

/** 清除某连接的注册表（连接断开时调用） */
export function clearRegistry(connId: string): void {
  registries.delete(connId);
}

// ── 指代消解（纯函数，可单测）───────────────────────────────────────

/** Rule 1: 「上一张 / 刚才那张 / 这张 / 最近那张」 → 最近一条 */
// 注意：不含「这个」——太通用，容易误匹配「这个角色」「这个人」等人物指代
const RECENCY_RE =
  /(上一[张幅个]|刚才?那?[张幅个]?|这[张幅]|最近那?[张幅个]?)/u;
/** Rule 2: 「那张猫 / 那张夕阳」 → descriptor 关键词匹配 */
// 非贪婪匹配到动词/助词/标点前的名词短语
const NAMED_REF_RE = /(?:那[张幅个]|那个?)([一-鿿]{1,4}?)(?:再|又|的|了|吧|呢|啊|[，。！？\s]|$)/u;
/** Rule 3: 「她 / 这个角色 / 按这个 / 像她」 → 最近上传图或含人物的图 */
const PERSON_REF_RE =
  /(她|他|这个角色|按这个|按她|像她|那个角色|这个人)/u;

export interface ImageReference {
  raw: string;
  resolvedImageId: string | null;
  confidence: number;
}

/**
 * 从用户消息中解析图片指代，返回指向 registry 中某张图的引用。
 * 解析不出时返回 null（= 本轮没有图片指代）。
 */
export function resolveImageReference(
  msg: string,
  registry: ImageRegistryEntry[],
): ImageReference | null {
  if (registry.length === 0) return null;

  // Rule 1: 最近一张
  const recencyMatch = RECENCY_RE.exec(msg);
  if (recencyMatch) {
    const last = registry[registry.length - 1];
    return { raw: recencyMatch[0], resolvedImageId: last.id, confidence: 0.9 };
  }

  // Rule 3: 人物/角色指代（优先于 Rule 2，因为"她"比"那张X"更常见）
  const personMatch = PERSON_REF_RE.exec(msg);
  if (personMatch) {
    // 优先找最近的上传图
    const uploaded = [...registry]
      .reverse()
      .find((e) => e.origin === "uploaded");
    if (uploaded) {
      return {
        raw: personMatch[0],
        resolvedImageId: uploaded.id,
        confidence: 0.8,
      };
    }
    // fallback: 最近一张
    const last = registry[registry.length - 1];
    return {
      raw: personMatch[0],
      resolvedImageId: last.id,
      confidence: 0.5,
    };
  }

  // Rule 2: 关键词匹配（"那张猫" → descriptor 含"猫"的最近一条）
  const namedMatch = NAMED_REF_RE.exec(msg);
  if (namedMatch) {
    const keyword = namedMatch[1];
    const match = [...registry]
      .reverse()
      .find((e) => e.descriptor.includes(keyword));
    if (match) {
      return {
        raw: namedMatch[0],
        resolvedImageId: match.id,
        confidence: 0.7,
      };
    }
    // 关键词没匹配上
    return { raw: namedMatch[0], resolvedImageId: null, confidence: 0 };
  }

  return null;
}
