import type { DirectCapability } from "../brain/direct_capabilities";
import { getConfig } from "../server/config";

export type FamilyMemoryConfig = {
  enabled: boolean;
  serviceUrl: string;
  token: string;
};

export type FamilyMemoryAskResponse = {
  handled?: boolean;
  question?: string;
  answerable?: boolean;
  answer?: string;
  confidence?: string;
  reason?: string;
  sources?: unknown[];
  serviceStatus?: string;
};

export type FamilyMemoryDraft = {
  draftId: string;
  inferredDate?: string | null;
  inferredTitle?: string | null;
  inferredType?: string | null;
  originalFilenames?: string[];
  ocrStatus?: string | null;
};

export type PendingDraftsResponse = {
  total?: number;
  drafts?: FamilyMemoryDraft[];
};

export function familyMemoryConfig(): FamilyMemoryConfig {
  const config = getConfig();
  return {
    enabled: config.REMI_FAMILY_MEMORY_ENABLED,
    serviceUrl: normalizeBaseUrl(config.REMI_FAMILY_MEMORY_SERVICE_URL),
    token: config.REMI_FAMILY_MEMORY_AI_TOKEN.trim(),
  };
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/u, "");
}

export function familyMemoryHeaders(config = familyMemoryConfig()): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.token) {
    headers.Authorization = `Bearer ${config.token}`;
  }
  return headers;
}

export async function familyMemoryFetchJson<T>(
  path: string,
  init?: RequestInit,
  config = familyMemoryConfig(),
): Promise<{ ok: true; data: T } | { ok: false; status?: number; error: string }> {
  if (!config.enabled) {
    return { ok: false, error: "disabled" };
  }

  try {
    const res = await fetch(`${config.serviceUrl}${path}`, {
      ...init,
      headers: {
        ...familyMemoryHeaders(config),
        ...(init?.headers as Record<string, string> | undefined),
      },
    });
    if (!res.ok) {
      return { ok: false, status: res.status, error: `http_${res.status}` };
    }
    return { ok: true, data: await res.json() as T };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

const FAMILY_MEMORY_QUESTION_RE =
  /(家庭记忆|宝宝|孕检|产检|怀孕|孕期|预产期|胎动|胎心|B超|b超|唐筛|糖耐|NT|nt|四维|孕周|出生|身高|体重|发育|疫苗|辅食|里程碑|最近一次.*检查|上次.*检查)/u;

export function isFamilyMemoryQuestion(message: string): boolean {
  return FAMILY_MEMORY_QUESTION_RE.test(message.trim());
}

function renderNoEvidenceReply(): string {
  return "家庭记忆里还没有相关记录，我不能编一个答案。";
}

function renderServiceUnavailableReply(): string {
  return "家庭记忆服务暂不可用，我现在拿不到 family-memory 服务，所以不能假装查到了。";
}

function uniqueAdjacentFragments(fragments: string[]): string[] {
  const unique: string[] = [];
  for (const fragment of fragments) {
    const normalized = fragment.trim().replace(/\s+/gu, " ");
    if (!normalized) {
      continue;
    }
    if (unique[unique.length - 1] !== normalized) {
      unique.push(normalized);
    }
  }
  return unique;
}

function deduplicateFamilyMemoryAnswer(answer: string): string {
  const trimmed = answer.trim().replace(/\s+/gu, " ");
  const memoryPrefix = trimmed.match(/^(根据家庭记忆记录（[^）]+）：)(.+)$/u);
  if (!memoryPrefix) {
    return trimmed;
  }

  const [, prefix, body] = memoryPrefix;
  const fragments = uniqueAdjacentFragments(body.split(/[。！？!?]|\s+/u));
  if (fragments.length === 0) {
    return trimmed;
  }

  return `${prefix}${fragments.join("。")}。`;
}

export async function tryHandleFamilyMemoryQuestion(
  userMessage: string,
): Promise<{ handled: false } | { handled: true; reply: string }> {
  const config = familyMemoryConfig();
  if (!config.enabled || !isFamilyMemoryQuestion(userMessage)) {
    return { handled: false };
  }

  const result = await familyMemoryFetchJson<FamilyMemoryAskResponse>(
    "/api/ai/ask",
    {
      method: "POST",
      body: JSON.stringify({ question: userMessage.trim() }),
    },
    config,
  );

  if (!result.ok) {
    return { handled: true, reply: renderServiceUnavailableReply() };
  }

  const answer = typeof result.data.answer === "string" ? result.data.answer.trim() : "";
  if (!result.data.answerable) {
    return { handled: true, reply: answer || renderNoEvidenceReply() };
  }

  return { handled: true, reply: answer ? deduplicateFamilyMemoryAnswer(answer) : renderNoEvidenceReply() };
}

export const familyMemoryCapability: DirectCapability = {
  id: "family_memory",
  async tryHandle(request) {
    if (request.systemTriggered) {
      return { handled: false };
    }

    const result = await tryHandleFamilyMemoryQuestion(request.userMessage);
    if (!result.handled) {
      return { handled: false };
    }

    return {
      handled: true,
      capabilityId: "family_memory",
      reply: result.reply,
    };
  },
};
