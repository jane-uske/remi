// ── M3-P0 时间感（time awareness）──────────────────────────────────
// 纯函数：注入"此刻"与"距上次对话间隔"。这些内容每轮都变（now）或每会话
// 锁定一次（gap），必须放在 prompt 的动态尾部、任何缓存断点之后，绝不进
// 可缓存前缀（见 brain/prompt_cache.ts 与 docs/design/MEMORY_V3_DESIGN.md §13）。

/** 时间上下文块的起始标记；prompt_cache 用它识别动态尾部边界。 */
export const TIME_CONTEXT_MARKER = "【此刻】";

/** 低于该阈值的间隔不值得提（避免"距上次 0 分钟"这类噪声）。 */
const GAP_MIN_MS = 3 * 60 * 60 * 1000; // 3h

/**
 * 把毫秒间隔转成人话描述；过短返回 null（不注入）。
 * 只给粗粒度（小时/天/周/月），让模型自然措辞，而不是逐字播报。
 */
export function describeGap(ms: number): string | null {
  if (!Number.isFinite(ms) || ms < GAP_MIN_MS) return null;
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 24) return `${hours} 小时`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days} 天`;
  const weeks = Math.floor(days / 7);
  if (weeks < 8) return `${weeks} 周`;
  const months = Math.max(1, Math.floor(days / 30));
  return `${months} 个月`;
}

/** 带时区/locale 的"此刻"格式化；时区非法时回退到 zh-CN 默认。 */
export function formatNow(
  now: Date,
  timeZone: string | null,
  locale: string | null,
): string {
  const loc = locale || "zh-CN";
  const opts: Intl.DateTimeFormatOptions = { dateStyle: "full", timeStyle: "short" };
  try {
    return new Intl.DateTimeFormat(
      loc,
      timeZone ? { ...opts, timeZone } : opts,
    ).format(now);
  } catch {
    return new Intl.DateTimeFormat("zh-CN", opts).format(now);
  }
}

/**
 * 组装时间上下文块（一条 system 文本，放在 prompt 动态尾部）。
 * gapDescriptor 由 bootstrap 时算一次并锁定整会话；now 每轮实时。
 */
export function buildTimeContext(input: {
  now: Date;
  timeZone: string | null;
  locale: string | null;
  gapDescriptor: string | null;
}): string {
  const parts = [`现在是 ${formatNow(input.now, input.timeZone, input.locale)}。`];
  if (input.gapDescriptor) {
    parts.push(`距你上次找我已经过去约 ${input.gapDescriptor}。`);
  }
  return `${TIME_CONTEXT_MARKER}${parts.join("")}（真实当下时间，以此为准，自然感知即可，别每句都报时间；和记忆里的旧日期/旧安排冲突时，以这里的当下时间为准，不要用旧记忆去覆盖或推翻它）`;
}
