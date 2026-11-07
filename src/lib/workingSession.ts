import { query, queryOne } from '../db/localDb';
import type { CashSession } from '../types';

export type WorkingSession = CashSession & { user_name: string | null };

/** Compat : l'ancien sélecteur de caisse n'existe plus (une seule caisse commune). */
export function setPreferredSession(_id: string): void { /* sans effet */ }

/**
 * LA caisse commune du magasin : la session ouverte (la plus récente), quel que soit l'utilisateur qui l'a ouverte.
 * Tous les utilisateurs (propriétaire, gérant, vendeurs) travaillent sur cette même caisse.
 */
export async function getSharedOpenSession(storeId?: string | null): Promise<WorkingSession | null> {
  return queryOne<WorkingSession>(
    `SELECT cs.*, u.name AS user_name FROM cash_sessions cs LEFT JOIN users u ON u.id = cs.user_id
     WHERE cs.status = 'open' ${storeId ? 'AND cs.store_id = $1' : ''} ORDER BY cs.opened_at DESC LIMIT 1`,
    storeId ? [storeId] : []
  );
}

/** Toutes les sessions encore ouvertes (normalement une seule ; plusieurs = reliquat d'avant la caisse commune). */
export async function listOpenSessions(storeId?: string | null): Promise<WorkingSession[]> {
  return query<WorkingSession>(
    `SELECT cs.*, u.name AS user_name FROM cash_sessions cs LEFT JOIN users u ON u.id = cs.user_id
     WHERE cs.status = 'open' ${storeId ? 'AND cs.store_id = $1' : ''} ORDER BY cs.opened_at DESC`,
    storeId ? [storeId] : []
  );
}

/** Utilisée par les écrans de service (Unités/Megas, Airtel Money, SIM). */
export async function resolveWorkingSession(_user: { id: string; role: string }, storeId?: string | null): Promise<{ session: WorkingSession | null; options: WorkingSession[] }> {
  const session = await getSharedOpenSession(storeId ?? null);
  return { session, options: session ? [session] : [] };
}
