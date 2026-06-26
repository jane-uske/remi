import type { IncomingMessage, ServerResponse } from "node:http";

import { createLogger } from "../../infra/logger";
import { resolveRequestUserIdentity } from "../../infra/user_identity";
import { isDbReady } from "../../infra/app_state";
import { query } from "../../storage/database";
import {
  isCodeValidForRegistration,
  redeemCodeForRegistration,
  issueCodesForNewUser,
  getCodesIssuedTo,
  hasUserRedeemedCode,
  isUserCreatedBefore,
} from "../../storage/repositories/invite_code_repository";
import { getConfig } from "../config";

const logger = createLogger("invite-api");

// Instant the registration invite gate shipped (2026-06-26 ~18:17 CST). Accounts
// created before this are grandfathered — auto-verified by /api/invite/status —
// so a newly-added gate never walls people who were already using Remi. Only
// genuinely new accounts (created after launch) must redeem an invite code.
const INVITE_GATE_LAUNCH_ISO = "2026-06-26T10:17:00Z";

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

async function readJsonBody<T>(req: IncomingMessage, maxBytes = 4096): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) { req.destroy(); reject(new Error("Body too large")); }
      else chunks.push(chunk);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as T); }
      catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

/** Reject guest / dev sessions; return the real storage user ID. */
function requireRealUser(
  req: IncomingMessage,
  res: ServerResponse,
): string | null {
  const identity = resolveRequestUserIdentity(req);
  const subj = identity.authPrincipal?.subject ?? "";
  if (!identity.authPrincipal || subj.startsWith("guest-")) {
    jsonResponse(res, 401, { error: "登录用户才能访问此接口" });
    return null;
  }
  return identity.storageUserId;
}

/** Ensure the users row exists before we FK-reference it from invite_codes. */
async function ensureUserRow(userId: string): Promise<void> {
  await query(
    `INSERT INTO users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`,
    [userId],
  );
}

// ── GET /api/invite/status ─────────────────────────────────────────────────
// Returns { verified: true } if the current user has redeemed a registration code.
// Used by the client-side invite gate to decide whether to show the code-entry screen.

export async function handleInviteStatus(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "GET") { jsonResponse(res, 405, { error: "Method not allowed" }); return; }

  const userId = requireRealUser(req, res);
  if (!userId) return;

  if (!isDbReady()) {
    // DB unavailable → don't block the user (fail open)
    jsonResponse(res, 200, { verified: true });
    return;
  }

  try {
    // Grandfather pre-existing accounts so the gate can't lock out users who
    // were already on Remi before it shipped; only post-launch sign-ups must
    // redeem a code.
    const verified =
      (await hasUserRedeemedCode(userId)) ||
      (await isUserCreatedBefore(userId, INVITE_GATE_LAUNCH_ISO));
    jsonResponse(res, 200, { verified });
  } catch (err) {
    logger.warn("invite status check failed", { userId, err });
    jsonResponse(res, 200, { verified: true }); // fail open
  }
}

// ── POST /api/invite/redeem ────────────────────────────────────────────────
// Body: { code: string }
// Validates the code, marks it redeemed, and issues 2 new codes for the user.

export async function handleInviteRedeem(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "POST") { jsonResponse(res, 405, { error: "Method not allowed" }); return; }

  const userId = requireRealUser(req, res);
  if (!userId) return;

  if (!isDbReady()) {
    jsonResponse(res, 503, { error: "数据库暂时不可用，请稍后重试" });
    return;
  }

  let body: { code?: unknown };
  try { body = await readJsonBody(req); }
  catch { jsonResponse(res, 400, { error: "请求格式错误" }); return; }

  const rawCode = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  if (!rawCode) { jsonResponse(res, 400, { error: "邀请码不能为空" }); return; }

  try {
    // Idempotency: if already verified, just return their existing codes
    const alreadyVerified = await hasUserRedeemedCode(userId);
    if (alreadyVerified) {
      const existing = await getCodesIssuedTo(userId);
      jsonResponse(res, 200, {
        ok: true,
        alreadyVerified: true,
        codes: existing.map((c) => c.code),
      });
      return;
    }

    const valid = await isCodeValidForRegistration(rawCode);
    if (!valid) {
      jsonResponse(res, 403, { error: "邀请码无效或已被使用" });
      return;
    }

    await ensureUserRow(userId);
    const redeemed = await redeemCodeForRegistration(rawCode, userId);
    if (!redeemed) {
      // Race condition: someone else grabbed it between our check and the UPDATE
      jsonResponse(res, 409, { error: "邀请码刚刚被其他人使用，请换一个" });
      return;
    }

    const newCodes = await issueCodesForNewUser(userId);
    logger.info("invite code redeemed", { userId, code: rawCode });

    jsonResponse(res, 200, {
      ok: true,
      codes: newCodes.map((c) => c.code),
    });
  } catch (err) {
    logger.error("invite redeem failed", { userId, err });
    jsonResponse(res, 500, { error: "服务器错误，请稍后重试" });
  }
}

// ── GET /api/invite/my-codes ───────────────────────────────────────────────
// Returns the 2 shareable invite codes for the current user,
// along with their trial-use counts and shareable trial URLs.

export async function handleInviteMyCodes(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "GET") { jsonResponse(res, 405, { error: "Method not allowed" }); return; }

  const userId = requireRealUser(req, res);
  if (!userId) return;

  if (!isDbReady()) {
    jsonResponse(res, 503, { error: "数据库暂时不可用" });
    return;
  }

  try {
    const codes = await getCodesIssuedTo(userId);
    jsonResponse(res, 200, {
      codes: codes.map((c) => ({
        code: c.code,
        trialUses: c.trialUseCount,
        registerRedeemed: c.registerRedeemedByUserId !== null,
      })),
      messageCap: getConfig().REMI_GUEST_MESSAGE_CAP,
    });
  } catch (err) {
    logger.error("my-codes fetch failed", { userId, err });
    jsonResponse(res, 500, { error: "服务器错误" });
  }
}
