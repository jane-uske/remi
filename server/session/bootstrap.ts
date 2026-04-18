import type { RemiSessionContext } from "../../brains/remi_session_context";
import { isDbReady } from "../../infra/app_state";
import { createLogger } from "../../infra/logger";
import type { AuthPrincipal } from "../../infra/auth";
import {
  loadPersistentRelationshipState,
  relationshipStateEnabled,
} from "../../memory/relationship_state";
import {
  persistentMemoryOverlayEnabled,
  persistentMemoryPreloadLimit,
} from "../../memory/session_memory_overlay";
import { ensureStorageUser } from "../../storage/repositories/dev_identity";
import {
  getUserMessagesPage,
} from "../../storage/repositories/message_repository";
import { getPgMemoryRepository } from "../../storage/repositories/pg_memory_repository";
import { createSession as createDbSession } from "../../storage/repositories/session_repository";
import { ensureUserAuthIdentity } from "../../storage/repositories/user_auth_identity_repository";

const logger = createLogger("session");

export async function initializeSessionStorage(input: {
  connId: string;
  storageUserId: string;
  authPrincipal: AuthPrincipal | null;
  brain: RemiSessionContext;
  historyPageSize: number;
  setSessionId: (sessionId: string) => void;
  sendHistoryPage: (mode: "replace" | "prepend") => Promise<void>;
}): Promise<void> {
  if (!isDbReady()) return;

  try {
    const userId = input.authPrincipal
      ? await ensureUserAuthIdentity({
          userId: input.storageUserId,
          provider: input.authPrincipal.provider,
          providerUserId: input.authPrincipal.subject,
          email: input.authPrincipal.email,
        })
      : await ensureStorageUser(input.storageUserId);
    input.brain.setUserId(userId);
    const session = await createDbSession(userId);
    input.setSessionId(session.id);
    logger.info("[Storage] Session created", { sessionId: session.id, userId });

    const persistentRepo = getPgMemoryRepository(userId);
    if (relationshipStateEnabled()) {
      input.brain.attachPersistentRelationshipRepo(persistentRepo);
      const persistedState = await loadPersistentRelationshipState(persistentRepo);
      if (persistedState) {
        input.brain.hydratePersistentRelationshipState(persistedState);
        logger.debug("[Memory] relationship state restored", {
          connId: input.connId,
          sessionId: session.id,
          turns: persistedState.relationship.turnCount,
        });
      }
    }

    if (persistentMemoryOverlayEnabled()) {
      input.brain.memory.attachPersistent(persistentRepo);
      void input.brain.memory
        .hydrateFromPersistent(persistentMemoryPreloadLimit())
        .then(() => {
          logger.debug("[Memory] persistent facts hydrated into session overlay", {
            connId: input.connId,
            sessionId: session.id,
          });
        });
    }

    try {
      const recentPage = await getUserMessagesPage(userId, input.historyPageSize);
      if (recentPage.messages.length > 0) {
        input.brain.hydrateHistoryFromDb(recentPage.messages);
        logger.debug("[Memory] conversation history restored", {
          connId: input.connId,
          userId,
          messageCount: recentPage.messages.length,
        });
      }
      await input.sendHistoryPage("replace");
    } catch (err) {
      logger.warn("[Storage] Failed to restore conversation history", { error: err });
    }
  } catch (err) {
    logger.warn("[Storage] Failed to create session", { error: err });
  }
}
