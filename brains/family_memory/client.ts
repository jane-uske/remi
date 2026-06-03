import { getConfig } from "../../server/config";
import { createLogger } from "../../infra/logger";

const logger = createLogger("family_memory");

export interface FamilyMemorySource {
  id: string;
  category: string;
  content: string;
  recordedAt: string;
  source: string;
}

export interface FamilyMemoryResult {
  handled: boolean;
  answerable: "yes" | "no" | "partial_evidence";
  reason: string;
  answer: string;
  sources: FamilyMemorySource[];
  resultSource: "deterministic" | "cloud" | "deterministic_fallback";
}

export function isFamilyMemoryEnabled(): boolean {
  return getConfig().REMI_FAMILY_MEMORY_ENABLED;
}

export async function queryFamilyMemory(message: string): Promise<FamilyMemoryResult> {
  const baseUrl = getConfig().REMI_FAMILY_MEMORY_SERVICE_URL;
  const url = `${baseUrl.replace(/\/$/, "")}/query`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Family memory service returned ${response.status}`);
    }

    const result = (await response.json()) as FamilyMemoryResult;
    logger.info("[family_memory] query result", {
      message: message.slice(0, 50),
      handled: result.handled,
      answerable: result.answerable,
      reason: result.reason,
      sourcesCount: result.sources.length,
      resultSource: result.resultSource,
    });
    return result;
  } catch (error) {
    const errorMessage = (error as Error).message ?? "unknown";
    logger.error("[family_memory] service unreachable", { error: errorMessage });
    throw new Error("家庭记忆服务暂不可用");
  } finally {
    clearTimeout(timeout);
  }
}
