import { query } from "../database";

export type UserAuthIdentityInput = {
  userId: string;
  provider: string;
  providerUserId: string;
  email?: string | null;
};

export async function ensureUserAuthIdentity(input: UserAuthIdentityInput): Promise<string> {
  await query(
    `INSERT INTO users (id)
     VALUES ($1)
     ON CONFLICT (id) DO NOTHING`,
    [input.userId],
  );

  const result = await query(
    `INSERT INTO user_auth_identities (
       user_id,
       provider,
       provider_user_id,
       email
     )
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (provider, provider_user_id)
     DO UPDATE SET
       email = COALESCE(EXCLUDED.email, user_auth_identities.email),
       last_seen_at = now()
     RETURNING user_id`,
    [input.userId, input.provider, input.providerUserId, input.email ?? null],
  );

  const row = result.rows[0] as { user_id?: string } | undefined;
  return row?.user_id ?? input.userId;
}
