import type { PersonaPack } from "./types";
import {
  PERSONA_SYSTEM_LAYER,
  PERSONA_SYSTEM_LAYER_REINFORCE,
} from "./system_layer";
import { MEMORY_USAGE_CONTRACT } from "../remi_default";

/**
 * compose 的动态输入。字段刻意与 brain/personality.ts 的 buildPersonaPrompt
 * options 对齐，这样 prompt_builder 可以零成本在「新 compose」与「旧 buildPersonaPrompt」
 * 之间切换，记忆 / 情绪 / 慢脑策略等现有子系统在 flag-on 时照常注入（零回归）。
 *
 * 减法路线上这些动态块会逐步变薄（最终多数交给 LLM），但 M1 阶段全部保留。
 */
export interface ComposePersonaOptions {
  currentContext?: string;
  priorityContext?: string;
  relationshipStageLabel?: string;
  replyShapeContract?: string;
  toneContract?: string;
  memoryStr?: string;
  emotionSpeechGuidance?: string;
}

/**
 * 分层编译 system prompt 的人格段：
 *
 *   L0   平台系统护栏（pack 改不动）
 *   ──   本轮动态上下文（慢脑/策略，可选）
 *   L1   IDENTITY.md   ← pack
 *   L2   SOUL.md       ← pack
 *   L3   EXAMPLES.md   ← pack（few-shot）
 *   L4   CANON.md      ← pack（生活事实库，可选——没有该文件时此层不渲染，行为不变）
 *   ──   记忆背景 / 情绪语调（可选）
 *   L0'  平台系统护栏 · 重申（对抗带偏/注入）
 *
 * 返回值替代旧的 buildPersonaPrompt 输出；emotion 自标注尾巴仍由 prompt_builder 追加。
 */
export function composePersonaPrompt(
  pack: PersonaPack,
  options: ComposePersonaOptions = {},
): string {
  const parts: string[] = [];

  // L0 —— 最高优先级，放在所有自定义文本之前
  parts.push(PERSONA_SYSTEM_LAYER);

  // 本轮动态上下文（慢脑工作记忆、关系阶段、回复/语气合同、优先参考）
  if (options.currentContext?.trim()) {
    parts.push(options.currentContext.trim());
  }
  if (options.relationshipStageLabel?.trim()) {
    parts.push(`【关系阶段】\n${options.relationshipStageLabel.trim()}`);
  }
  // replyShapeContract / toneContract 是慢脑「怎么回复」的指令，REMI_LEAN_SLOW_GUIDANCE
  // 开启时由调用方（prompt_builder）传 undefined 把它们截断在注入边界——人格语气交给
  // pack + few-shot；此处只按 truthy 渲染，故不传即不渲染，compose 自身无需感知 flag。
  if (options.replyShapeContract?.trim()) {
    parts.push(`【本轮回复合同】\n${options.replyShapeContract.trim()}`);
  }
  if (options.toneContract?.trim()) {
    parts.push(`【语气合同】\n${options.toneContract.trim()}`);
  }
  if (options.priorityContext?.trim()) {
    parts.push(
      `【优先参考（请自然融入对话，不要逐条复述）】\n${options.priorityContext.trim()}`,
    );
  }

  // L1 身份 + L2 内核（人格主体，来自 pack 的 md）
  parts.push(pack.identity);
  if (pack.soul.trim()) {
    parts.push(pack.soul.trim());
  }

  // L3 few-shot 示范
  if (pack.examples.trim()) {
    parts.push(pack.examples.trim());
  }

  // L4 生活事实库（可选）：没有 CANON.md 的 pack（如 nami）此处不渲染，逐字节零回归。
  if (pack.canon?.trim()) {
    parts.push(pack.canon.trim());
  }

  // 记忆背景
  if (options.memoryStr?.trim()) {
    parts.push(
      `【记忆背景】以下内容只作为理解当下的背景依据；除非用户主动问记忆、当前话题直接相关，否则不要显式说"我记得/你之前/上次"，也不要用它另起旧话题。${MEMORY_USAGE_CONTRACT}\n${options.memoryStr.trim()}`,
    );
  }

  // 情绪语调
  if (options.emotionSpeechGuidance?.trim()) {
    parts.push(options.emotionSpeechGuidance.trim());
  }

  // L0' —— 在所有自定义文本之后重申，把人格钉回平台约束
  parts.push(PERSONA_SYSTEM_LAYER_REINFORCE);

  return parts.join("\n\n");
}
