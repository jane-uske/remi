import type { IncomingMessage, ServerResponse } from "node:http";

import { allowLoopbackAuthBypass, generateToken } from "../../infra/auth";
import { UUID_RE } from "../../infra/user_identity";
import { createLogger } from "../../infra/logger";

const logger = createLogger("loopback-identity");

/**
 * POST /api/loopback-identity
 *
 * Root cause fix for the "same real user gets a different storage id every
 * visit" bug: `resolveClerkRuntimePolicy` (web/src/lib/authMode.ts) correctly
 * disables Clerk when a *live* publishable key is used on a loopback hostname
 * (localhost/127.0.0.1) — that's a deliberate safety rail, kept as-is. But the
 * web client's `LegacyAuthBridge` then had no per-browser identity to fall
 * back to, so it resolved everyone hitting the app over loopback to the single
 * shared `DEV_STORAGE_USER_ID` constant. Every loopback visit (and every other
 * loopback visitor) silently comingled into that one bucket — the same
 * mechanism that produced the 156-message DEV_STORAGE_USER_ID cluster found
 * in local-prod.
 *
 * This endpoint mints a long-lived legacy JWT for a client-generated device id
 * that the browser persists in localStorage (see
 * web/src/lib/browserIdentity.ts loopbackDeviceId helpers). Unlike
 * /api/guest-token (which mints a *fresh random* id every call and requires an
 * invite code — wrong fit here, this isn't a guest trial), this endpoint is
 * idempotent: the same deviceId always signs to a token for the same storage
 * user, so a given browser keeps the same identity across days/reloads
 * without ever colliding with the shared dev placeholder or with other
 * browsers.
 *
 * Locked to loopback requests only (mirrors the same gate as the
 * REMI_AUTH_ALLOW_LOOPBACK_BYPASS check in server/gateway/index.ts) so this
 * can never be used to mint arbitrary identities from the public internet —
 * it only ever matters for the exact scenario that created the bug (local
 * dev/testing on localhost/127.0.0.1 with a live Clerk key configured).
 */

const LOOPBACK_TOKEN_TTL_SECONDS = 24 * 60 * 60;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX = 60;
const MAX_BUCKETS = 50;

interface RateBucket {
  count: number;
  windowStart: number;
}
const buckets = new Map<string, RateBucket>();

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.windowStart >= RATE_WINDOW_MS) {
    b = { count: 0, windowStart: now };
    if (buckets.size >= MAX_BUCKETS) {
      const oldest = [...buckets.entries()].sort((a, c) => a[1].windowStart - c[1].windowStart)[0];
      if (oldest) buckets.delete(oldest[0]);
    }
    buckets.set(key, b);
  }
  if (b.count >= RATE_MAX) return false;
  b.count += 1;
  return true;
}

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJsonBody<T>(req: IncomingMessage, maxBytes = 2048): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        reject(new Error("Body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as T);
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

// Duplicated (intentionally, not imported) from server/gateway/index.ts to
// avoid a circular import — index.ts imports this file's handler at module
// load time, so this file cannot import back from index.ts. Keep in sync with
// isLocalLoopbackRequestParts() there if the loopback definition ever changes;
// covered by the same semantics as test/server/gateway/loopback_auth_bypass.test.ts.
function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const normalized = address.trim().toLowerCase().replace(/^::ffff:/, "");
  return normalized === "::1" || normalized === "127.0.0.1";
}

function isDockerBridgeAddress(address: string | undefined): boolean {
  if (!address) return false;
  const normalized = address.trim().toLowerCase().replace(/^::ffff:/, "");
  const parts = normalized.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  const [a, b] = parts;
  if (parts.some((part) => part < 0 || part > 255)) return false;
  return a === 172 && b >= 16 && b <= 31;
}

function normalizeRequestHost(hostHeader: string | undefined): string {
  if (typeof hostHeader !== "string" || hostHeader.trim() === "") return "";
  const trimmed = hostHeader.trim().toLowerCase();
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    return end >= 0 ? trimmed.slice(1, end) : trimmed;
  }
  return trimmed.split(":")[0];
}

function isLoopbackHostname(host: string): boolean {
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "lvh.me" ||
    host.endsWith(".lvh.me")
  );
}

export function isLocalLoopbackRequestParts(
  hostHeader: string | undefined,
  remoteAddress: string | undefined,
): boolean {
  const host = normalizeRequestHost(hostHeader);
  if (!isLoopbackHostname(host)) return false;
  return isLoopbackAddress(remoteAddress) || isDockerBridgeAddress(remoteAddress);
}

interface LoopbackIdentityRequest {
  deviceId?: unknown;
}

/**
 * POST /api/loopback-identity  { deviceId: "<uuid>" }
 * → { token, expiresIn }
 */
export async function handleLoopbackIdentity(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "POST") {
    jsonResponse(res, 405, { error: "Method not allowed" });
    return;
  }

  if (!allowLoopbackAuthBypass() || !isLocalLoopbackRequestParts(req.headers.host, req.socket.remoteAddress)) {
    jsonResponse(res, 403, { error: "Loopback identity is only available on loopback requests" });
    return;
  }

  const rateKey = req.socket.remoteAddress ?? "unknown";
  if (!checkRateLimit(rateKey)) {
    jsonResponse(res, 429, { error: "请求过于频繁，请稍后再试" });
    return;
  }

  let body: LoopbackIdentityRequest;
  try {
    body = await readJsonBody(req);
  } catch {
    jsonResponse(res, 400, { error: "Invalid request body" });
    return;
  }

  const deviceId = typeof body.deviceId === "string" ? body.deviceId.trim().toLowerCase() : "";
  if (!UUID_RE.test(deviceId)) {
    jsonResponse(res, 400, { error: "deviceId must be a UUID" });
    return;
  }

  let token: string;
  try {
    token = generateToken(deviceId);
  } catch {
    logger.error("REMI_AUTH_JWT_SECRET not configured");
    jsonResponse(res, 500, { error: "Loopback identity not configured" });
    return;
  }

  logger.info("issued loopback identity token", { deviceId });
  jsonResponse(res, 200, {
    token,
    expiresIn: LOOPBACK_TOKEN_TTL_SECONDS,
  });
}
