// ── M3-P2 Tier4 bi-temporal 时序事实：召回 + prompt 块格式化 ──────
// 从 context_orchestrator 抽出，避免核心大文件继续膨胀，并让格式化逻辑
// 可单测。设计见 docs/design/MEMORY_V3_DESIGN.md §5–§6 / §9。

import type { RemiSessionContext } from "./remi_session_context";
import type { TemporalFact } from "../storage/repositories/temporal_facts_repository";
import { getConfig } from "../server/config";
import { createLogger } from "../infra/logger";

const logger = createLogger("timeline_facts");

/** Tier4 召回条数上限。 */
const TIMELINE_RECALL_K = 8;

/**
 * 把现行时序事实格式化成 prompt 动态尾部块。纯函数，可单测。
 * 空结果 → undefined（调用方据此让 prompt 退回 Tier0–3）。
 * 标题自带克制指引，呼应 W-PRES-01「别硬拉旧记忆」。
 */
export function formatTimelineFactsBlock(facts: TemporalFact[]): string | undefined {
  if (!facts.length) return undefined;
  const lines = facts.map((f) => `- ${f.subject} ${f.predicate} ${f.object}`);
  return `【你记得的近况（仅作背景，自然相关时才提，别硬拉）】\n${lines.join("\n")}`;
}

/**
 * Tier4 bi-temporal 时序事实召回 → prompt 动态尾部块。
 * 热路径唯一动态项，硬超时（REMI_TEMPORAL_RECALL_TIMEOUT_MS）降级：
 * 超时 / 失败 / 无 repo / 空 userId / 空结果 → undefined，prompt 退回
 * Tier0–3，绝不卡出话（§9）。当前 repo recall 按 salience 取 top-k 现行
 * 事实（t_invalid IS NULL），query 预留给未来向量召回。
 */
export async function recallTimelineFacts(ctx: RemiSessionContext): Promise<string | undefined> {
  const repo = ctx.temporalFactsRepo;
  if (!repo || !ctx.userId) return undefined;
  const timeoutMs = getConfig().REMI_TEMPORAL_RECALL_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const facts = await Promise.race([
      repo.recall(ctx.userId, { k: TIMELINE_RECALL_K }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("temporal recall timeout")), timeoutMs);
      }),
    ]);
    return formatTimelineFactsBlock(facts);
  } catch (err) {
    logger.debug("Tier4 时序召回跳过", { error: (err as Error).message });
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
