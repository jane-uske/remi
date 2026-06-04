import type { IncomingMessage, ServerResponse } from "node:http";

import { generateToken, verifyToken } from "../../infra/auth";
import { authPrincipalToStorageUserId } from "../../infra/user_identity";
import { createLogger } from "../../infra/logger";

const logger = createLogger("desktop-auth");

/** `generateToken()` signs legacy JWTs with a 24h TTL — keep this in sync. */
const LEGACY_TOKEN_TTL_SECONDS = 24 * 60 * 60;

function extractBearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  return token || null;
}

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

/**
 * POST /api/desktop/exchange-token
 *
 * The Tauri desktop client can't run the Clerk SDK, and a raw Clerk session JWT
 * only lasts ~60s, so it can't be used as a long-lived connection credential.
 * The browser-based sign-in flow (`web /sign-in?desktop=1`) calls this endpoint
 * with the freshly-minted Clerk token; we verify it and hand back a long-lived
 * legacy JWT.
 *
 * Crucially, the legacy token's subject is the *storage* user id derived from
 * the Clerk principal — not the raw Clerk userId. `authPrincipalToStorageUserId`
 * hashes clerk vs legacy principals with different prefixes, so signing the raw
 * Clerk id would route the desktop (legacy token) to a *different* bucket than
 * the web (clerk token). By signing the already-resolved storage id (a UUID,
 * which `normalizeToStorageUserId` passes through untouched), web and desktop
 * land on the same data:
 *
 *   same email → same Clerk userId → same storage user id → same memory
 *
 * Auth is enforced *here*, not by the gateway: in clerk mode
 * `shouldEnforceHttpAuth` returns false (server/gateway/index.ts), so this
 * handler must itself reject any caller that doesn't present a valid Clerk
 * token. A legacy token is rejected on purpose — only a real Clerk session may
 * mint a fresh desktop credential (no silent self-renewal from a leaked token).
 */
export async function handleDesktopExchangeToken(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "POST") {
    jsonResponse(res, 405, { error: "Method not allowed" });
    return;
  }

  const token = extractBearerToken(req);
  if (!token) {
    jsonResponse(res, 401, { error: "Missing bearer token" });
    return;
  }

  const principal = verifyToken(token);
  if (!principal || principal.provider !== "clerk") {
    jsonResponse(res, 401, { error: "Clerk authentication required" });
    return;
  }

  const storageUserId = authPrincipalToStorageUserId(principal);

  let exchanged: string;
  try {
    exchanged = generateToken(storageUserId);
  } catch {
    logger.error("exchange-token failed: REMI_AUTH_JWT_SECRET not configured");
    jsonResponse(res, 500, { error: "Token exchange not configured" });
    return;
  }

  logger.info("issued desktop token", { storageUserId });
  jsonResponse(res, 200, { token: exchanged, expiresIn: LEGACY_TOKEN_TTL_SECONDS });
}
