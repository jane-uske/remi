import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { generateToken } from "../../infra/auth";
import { getConfig } from "../config";
import { createLogger } from "../../infra/logger";
import { isDbReady } from "../../infra/app_state";
import {
  isCodeValidForTrial,
  incrementTrialUse,
} from "../../storage/repositories/invite_code_repository";

const logger = createLogger("guest-token");

// Separate in-memory rate limiter: 10 guest-token requests per IP per hour.
const GUEST_RATE_WINDOW_MS = 60 * 60 * 1000;
const GUEST_RATE_MAX = 10;
const MAX_BUCKETS = 500;

interface RateBucket { count: number; windowStart: number; }
const guestBuckets = new Map<string, RateBucket>();

setInterval(() => {
  const now = Date.now();
  for (const [key, b] of guestBuckets) {
    if (now - b.windowStart > GUEST_RATE_WINDOW_MS * 2) guestBuckets.delete(key);
  }
}, 5 * 60 * 1000).unref();

function checkGuestRateLimit(ip: string): boolean {
  const now = Date.now();
  let b = guestBuckets.get(ip);
  if (!b || now - b.windowStart >= GUEST_RATE_WINDOW_MS) {
    b = { count: 0, windowStart: now };
    if (guestBuckets.size >= MAX_BUCKETS) {
      const oldest = [...guestBuckets.entries()].sort((a, c) => a[1].windowStart - c[1].windowStart)[0];
      if (oldest) guestBuckets.delete(oldest[0]);
    }
    guestBuckets.set(ip, b);
  }
  if (b.count >= GUEST_RATE_MAX) return false;
  b.count += 1;
  return true;
}

function clientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress ?? "unknown";
}

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

/**
 * GET /api/guest-token?code=XXXX
 *
 * Issues a short-lived legacy JWT for guest trial access.
 * Requires a valid invite code (checked against the invite_codes table).
 * Rate-limited per IP (10/hour).
 */
export async function handleGuestToken(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "GET") {
    jsonResponse(res, 405, { error: "Method not allowed" });
    return;
  }

  const ip = clientIp(req);
  if (!checkGuestRateLimit(ip)) {
    jsonResponse(res, 429, { error: "请求过于频繁，请稍后再试" });
    return;
  }

  const url = new URL(req.url ?? "", "http://localhost");
  const rawCode = (url.searchParams.get("code") ?? "").trim().toUpperCase();

  if (!rawCode) {
    jsonResponse(res, 400, { error: "缺少邀请码" });
    return;
  }

  // Validate against DB; fall back to allowing access if DB is unavailable
  // (so a DB outage doesn't lock everyone out of trial).
  if (isDbReady()) {
    const valid = await isCodeValidForTrial(rawCode).catch(() => true);
    if (!valid) {
      jsonResponse(res, 403, { error: "邀请码无效" });
      return;
    }
    // Fire-and-forget counter increment
    void incrementTrialUse(rawCode).catch(() => {});
  }

  const guestId = `guest-${crypto.randomUUID()}`;
  const TTL_SECONDS = 6 * 60 * 60; // 6 hours

  let token: string;
  try {
    token = generateToken(guestId);
  } catch {
    logger.error("REMI_AUTH_JWT_SECRET not configured");
    jsonResponse(res, 500, { error: "访客功能未配置" });
    return;
  }

  logger.info("issued guest token", { guestId, ip, code: rawCode });
  jsonResponse(res, 200, {
    token,
    guestId,
    expiresIn: TTL_SECONDS,
    messageCap: getConfig().REMI_GUEST_MESSAGE_CAP,
  });
}
