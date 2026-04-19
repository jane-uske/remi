import { query } from '../database';
import { isPersonaPresetId, type PersonaPresetId } from '../../persona/presets';

export async function getUserPersonaPreset(
  userId: string,
): Promise<PersonaPresetId | null> {
  try {
    const res = await query(
      `SELECT preset_id FROM user_persona_presets WHERE user_id = $1 LIMIT 1`,
      [userId],
    );
    if (res.rows.length === 0) {
      return null;
    }
    const row = res.rows[0] as Record<string, unknown>;
    const presetId = row.preset_id as string | null | undefined;
    if (!presetId || !isPersonaPresetId(presetId)) {
      return null;
    }
    return presetId;
  } catch (e) {
    console.log('[Storage] getUserPersonaPreset failed:', e);
    throw e;
  }
}

export async function saveUserPersonaPreset(
  userId: string,
  presetId: PersonaPresetId,
): Promise<void> {
  try {
    // Contract: the caller must ensure the user row already exists.
    await query(
      `INSERT INTO user_persona_presets (
         user_id,
         preset_id
       )
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET
         preset_id = EXCLUDED.preset_id`,
      [userId, presetId],
    );
  } catch (e) {
    console.log('[Storage] saveUserPersonaPreset failed:', e);
    throw e;
  }
}
