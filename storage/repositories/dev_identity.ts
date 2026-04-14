import { query } from "../database";
import { DEV_STORAGE_USER_ID, normalizeToStorageUserId } from "../../infra/user_identity";

export function getDevUserId(): string {
  return normalizeToStorageUserId(process.env.DEV_USER_ID?.trim());
}

export async function ensureStorageUser(userId: string): Promise<string> {
  await query(
    `INSERT INTO users (id)
     VALUES ($1)
     ON CONFLICT (id) DO NOTHING`,
    [normalizeToStorageUserId(userId)],
  );
  return normalizeToStorageUserId(userId);
}

export async function ensureDevUser(): Promise<string> {
  const userId = getDevUserId();
  return ensureStorageUser(userId);
}
