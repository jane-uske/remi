import type { Memory } from "../memory/memory_store";

/**
 * 预热召回缓存（VOICE_BEST_PRACTICES 杠杆1）。
 *
 * 背景：partial transcript 预测（prediction.ts）已经在用户还在说话时跑了一次
 * `retrievePromptMemory`。当预测**命中**（final 以 partial 为前缀）时，
 * context_orchestrator 走 `pregeneratedReply` 分支、整轮跳过召回；但当预测
 * **未命中**时，那次召回结果被直接丢弃，真实轮又在 `stt_final → llm_first`
 * 关键路径上重算一遍召回，构成 `pre_llm_overhead` 的主要来源之一。
 *
 * 这个缓存把"召回预热"与"整条回复预生成"解耦：即使回复预测没命中，只要
 * 这一轮用户最终说的话和预热时的 partial 主题足够接近（字符 bigram 重叠），
 * 就复用预热好的记忆，把召回从关键路径上拿掉。
 *
 * 设计约束（守则7）：
 * - final transcript 仍是回复的唯一真值——这里只复用**记忆**这种软信号，不复用回复、不复用分析。
 * - 一次性消费（take 后清空），避免跨轮复用陈旧召回。
 * - 主题漂移（重叠率低）或过期（TTL）时返回 null，调用方回落到实时召回。
 */
export interface WarmRecallTakeOptions {
  /** 超过这个毫秒数则视为过期。 */
  ttlMs: number;
  /** 预热 partial 的 bigram 有多少比例出现在本轮 userMessage 中，低于此值视为主题漂移。0..1。 */
  minOverlap: number;
  /** 注入当前时间，便于测试。 */
  now?: number;
}

type WarmRecallEntry = {
  partial: string;
  partialGrams: Set<string>;
  memory: Memory[];
  at: number;
};

/** 预热 partial 至少这么长才入缓存（与 prediction 的 partial>3 对齐，避免极短串误命中）。 */
const MIN_PARTIAL_CHARS = 4;

export class WarmRecallCache {
  private entry: WarmRecallEntry | null = null;

  /** 预热时调用：存下这次 partial 文本对应的召回结果。 */
  store(partialText: string, memory: Memory[], now: number = Date.now()): void {
    const text = (partialText ?? "").trim();
    if (text.length < MIN_PARTIAL_CHARS) return;
    if (!Array.isArray(memory) || memory.length === 0) return;
    this.entry = {
      partial: text,
      partialGrams: charBigrams(text),
      memory: [...memory],
      at: now,
    };
  }

  /**
   * 真实轮召回前调用：若缓存新鲜且主题接近，返回预热好的记忆，否则 null。
   * 无论命中与否都清空（一次性），下一段 partial 会重新预热。
   */
  take(userMessage: string, opts: WarmRecallTakeOptions): Memory[] | null {
    const entry = this.entry;
    this.entry = null;
    if (!entry) return null;
    const now = opts.now ?? Date.now();
    if (now - entry.at > opts.ttlMs) return null;
    const overlap = overlapRatio(entry.partialGrams, charBigrams(userMessage));
    if (overlap < opts.minOverlap) return null;
    return entry.memory;
  }

  /** 是否有预热条目（不消费）。 */
  has(): boolean {
    return this.entry !== null;
  }

  clear(): void {
    this.entry = null;
  }
}

/** 字符级 bigram 集合——对中文鲁棒、与语言无关。 */
function charBigrams(text: string): Set<string> {
  const t = (text ?? "").replace(/\s+/g, "");
  const out = new Set<string>();
  if (t.length === 0) return out;
  if (t.length === 1) {
    out.add(t);
    return out;
  }
  for (let i = 0; i < t.length - 1; i += 1) {
    out.add(t.slice(i, i + 2));
  }
  return out;
}

/** `a` 中有多少比例的 bigram 也出现在 `b` 中。 */
function overlapRatio(a: Set<string>, b: Set<string>): number {
  if (a.size === 0) return 0;
  let hit = 0;
  for (const gram of a) {
    if (b.has(gram)) hit += 1;
  }
  return hit / a.size;
}
