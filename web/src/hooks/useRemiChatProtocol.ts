"use client";

import type { ChatMessage } from "@/types/chat";
import type {
  InterruptionType,
  RemiTurnState,
  RemiTurnStateReason,
} from "@/types/avatar";

const SERVER_INTERRUPTION_TYPES = new Set<InterruptionType>([
  "continuation",
  "correction",
  "topic_switch",
  "emotional_interrupt",
  "unknown",
]);

type ParsedHistoryCursor = {
  id: string;
  createdAt: string;
};

export type ParsedServerTurnState = {
  state: RemiTurnState;
  reason: RemiTurnStateReason;
  preview: string | null;
  interruptionType: InterruptionType | null;
  generationId: number | null;
};

export type ParsedServerHistoryPage = {
  mode: "replace" | "prepend";
  messages: ChatMessage[];
  nextCursor: ParsedHistoryCursor | null;
  hasMore: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function parseHistoryMessage(raw: unknown): ChatMessage | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === "string" ? raw.id : "";
  const role = raw.role === "assistant" ? "rem" : raw.role === "user" ? "user" : null;
  const text = typeof raw.content === "string" ? raw.content : "";
  const createdAt = typeof raw.createdAt === "string" ? raw.createdAt : undefined;
  if (!id || !role || !text) return null;
  return { id, role, text, createdAt };
}

function parseHistoryCursor(raw: unknown): ParsedHistoryCursor | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === "string" ? raw.id : "";
  const createdAt = typeof raw.createdAt === "string" ? raw.createdAt : "";
  if (!id || !createdAt) return null;
  return { id, createdAt };
}

export function parseGenerationId(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.floor(raw);
  if (typeof raw === "string") {
    const n = Number(raw);
    if (Number.isFinite(n)) return Math.floor(n);
  }
  return null;
}

export function parseServerInterruptionType(raw: unknown): InterruptionType | null {
  if (typeof raw !== "string") return null;
  return SERVER_INTERRUPTION_TYPES.has(raw as InterruptionType) ? (raw as InterruptionType) : null;
}

export function parseServerTurnState(data: unknown): ParsedServerTurnState | null {
  if (!isRecord(data)) return null;
  const state = typeof data.state === "string" && data.state ? (data.state as RemiTurnState) : null;
  const reason =
    typeof data.reason === "string" && data.reason ? (data.reason as RemiTurnStateReason) : null;
  if (!state || !reason) return null;
  const preview =
    typeof data.preview === "string" && data.preview.trim() ? data.preview.trim() : null;
  return {
    state,
    reason,
    preview,
    interruptionType: parseServerInterruptionType(data.interruptionType),
    generationId: parseGenerationId(data.generationId),
  };
}

export function parseServerHistoryPage(data: unknown): ParsedServerHistoryPage {
  const record = isRecord(data) ? data : {};
  const mode = record.mode === "prepend" ? "prepend" : "replace";
  const rawMessages = Array.isArray(record.messages) ? record.messages : [];
  const messages = rawMessages
    .map(parseHistoryMessage)
    .filter((message): message is ChatMessage => message !== null);

  return {
    mode,
    messages,
    nextCursor: parseHistoryCursor(record.nextCursor),
    hasMore: Boolean(record.hasMore),
  };
}
