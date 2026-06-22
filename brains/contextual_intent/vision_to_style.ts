// ── CIO Wired: 从图片外观描述推导说话风格 ─────────────────────────────
// 用户发图+"像她一点" → vision 已产出外观描述 → 这里用一次轻量 LLM 调用，
// 把外观描述转成"她说话的风格/语气"，喂给 styleOverride.roleplayStyle。
//
// 纯辅助函数，失败返回 null，不阻塞主路径。

import { completeWithOptions } from "../../llm/qwen_client";
import { getFastBrainModel } from "../fast_brain_model";
import { createLogger } from "../../infra/logger";

const logger = createLogger("vision_to_style");

/**
 * 根据角色外观描述，用一两句话总结她说话的风格和语气。
 * 只描述说话方式，不描述外表。
 *
 * 例：描述"银发冷酷少女，穿黑色皮衣，眼神锐利"
 *   → "冷淡高傲，话少但每句有分量，偶尔毒舌"
 */
export async function deriveStyleFromImageDescription(
  description: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const desc = description?.trim();
  if (!desc) return null;

  const model = getFastBrainModel();
  if (!model) return null;

  try {
    const reply = await completeWithOptions(
      [
        {
          role: "system",
          content: [
            "/no_think",
            "你是一个角色风格分析师。给你一段角色的外观描述，用一两句中文总结她说话的风格和语气。",
            "只描述说话方式（语气、节奏、用词习惯、性格浓度），不要描述外表。",
            "要具体、像人，不要空泛。直接给结论，不要前缀。",
            "例如：冷淡高傲，话少但每句有分量，偶尔毒舌。",
          ].join("\n"),
        },
        { role: "user", content: `角色外观描述：${desc}` },
      ],
      {
        model,
        maxTokens: 80,
        temperature: 0.6,
        reasoningEffort: "none",
        signal,
      },
    );
    const style = reply.trim();
    if (!style || style.length > 60) return null;
    return style.slice(0, 32); // roleplayStyle 上限 32 字
  } catch (err) {
    logger.warn("deriveStyleFromImageDescription failed", {
      error: (err as Error).message,
      descChars: desc.length,
    });
    return null;
  }
}
