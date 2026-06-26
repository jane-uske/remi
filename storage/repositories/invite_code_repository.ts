import crypto from "node:crypto";
import { query } from "../database";

// ── Code generation ────────────────────────────────────────────────────────

// 32-char alphabet — no 0/O, 1/I/L to avoid visual confusion
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const CODES_PER_USER = 2;

export function generateInviteCode(): string {
  const bytes = crypto.randomBytes(Math.ceil((CODE_LENGTH * 5) / 8) + 1);
  let n = BigInt("0x" + bytes.toString("hex"));
  let result = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    result = CODE_ALPHABET[Number(n % BigInt(CODE_ALPHABET.length))] + result;
    n >>= 5n;
  }
  return result;
}

// ── Types ──────────────────────────────────────────────────────────────────

export type InviteCode = {
  id: string;
  code: string;
  issuedByUserId: string | null;
  registerRedeemedByUserId: string | null;
  registerRedeemedAt: Date | null;
  trialUseCount: number;
  createdAt: Date;
  revoked: boolean;
};

function mapRow(row: Record<string, unknown>): InviteCode {
  return {
    id: row.id as string,
    code: row.code as string,
    issuedByUserId: (row.issued_by_user_id as string | null) ?? null,
    registerRedeemedByUserId:
      (row.register_redeemed_by_user_id as string | null) ?? null,
    registerRedeemedAt:
      row.register_redeemed_at != null
        ? new Date(row.register_redeemed_at as string)
        : null,
    trialUseCount: row.trial_use_count as number,
    createdAt: new Date(row.created_at as string),
    revoked: row.revoked as boolean,
  };
}

// ── CRUD ───────────────────────────────────────────────────────────────────

export async function findInviteCode(code: string): Promise<InviteCode | null> {
  const res = await query(
    `SELECT * FROM invite_codes WHERE code = $1`,
    [code.trim().toUpperCase()],
  );
  if (!res.rows[0]) return null;
  return mapRow(res.rows[0] as Record<string, unknown>);
}

/** True if the code exists, is not revoked, and has not been used for registration. */
export async function isCodeValidForTrial(code: string): Promise<boolean> {
  const row = await findInviteCode(code);
  if (!row) return false;
  if (row.revoked) return false;
  return true; // trial use is always allowed (rate-limited at the gateway level)
}

/** True if the code exists, is not revoked, and has not yet been redeemed for registration. */
export async function isCodeValidForRegistration(code: string): Promise<boolean> {
  const row = await findInviteCode(code);
  if (!row) return false;
  if (row.revoked) return false;
  if (row.registerRedeemedByUserId != null) return false; // already claimed
  return true;
}

/** Increment the trial-use counter for a code. Fire-and-forget safe. */
export async function incrementTrialUse(code: string): Promise<void> {
  await query(
    `UPDATE invite_codes SET trial_use_count = trial_use_count + 1 WHERE code = $1`,
    [code.trim().toUpperCase()],
  );
}

/**
 * Atomically redeem a code for registration by `userId`.
 * Returns false if the code doesn't exist, is revoked, or was already redeemed.
 */
export async function redeemCodeForRegistration(
  code: string,
  userId: string,
): Promise<boolean> {
  const res = await query(
    `UPDATE invite_codes
     SET register_redeemed_by_user_id = $2,
         register_redeemed_at = now()
     WHERE code = $1
       AND revoked = FALSE
       AND register_redeemed_by_user_id IS NULL
     RETURNING id`,
    [code.trim().toUpperCase(), userId],
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * Check whether a user has already redeemed any invite code for registration.
 * Used by the invite gate: if true, the user can proceed to the app.
 */
export async function hasUserRedeemedCode(userId: string): Promise<boolean> {
  const res = await query(
    `SELECT 1 FROM invite_codes
     WHERE register_redeemed_by_user_id = $1
     LIMIT 1`,
    [userId],
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * True if the user's account was created before `cutoffIso`. Used to grandfather
 * pre-existing users past the registration invite gate: a gate shipped after
 * people were already using Remi must never lock those accounts out. Returns
 * false if the user row doesn't exist yet (brand-new account → must redeem).
 */
export async function isUserCreatedBefore(
  userId: string,
  cutoffIso: string,
): Promise<boolean> {
  const res = await query(
    `SELECT 1 FROM users WHERE id = $1 AND created_at < $2 LIMIT 1`,
    [userId, cutoffIso],
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * Issue CODES_PER_USER new invite codes for a user (called after successful registration).
 * Returns the generated codes.
 */
export async function issueCodesForNewUser(
  userId: string,
): Promise<InviteCode[]> {
  const codes: InviteCode[] = [];
  for (let i = 0; i < CODES_PER_USER; i++) {
    let inserted = false;
    while (!inserted) {
      const code = generateInviteCode();
      try {
        const res = await query(
          `INSERT INTO invite_codes (code, issued_by_user_id)
           VALUES ($1, $2)
           RETURNING *`,
          [code, userId],
        );
        if (res.rows[0]) {
          codes.push(mapRow(res.rows[0] as Record<string, unknown>));
          inserted = true;
        }
      } catch (err: unknown) {
        // Unique constraint violation → retry with a new code
        const pgErr = err as { code?: string };
        if (pgErr?.code !== "23505") throw err;
      }
    }
  }
  return codes;
}

/**
 * Return all codes issued TO a user (the codes they can share).
 * Excludes revoked codes; ordered by created_at.
 */
export async function getCodesIssuedTo(userId: string): Promise<InviteCode[]> {
  const res = await query(
    `SELECT * FROM invite_codes
     WHERE issued_by_user_id = $1
       AND revoked = FALSE
     ORDER BY created_at`,
    [userId],
  );
  return (res.rows as Record<string, unknown>[]).map(mapRow);
}

/**
 * Ensure seed codes exist (idempotent — skips codes that already exist).
 */
export async function seedInviteCodes(codes: string[]): Promise<void> {
  for (const raw of codes) {
    const code = raw.trim().toUpperCase();
    if (!code) continue;
    await query(
      `INSERT INTO invite_codes (code, issued_by_user_id)
       VALUES ($1, NULL)
       ON CONFLICT (code) DO NOTHING`,
      [code],
    ).catch(() => {}); // silently ignore other errors
  }
}
