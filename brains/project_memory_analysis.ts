// ── Long-term-affairs memory extraction ──────────────────────────────
// Runs inside the slow brain (off the hot path). When a turn looks like it
// carries reusable long-term-affairs info (a study / fitness / creative / dev
// goal — the Remi project is just one kind), an LLM produces a small
// ProjectMemory DELTA (not a restatement), applied deterministically + persisted.
//
// Design mirrors background_analysis.ts: gated → build messages → complete() →
// parse JSON delta → apply → save. Only HIGH-VALUE, reusable info is written;
// ordinary chatter is skipped by isProjectExtractionWorthy().
//
// RemiSelf invariant: the prompt routes any "act more like <character>" request
// into performance_profiles_add (a style skin), never into identity framing;
// applyProjectMemoryUpdate enforces the same boundary defensively.

import { complete, hasLlmConfig, type ChatMessage } from "../llm/qwen_client";
import { createLogger } from "../infra/logger";
import type { PromptMessage } from "../brain/prompt_builder";
import type { MemoryRepository } from "../memory/memory_repository";
import {
  applyProjectMemoryUpdate,
  isProjectExtractionWorthy,
  loadProjectMemory,
  projectMemoryEnabled,
  saveProjectMemory,
  type ProjectMemory,
  type ProjectMemoryUpdate,
} from "../memory/project_memory";

const logger = createLogger("project_memory_analysis");

export interface ProjectAnalysisInput {
  userId: string;
  userMessage: string;
  assistantReply: string;
  history: PromptMessage[];
  /** Persistent-reaching repo for load/save (e.g. ctx.persistentRelationshipRepo). */
  repo: MemoryRepository | null;
  signal?: AbortSignal;
  connId?: string;
  /** Test seam for deterministic timestamps. */
  now?: number;
}

// Test seam: override the LLM call without standing up a real model.
type CompleteFn = (
  messages: ChatMessage[],
  maxTokens: number,
  signal?: AbortSignal,
) => Promise<string>;
let completeOverride: CompleteFn | null = null;
export function __setProjectExtractCompleteForTest(fn: CompleteFn | null): void {
  completeOverride = fn;
}

const PROJECT_ANALYSIS_PROMPT = `你是用户的「长期事务记忆」抽取引擎，不是对话参与者。
用户会长期推进一些事情——可能是学习目标（如学日语、备考）、健身/生活习惯、创作（做视频/网站/写作）、技术项目（包括 Remi 本身，但 Remi 只是其中一种），或任何需要持续跟进的目标。请从最新一轮对话里抽取**高价值、可复用**的长期事务信息，输出对长期事务记忆的**增量更新**（delta），不要复述已有内容。

严格返回合法 JSON（不要 markdown 代码块），只包含**本轮真的有变化**的字段，没有变化就返回 {}：
{
  "project_name": "这件长期事务的名字，第一次识别出来时写（如'学日语'/'健身减肥'/'做个人网站'/'Remi 项目'）",
  "north_star": "用户这件事的长期目标/愿景（如'年底前过日语 N5'），变化了才写",
  "current_focus": "当前在推进的主线，变化了才写（整句替换，不是追加）",
  "recent_actions_add": ["本轮新推进/完成的事，一条一句"],
  "decisions_add": [{"topic": "决策主题", "decision": "定下来的做法", "rationale": "为什么"}],
  "rejected_options_add": [{"option": "被否掉的方案", "reason": "为什么不选"}],
  "open_questions_add": ["新出现的未决问题"],
  "open_questions_resolved": ["本轮已经定下来、不再悬而未决的问题原文片段"],
  "next_suggestions": [{"suggestion": "下一步该做什么", "priority": 1}],
  "user_working_style_add": ["用户明确表达的、希望你怎么帮 ta 的方式/交付偏好，如'安排任务别拆太细，直接给可复制的中文提示词'"],
  "performance_profiles_add": [{"name": "风格名", "descriptor": "怎么说话的风格描述", "source": "来源(如某张角色图)", "saved": false}],
  "timeline_add": [{"date": "YYYY-MM-DD", "topic": "节点主题", "summary": "一句话", "status": "in_progress"}]
}

铁律：
- 只写真正可复用的长期事务信息：长期目标、当前主线、决策、被否方案、未决问题、下一步、用户希望你怎么帮 ta、重要节点。闲聊、一次性情绪、生活琐事一律不写。
- 不要把所有事都套进「Remi 项目」。用户说学日语就记学日语，说健身就记健身——按它本来的样子记，绝不要编成 Remi 开发进度。
- 决策若是对旧方向的修改，用相同的 topic 写 decisions_add（系统会原地更新而不是堆叠）。
- next_suggestions 是整张「下一步清单」的替换，按 priority 从 1 开始排；没有新信息就别写这个字段。
- **身份红线**：如果用户要 Remi「更像某个角色/某张图一点」，这是**说话风格**，写进 performance_profiles_add，绝不要写进 current_focus 或任何身份描述，绝不要让 Remi 变成另一个人。
- timeline 的 date 用对话里出现的日期；没有就留空字符串 ""。
- 拿不准、信息不足、或本轮只是普通聊天，就返回 {}。`;

export function buildProjectAnalysisMessages(input: {
  userMessage: string;
  assistantReply: string;
  history: PromptMessage[];
  current: ProjectMemory;
}): ChatMessage[] {
  const recent = input.history
    .slice(-6)
    .map((m) => `${m.role === "user" ? "用户" : "Remi"}：${m.content}`)
    .join("\n");
  const snapshot = compactSnapshot(input.current);
  return [
    { role: "system", content: PROJECT_ANALYSIS_PROMPT },
    {
      role: "user",
      content:
        `【已有项目记忆快照】（在此基础上做增量，别复述）：\n${snapshot}\n\n` +
        `最近对话：\n${recent || "（无）"}\n\n` +
        `最新一轮：\n用户：${input.userMessage}\nRemi：${input.assistantReply}`,
    },
  ];
}

function compactSnapshot(pm: ProjectMemory): string {
  const parts: string[] = [];
  if (pm.current_focus) parts.push(`当前主线：${pm.current_focus}`);
  if (pm.recent_actions.length) parts.push(`最近在做：${pm.recent_actions.slice(0, 6).join("｜")}`);
  if (pm.decisions.length) {
    parts.push(`已定：${pm.decisions.slice(0, 5).map((d) => d.topic).join("、")}`);
  }
  if (pm.open_questions.length) parts.push(`未决：${pm.open_questions.slice(0, 4).join("；")}`);
  if (pm.user_working_style.length) {
    parts.push(`工作方式：${pm.user_working_style.slice(0, 4).join("；")}`);
  }
  if (pm.performance_profiles.length) {
    parts.push(`风格侧写：${pm.performance_profiles.map((p) => p.name).join("、")}`);
  }
  return parts.join("\n") || "（暂无，本轮为首次建立）";
}

export function parseProjectUpdate(raw: string): ProjectMemoryUpdate | null {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as ProjectMemoryUpdate;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    logger.warn("project update JSON 解析失败", { raw: raw.slice(0, 120) });
    return null;
  }
}

function isEmptyUpdate(u: ProjectMemoryUpdate): boolean {
  return !(
    (u.project_name && u.project_name.trim()) ||
    (u.north_star && u.north_star.trim()) ||
    (u.current_focus && u.current_focus.trim()) ||
    u.recent_actions_add?.length ||
    u.decisions_add?.length ||
    u.rejected_options_add?.length ||
    u.open_questions_add?.length ||
    u.open_questions_resolved?.length ||
    u.next_suggestions?.length ||
    u.user_working_style_add?.length ||
    u.performance_profiles_add?.length ||
    u.timeline_add?.length
  );
}

/**
 * Extract + persist a project-memory delta for one turn. Returns the applied
 * update (for logging/tests), or null when nothing was written. Never throws
 * into the slow-brain pipeline.
 */
export async function runProjectMemoryAnalysis(
  input: ProjectAnalysisInput,
): Promise<ProjectMemoryUpdate | null> {
  if (!projectMemoryEnabled()) return null;
  if (!input.userId) return null;
  if (!isProjectExtractionWorthy(input.userMessage)) return null;

  const llm = completeOverride ?? complete;
  if (!completeOverride && !hasLlmConfig()) return null;

  try {
    const current = await loadProjectMemory(input.repo, input.userId);
    const messages = buildProjectAnalysisMessages({
      userMessage: input.userMessage,
      assistantReply: input.assistantReply,
      history: input.history,
      current,
    });
    const raw = await llm(messages, 460, input.signal);
    if (input.signal?.aborted) return null;
    const update = parseProjectUpdate(raw);
    if (!update || isEmptyUpdate(update)) return null;

    const next = applyProjectMemoryUpdate(current, update, input.now);
    if (next === current) return null;
    await saveProjectMemory(input.repo, input.userId, next);
    logger.info("project memory updated", {
      connId: input.connId,
      fields: Object.keys(update),
      decisions: next.decisions.length,
      recentActions: next.recent_actions.length,
      performanceProfiles: next.performance_profiles.length,
    });
    return update;
  } catch (err) {
    if ((err as Error).name === "AbortError") return null;
    logger.warn("project memory extraction failed", { error: (err as Error).message });
    return null;
  }
}
