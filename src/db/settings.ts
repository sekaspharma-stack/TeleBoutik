import { query, settingRowId } from './localDb';
import { scheduleLocalTableSync } from './syncEngine';

/**
 * Enregistre un réglage avec un identifiant FIXE (« setting:<clé> »), identique sur tous les appareils.
 * Avant, chaque appareil créait sa propre ligne (id aléatoire) pour la même clé : doublons dans le cloud
 * et conflit avec la contrainte UNIQUE(key) à la synchronisation.
 */
export async function saveSetting(key: string, value: string): Promise<void> {
  const rows = await query<{ id: string }>(
    `INSERT INTO settings (id, key, value) VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
     RETURNING id`,
    [settingRowId(key), key, value]
  );
  scheduleLocalTableSync('settings', rows[0]?.id ?? settingRowId(key), 'upsert');
}

/** Supprime des réglages (localement et dans le cloud). */
export async function deleteSettings(keys: string[]): Promise<void> {
  for (const key of keys) {
    const rows = await query<{ id: string }>('DELETE FROM settings WHERE key = $1 RETURNING id', [key]);
    scheduleLocalTableSync('settings', rows[0]?.id ?? settingRowId(key), 'delete');
  }
}
