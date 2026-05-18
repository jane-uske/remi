import type { DirectCapability } from "../brain/direct_capabilities";
import type { RemiSessionContext } from "../brains/remi_session_context";
import {
  familyMemoryConfig,
  familyMemoryFetchJson,
  type FamilyMemoryDraft,
  type PendingDraftsResponse,
} from "./family_memory_capability";

type DraftState = {
  activeDraftId: string | null;
  activeSummary: string | null;
};

type DraftActionResponse = {
  ok?: boolean;
  message?: string;
  error?: string;
};

const draftStates = new WeakMap<object, DraftState>();

const INTENT_LIST = /待确认|有什么.*确认|pending|有.*draft/iu;
const INTENT_CONFIRM = /^(确认|确认吧|好的确认|好，确认|好,确认|确定)$/u;
const INTENT_REJECT = /^(跳过|skip|不要了|算了)$/iu;
const INTENT_SELECT = /^(?:选择\s*|选\s*|#)(\d+)$/u;
const INTENT_SUMMARY = /^补充摘要[：:]\s*(.+)/u;

function contextKey(ctx: RemiSessionContext): object {
  return ctx as unknown as object;
}

function getState(ctx: RemiSessionContext): DraftState {
  const key = contextKey(ctx);
  const existing = draftStates.get(key);
  if (existing) return existing;
  const next = { activeDraftId: null, activeSummary: null };
  draftStates.set(key, next);
  return next;
}

function clearState(ctx: RemiSessionContext): void {
  draftStates.delete(contextKey(ctx));
}

function isDraftIntent(input: string): boolean {
  const trimmed = input.trim();
  return (
    INTENT_LIST.test(trimmed) ||
    INTENT_CONFIRM.test(trimmed) ||
    INTENT_REJECT.test(trimmed) ||
    INTENT_SELECT.test(trimmed) ||
    INTENT_SUMMARY.test(trimmed)
  );
}

async function loadPendingDrafts(): Promise<
  { ok: true; drafts: FamilyMemoryDraft[] } | { ok: false; error: string }
> {
  const result = await familyMemoryFetchJson<PendingDraftsResponse>("/api/ai/drafts/pending");
  if (!result.ok) return { ok: false, error: result.error };
  return {
    ok: true,
    drafts: Array.isArray(result.data.drafts) ? result.data.drafts : [],
  };
}

function fileList(draft: FamilyMemoryDraft): string {
  const files = draft.originalFilenames?.filter(Boolean) ?? [];
  return files.length > 0 ? files.join(", ") : draft.inferredTitle || draft.draftId;
}

function formatSingleDraft(draft: FamilyMemoryDraft): string {
  const date = draft.inferredDate || "日期未知";
  const title = draft.inferredTitle ? ` ${draft.inferredTitle}` : "";
  const ocr = draft.ocrStatus ? `，OCR: ${draft.ocrStatus}` : "";
  return `[${date}]${title} ${fileList(draft)}${ocr}`.trim();
}

function formatDraftList(drafts: FamilyMemoryDraft[]): string {
  return `待确认 draft（共 ${drafts.length} 条）：\n${drafts
    .map((draft, index) => `${index + 1}. ${formatSingleDraft(draft)}`)
    .join("\n")}`;
}

async function postDraftAction(
  draftId: string,
  action: "confirm" | "reject",
  body?: Record<string, unknown>,
): Promise<{ ok: true; data: DraftActionResponse } | { ok: false; error: string }> {
  return familyMemoryFetchJson<DraftActionResponse>(
    `/api/ai/drafts/${encodeURIComponent(draftId)}/${action}`,
    {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    },
  );
}

export const familyMemoryDraftsCapability: DirectCapability = {
  id: "family_memory_drafts",
  async tryHandle(request) {
    if (request.systemTriggered || !familyMemoryConfig().enabled) {
      return { handled: false };
    }

    const input = request.userMessage.trim();
    if (!isDraftIntent(input)) {
      return { handled: false };
    }

    const state = getState(request.ctx);

    if (INTENT_SUMMARY.test(input)) {
      const summary = input.match(INTENT_SUMMARY)?.[1]?.trim() ?? "";
      if (!summary) return { handled: true, capabilityId: "family_memory_drafts", reply: "摘要不能为空。" };
      if (!state.activeDraftId) {
        const pending = await loadPendingDrafts();
        if (!pending.ok) {
          return { handled: true, capabilityId: "family_memory_drafts", reply: "家庭记忆服务暂不可用，暂时不能处理待确认 draft。" };
        }
        if (pending.drafts.length === 1) {
          state.activeDraftId = pending.drafts[0].draftId;
        } else if (pending.drafts.length > 1) {
          return {
            handled: true,
            capabilityId: "family_memory_drafts",
            reply: `有 ${pending.drafts.length} 条待确认，请先选择编号。`,
          };
        } else {
          clearState(request.ctx);
          return { handled: false };
        }
      }
      state.activeSummary = summary;
      return {
        handled: true,
        capabilityId: "family_memory_drafts",
        reply: `摘要已更新：「${summary}」\n回复“确认”保存，或继续补充。`,
      };
    }

    const pending = await loadPendingDrafts();
    if (!pending.ok) {
      return {
        handled: true,
        capabilityId: "family_memory_drafts",
        reply: "家庭记忆服务暂不可用，暂时不能处理待确认 draft。",
      };
    }
    const drafts = pending.drafts;

    if (INTENT_LIST.test(input)) {
      if (drafts.length === 0) {
        clearState(request.ctx);
        return { handled: true, capabilityId: "family_memory_drafts", reply: "当前没有待确认的 draft。" };
      }
      if (drafts.length === 1) {
        state.activeDraftId = drafts[0].draftId;
        state.activeSummary = null;
        return {
          handled: true,
          capabilityId: "family_memory_drafts",
          reply: `${formatDraftList(drafts)}\n\n只有一条，可以直接回复“确认”或“跳过”。`,
        };
      }
      state.activeDraftId = null;
      state.activeSummary = null;
      return {
        handled: true,
        capabilityId: "family_memory_drafts",
        reply: `${formatDraftList(drafts)}\n\n请先选择编号（如“选择 1”），再确认或跳过。`,
      };
    }

    const selectMatch = input.match(INTENT_SELECT);
    if (selectMatch) {
      if (drafts.length === 0) {
        clearState(request.ctx);
        return { handled: true, capabilityId: "family_memory_drafts", reply: "当前没有待确认的 draft。" };
      }
      const num = Number(selectMatch[1]);
      if (num < 1 || num > drafts.length) {
        return {
          handled: true,
          capabilityId: "family_memory_drafts",
          reply: `编号无效，请输入 1~${drafts.length} 之间的数字。`,
        };
      }
      const draft = drafts[num - 1];
      state.activeDraftId = draft.draftId;
      state.activeSummary = null;
      return {
        handled: true,
        capabilityId: "family_memory_drafts",
        reply: `已选择第 ${num} 条：\n${formatSingleDraft(draft)}\n\n可以“补充摘要：xxx”、“确认”或“跳过”。`,
      };
    }

    if (INTENT_CONFIRM.test(input)) {
      if (!state.activeDraftId && drafts.length === 0) {
        clearState(request.ctx);
        return { handled: false };
      }
      if (!state.activeDraftId && drafts.length === 1) {
        state.activeDraftId = drafts[0].draftId;
      }
      if (!state.activeDraftId && drafts.length > 1) {
        return {
          handled: true,
          capabilityId: "family_memory_drafts",
          reply: `有 ${drafts.length} 条待确认，请先选择编号（如“选择 1”），不能直接确认。`,
        };
      }
      const body: Record<string, unknown> = {};
      if (state.activeSummary) body.summary = state.activeSummary;
      const result = await postDraftAction(state.activeDraftId!, "confirm", body);
      if (!result.ok || result.data.ok === false) {
        return {
          handled: true,
          capabilityId: "family_memory_drafts",
          reply: `确认失败：${result.ok ? result.data.message ?? result.data.error ?? "unknown" : result.error}`,
        };
      }
      clearState(request.ctx);
      return {
        handled: true,
        capabilityId: "family_memory_drafts",
        reply: "已确认。已生成待同步 note，运行 npm run sync 后会进入正式时间线和 Remi 可查询记忆。",
      };
    }

    if (INTENT_REJECT.test(input)) {
      if (!state.activeDraftId && drafts.length === 0) {
        clearState(request.ctx);
        return { handled: false };
      }
      if (!state.activeDraftId && drafts.length === 1) {
        state.activeDraftId = drafts[0].draftId;
      }
      if (!state.activeDraftId && drafts.length > 1) {
        return {
          handled: true,
          capabilityId: "family_memory_drafts",
          reply: `有 ${drafts.length} 条待确认，请先选择编号再跳过。`,
        };
      }
      const result = await postDraftAction(state.activeDraftId!, "reject");
      if (!result.ok || result.data.ok === false) {
        return {
          handled: true,
          capabilityId: "family_memory_drafts",
          reply: `跳过失败：${result.ok ? result.data.message ?? result.data.error ?? "unknown" : result.error}`,
        };
      }
      clearState(request.ctx);
      return {
        handled: true,
        capabilityId: "family_memory_drafts",
        reply: "已跳过这条待确认 draft。",
      };
    }

    return { handled: false };
  },
};
