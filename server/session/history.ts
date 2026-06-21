import type { MessageSink } from "../gateway/types";

import { isDbReady } from "../../infra/app_state";
import { createLogger } from "../../infra/logger";
import {
  getUserMessagesPage,
  type UserMessageHistoryCursor,
} from "../../storage/repositories/message_repository";
import { send } from "../gateway";

const logger = createLogger("session");

export type HistoryCursorPayload = {
  id: string;
  createdAt: string;
};

export function serializeHistoryCursor(
  cursor: UserMessageHistoryCursor | null,
): HistoryCursorPayload | null {
  if (!cursor) return null;
  return {
    id: cursor.id,
    createdAt: cursor.created_at.toISOString(),
  };
}

export function parseHistoryCursor(raw: unknown): UserMessageHistoryCursor | null {
  if (!raw || typeof raw !== "object") return null;
  const id =
    typeof (raw as HistoryCursorPayload).id === "string"
      ? (raw as HistoryCursorPayload).id.trim()
      : "";
  const createdAtRaw =
    typeof (raw as HistoryCursorPayload).createdAt === "string"
      ? (raw as HistoryCursorPayload).createdAt.trim()
      : "";
  if (!id || !createdAtRaw) return null;
  const createdAt = new Date(createdAtRaw);
  if (Number.isNaN(createdAt.getTime())) return null;
  return {
    id,
    created_at: createdAt,
  };
}

export async function sendSessionHistoryPage(input: {
  sink: MessageSink;
  storageUserId: string;
  connId: string;
  pageSize: number;
  mode: "replace" | "prepend";
  cursor?: UserMessageHistoryCursor | null;
}): Promise<void> {
  if (!isDbReady()) return;
  const page = await getUserMessagesPage(input.storageUserId, input.pageSize, input.cursor);
  send(input.sink, {
    type: "history_page",
    mode: input.mode,
    messages: page.messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.created_at.toISOString(),
    })),
    hasMore: page.hasMore,
    nextCursor: serializeHistoryCursor(page.nextCursor),
  });
  if (page.messages.length > 0) {
    logger.debug("[Memory] history page sent", {
      connId: input.connId,
      userId: input.storageUserId,
      mode: input.mode,
      messageCount: page.messages.length,
      hasMore: page.hasMore,
    });
  }
}
