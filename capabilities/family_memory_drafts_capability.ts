import type { DirectCapability } from "../brain/direct_capabilities";
import { getConfig } from "../server/config";
import { createLogger } from "../infra/logger";

const logger = createLogger("family_memory_drafts");

// --- Intent Detection ---

const DRAFTS_INTENT_PATTERNS: RegExp[] = [
  /待确认/,
  /有没有.*草稿/,
  /有什么.*要确认/,
  /查看.*草稿/,
  /有.*待审/,
  /看看.*draft/i,
  /确认.*照片/,
  /确认.*资料/,
  /有没有.*新.*素材/,
];

// --- Confirmation / Rejection Detection ---

const CONFIRM_PATTERNS: RegExp[] = [
  /^确认$/,
  /^是$/,
  /^对$/,
  /^好$/,
  /^嗯$/,
  /^ok$/i,
  /^确定$/,
  /^没问题$/,
  /^可以$/,
  /^通过$/,
];

const REJECT_PATTERNS: RegExp[] = [
  /^算了$/,
  /^取消$/,
  /^不了$/,
  /^不要$/,
  /^删除$/,
  /^跳过$/,
  /^拒绝$/,
  /^reject$/i,
];

const SUMMARY_PATTERN = /补充摘要[：:](.+)/;

// --- Session State ---

export interface PendingDraft {
  draftId: string;
  inferredDate: string | null;
  inferredTitle: string | null;
  originalFilenames: string[];
  attachmentIds: string[];
  ocrStatus?: "extracted" | "no_text" | "no_extractor" | "error" | "partial";
  ocrAttachmentCount?: number;
  ocrExtractedCount?: number;
}

interface DraftSession {
  activeDraftId: string | null;
  activeDraftTitle: string | null;
  activeSummary: string | null;
  allDrafts: PendingDraft[];
  createdAt: number;
}

const sessions = new Map<string, DraftSession>();
const SESSION_TTL_MS = 5 * 60 * 1000;

function cleanExpiredSessions(): void {
  const now = Date.now();
  for (const [key, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      sessions.delete(key);
    }
  }
}

function isDraftsIntent(text: string): boolean {
  return DRAFTS_INTENT_PATTERNS.some((p) => p.test(text));
}

function isConfirmation(text: string): boolean {
  return CONFIRM_PATTERNS.some((p) => p.test(text.trim()));
}

function isRejection(text: string): boolean {
  return REJECT_PATTERNS.some((p) => p.test(text.trim()));
}

const NUMBER_PATTERN = /^(\d+)$/;
const SELECT_PATTERN = /^选择\s*(\d+)$/;

// --- OCR Display Helpers ---

function ocrStatusLabel(draft: PendingDraft): string {
  if (!draft.ocrStatus) return "无附件";
  switch (draft.ocrStatus) {
    case "extracted":
      return "已提取文本";
    case "no_extractor":
      return "无法自动识别";
    case "no_text":
      return "无文本内容";
    case "error":
      return "提取失败";
    case "partial":
      return `部分提取(${draft.ocrExtractedCount ?? 0}/${draft.ocrAttachmentCount ?? 0})`;
  }
}

function needsSummary(draft: PendingDraft): boolean {
  return (
    draft.ocrStatus === "no_extractor" ||
    draft.ocrStatus === "no_text" ||
    draft.ocrStatus === "error" ||
    draft.ocrStatus === "partial"
  );
}

function ocrHint(draft: PendingDraft): string {
  if (draft.ocrStatus === "no_extractor") {
    return "这些图片当前还不能自动识别内容，请补充摘要后确认。";
  }
  if (draft.ocrStatus === "extracted") {
    return "PDF 已提取文本，但仍需确认摘要。";
  }
  if (draft.ocrStatus === "partial") {
    return `部分文件已提取文本(${draft.ocrExtractedCount}/${draft.ocrAttachmentCount})，建议补充摘要后确认。`;
  }
  if (draft.ocrStatus === "no_text" || draft.ocrStatus === "error") {
    return "文件内容无法自动提取，请补充摘要后确认。";
  }
  return "";
}

// --- API Helpers ---

async function fetchPendingDrafts(
  config: ReturnType<typeof getConfig>,
): Promise<PendingDraft[] | null> {
  const serviceUrl = config.REMI_FAMILY_MEMORY_SERVICE_URL;
  const token = config.REMI_FAMILY_MEMORY_AI_TOKEN;

  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  try {
    const response = await fetch(`${serviceUrl}/api/ai/drafts/pending`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { drafts: PendingDraft[] };
    return body.drafts;
  } catch {
    return null;
  }
}

async function confirmDraftApi(
  draftId: string,
  overrides: Record<string, unknown>,
  config: ReturnType<typeof getConfig>,
): Promise<{ ok: boolean; error?: string }> {
  const serviceUrl = config.REMI_FAMILY_MEMORY_SERVICE_URL;
  const token = config.REMI_FAMILY_MEMORY_AI_TOKEN;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  try {
    const response = await fetch(`${serviceUrl}/api/ai/drafts/${draftId}/confirm`, {
      method: "POST",
      headers,
      body: JSON.stringify(overrides),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      return { ok: false, error: (body.error as string) || `HTTP ${response.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

async function rejectDraftApi(
  draftId: string,
  config: ReturnType<typeof getConfig>,
): Promise<{ ok: boolean; error?: string }> {
  const serviceUrl = config.REMI_FAMILY_MEMORY_SERVICE_URL;
  const token = config.REMI_FAMILY_MEMORY_AI_TOKEN;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  try {
    const response = await fetch(`${serviceUrl}/api/ai/drafts/${draftId}/reject`, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      return { ok: false, error: (body.error as string) || `HTTP ${response.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// --- Capability ---

export const familyMemoryDraftsCapability: DirectCapability = {
  id: "family_memory_drafts",
  async tryHandle(request) {
    const config = getConfig();

    if (!config.REMI_FAMILY_MEMORY_ENABLED) {
      return { handled: false };
    }

    if (request.systemTriggered) {
      return { handled: false };
    }

    const connId = request.ctx.connId;
    const userMessage = request.userMessage.trim();

    cleanExpiredSessions();

    // --- Phase 2: Active session ---
    const session = sessions.get(connId);
    if (session) {
      if (Date.now() - session.createdAt > SESSION_TTL_MS) {
        sessions.delete(connId);
        return {
          handled: true,
          capabilityId: "family_memory_drafts",
          reply: "草稿确认会话已过期，请重新发起。",
        };
      }

      // If no active draft selected yet (multi-draft list shown), require number selection
      if (!session.activeDraftId) {
        // Number selection (bare number or "选择 N")
        const numMatch = userMessage.match(NUMBER_PATTERN) || userMessage.match(SELECT_PATTERN);
        if (numMatch) {
          const idx = parseInt(numMatch[1], 10) - 1;
          if (idx < 0 || idx >= session.allDrafts.length) {
            return {
              handled: true,
              capabilityId: "family_memory_drafts",
              reply: `编号无效，请输入 1 到 ${session.allDrafts.length} 之间的数字。`,
            };
          }
          const selected = session.allDrafts[idx];
          session.activeDraftId = selected.draftId;
          session.activeDraftTitle = selected.inferredTitle || selected.originalFilenames.join(", ");
          const fileList = selected.originalFilenames.join(", ");
          const dateInfo = selected.inferredDate || "未知日期";
          const hint = ocrHint(selected);
          let reply = `已选择第 ${idx + 1} 条：\n  日期：${dateInfo}\n  文件：${fileList}`;
          if (hint) reply += `\n\n${hint}`;
          reply += `\n\n回复"确认"通过，"跳过"拒绝，或"补充摘要：<内容>"添加描述后确认。`;
          return {
            handled: true,
            capabilityId: "family_memory_drafts",
            reply,
          };
        }

        // Bare confirm/reject without selecting a number — refuse
        if (isConfirmation(userMessage)) {
          return {
            handled: true,
            capabilityId: "family_memory_drafts",
            reply: `有 ${session.allDrafts.length} 条待确认草稿，请先输入编号选择要操作的草稿（如"1"、"2"）。`,
          };
        }
        if (isRejection(userMessage)) {
          return {
            handled: true,
            capabilityId: "family_memory_drafts",
            reply: `有 ${session.allDrafts.length} 条待确认草稿，请先输入编号选择要操作的草稿（如"1"、"2"）。`,
          };
        }

        // Unrecognized — cancel session
        sessions.delete(connId);
        return { handled: false };
      }

      // Active draft selected — handle confirm/reject/summary
      if (isConfirmation(userMessage)) {
        const overrides: Record<string, unknown> = {};
        if (session.activeSummary) overrides.summary = session.activeSummary;
        const result = await confirmDraftApi(session.activeDraftId, overrides, config);
        const title = session.activeDraftTitle || session.activeDraftId;
        sessions.delete(connId);
        if (result.ok) {
          logger.info("draft confirmed", { connId, draftId: session.activeDraftId });
          return {
            handled: true,
            capabilityId: "family_memory_drafts",
            reply: `已生成待同步 note「${title}」，运行 npm run sync 后会进入正式时间线和 Remi 可查询记忆。`,
          };
        }
        return {
          handled: true,
          capabilityId: "family_memory_drafts",
          reply: `确认失败：${result.error}`,
        };
      }

      if (isRejection(userMessage)) {
        const result = await rejectDraftApi(session.activeDraftId, config);
        const title = session.activeDraftTitle || session.activeDraftId;
        sessions.delete(connId);
        if (result.ok) {
          logger.info("draft rejected", { connId, draftId: session.activeDraftId });
          return {
            handled: true,
            capabilityId: "family_memory_drafts",
            reply: `已跳过「${title}」，不会进入时间线。`,
          };
        }
        return {
          handled: true,
          capabilityId: "family_memory_drafts",
          reply: `拒绝失败：${result.error}`,
        };
      }

      const summaryMatch = userMessage.match(SUMMARY_PATTERN);
      if (summaryMatch) {
        const summary = summaryMatch[1].trim();
        session.activeSummary = summary;
        const draftIdx = session.allDrafts.findIndex((d) => d.draftId === session.activeDraftId);
        const draftNum = draftIdx >= 0 ? draftIdx + 1 : 1;
        return {
          handled: true,
          capabilityId: "family_memory_drafts",
          reply: `已补充摘要到第 ${draftNum} 条草稿。回复"确认"即可生成待同步 note。`,
        };
      }

      // Unrecognized — cancel session
      sessions.delete(connId);
      return { handled: false };
    }

    // --- Phase 1: Detect drafts intent ---
    if (!isDraftsIntent(userMessage)) {
      return { handled: false };
    }

    const drafts = await fetchPendingDrafts(config);
    if (drafts === null) {
      return {
        handled: true,
        capabilityId: "family_memory_drafts",
        reply: "家庭记忆服务暂不可用，无法查询待确认草稿。",
      };
    }

    if (drafts.length === 0) {
      return {
        handled: true,
        capabilityId: "family_memory_drafts",
        reply: "当前没有待确认的草稿。",
      };
    }

    if (drafts.length === 1) {
      const first = drafts[0];
      const fileList = first.originalFilenames.join(", ");
      const dateInfo = first.inferredDate || "未知日期";
      const title = first.inferredTitle || fileList;
      const hint = ocrHint(first);

      sessions.set(connId, {
        activeDraftId: first.draftId,
        activeDraftTitle: title,
        activeSummary: null,
        allDrafts: drafts,
        createdAt: Date.now(),
      });

      let reply = `有 1 条待确认草稿：\n  日期：${dateInfo}\n  文件：${fileList}`;
      if (hint) reply += `\n\n${hint}`;
      reply += `\n\n回复"确认"通过，"跳过"拒绝，或"补充摘要：<内容>"添加描述后确认。`;
      return {
        handled: true,
        capabilityId: "family_memory_drafts",
        reply,
      };
    }

    // Multiple drafts — show numbered list with OCR status
    sessions.set(connId, {
      activeDraftId: null,
      activeDraftTitle: null,
      activeSummary: null,
      allDrafts: drafts,
      createdAt: Date.now(),
    });

    let reply = `有 ${drafts.length} 条待确认草稿：\n\n`;
    for (let i = 0; i < drafts.length; i++) {
      const d = drafts[i];
      const title = d.inferredTitle || d.originalFilenames.join(", ");
      const fileCount = d.originalFilenames.length;
      const ocr = ocrStatusLabel(d);
      const summaryNeeded = needsSummary(d) ? " ⚠需补充摘要" : "";
      reply += `  ${i + 1}. ${title}\n     文件数：${fileCount} | OCR：${ocr}${summaryNeeded}\n`;
    }
    reply += `\n请输入编号选择要操作的草稿（如"1"、"2"）。`;

    logger.info("drafts listed (multi)", { connId, total: drafts.length });

    return {
      handled: true,
      capabilityId: "family_memory_drafts",
      reply,
    };
  },
};
