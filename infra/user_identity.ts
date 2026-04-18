import { createHash } from "crypto";
import type { IncomingMessage } from "http";

import type { AuthPrincipal } from "./auth";
import { verifyToken } from "./auth";

export const DEV_STORAGE_USER_ID = "00000000-0000-4000-8000-000000000001";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function stableUuidFromString(input: string): string {
  const hash = createHash("sha256").update(input).digest("hex");
  const timeLow = hash.slice(0, 8);
  const timeMid = hash.slice(8, 12);
  const timeHighAndVersion = `5${hash.slice(13, 16)}`;
  const clockSeq = ((parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80)
    .toString(16)
    .padStart(2, "0");
  const clockSeqLow = hash.slice(18, 20);
  const node = hash.slice(20, 32);
  return `${timeLow}-${timeMid}-${timeHighAndVersion}-${clockSeq}${clockSeqLow}-${node}`.toLowerCase();
}

function readHeaderValue(
  req: Pick<IncomingMessage, "headers"> | null | undefined,
  name: string,
): string | null {
  const headers = req?.headers;
  if (!headers || typeof headers !== "object") return null;
  const raw = headers[name.toLowerCase()];
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && typeof raw[0] === "string") return raw[0];
  return null;
}

function extractBearerToken(req: IncomingMessage): string | null {
  const header = readHeaderValue(req, "authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice(7).trim() || null;
}

function extractQueryToken(req: IncomingMessage): string | null {
  const raw = typeof req?.url === "string" ? req.url : "";
  if (!raw) return null;
  try {
    const url = new URL(raw, "http://localhost");
    const token = url.searchParams.get("token");
    return token?.trim() || null;
  } catch {
    return null;
  }
}

export function normalizeToStorageUserId(rawUserId?: string | null): string {
  const trimmed = rawUserId?.trim();
  if (!trimmed) return DEV_STORAGE_USER_ID;
  if (UUID_RE.test(trimmed)) return trimmed.toLowerCase();
  return stableUuidFromString(`rem-user:${trimmed}`);
}

export function authPrincipalToStorageUserId(principal: AuthPrincipal): string {
  if (principal.provider === "legacy_jwt") {
    return normalizeToStorageUserId(principal.subject);
  }
  return stableUuidFromString(`rem-auth:${principal.provider}:${principal.subject}`);
}

export type RequestUserIdentity = {
  authPrincipal: AuthPrincipal | null;
  authPrincipalStorageUserId: string | null;
  storageUserId: string;
};

export function resolveRequestUserIdentity(req: IncomingMessage): RequestUserIdentity {
  const token = extractQueryToken(req) ?? extractBearerToken(req);
  const principal = token ? verifyToken(token) : null;
  if (!principal) {
    return {
      authPrincipal: null,
      authPrincipalStorageUserId: null,
      storageUserId: DEV_STORAGE_USER_ID,
    };
  }

  const storageUserId = authPrincipalToStorageUserId(principal);
  return {
    authPrincipal: principal,
    authPrincipalStorageUserId: storageUserId,
    storageUserId,
  };
}

export function resolveRequestUserId(req: IncomingMessage): string {
  return resolveRequestUserIdentity(req).storageUserId;
}
