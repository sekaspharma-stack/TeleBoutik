import { getDeviceCode, type LocalTx } from './localDb';

/**
 * Numéro de ticket : AAAAMMJJ-APP-0042
 *  - AAAAMMJJ : jour de la vente (heure locale)
 *  - APP      : code de 3 caractères propre à l'appareil (créé au premier usage, jamais réutilisé)
 *  - 0042     : compteur séquentiel du jour, sur cet appareil
 *
 * Deux appareils hors ligne ne peuvent donc pas produire le même numéro. À appeler DANS la transaction
 * de la vente (tx) : le verrou local empêche deux ventes de prendre le même numéro.
 * Un index unique (idx_sales_ticket_number_unique) sert de dernier garde-fou.
 */
export async function nextTicketNumber(tx: Pick<LocalTx, 'queryOne' | 'execute'>, at: Date = new Date()): Promise<string> {
  const pad = (n: number, size = 2) => String(n).padStart(size, '0');
  const day = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`;
  const device = await getDeviceCode(tx);
  const prefix = `${day}-${device}-`;

  // Le compteur est le plus grand des deux : dernier numéro réellement vendu, ou dernier numéro attribué
  // (au cas où des ventes auraient été supprimées localement, par ex. après une réinitialisation).
  const sold = await tx.queryOne<{ n: number | string | null }>(
    "SELECT MAX(SUBSTRING(ticket_number FROM '-([0-9]+)$')::int) AS n FROM sales WHERE ticket_number LIKE $1",
    [`${prefix}%`]
  );
  const metaKey = `ticket_seq:${day}`;
  const meta = await tx.queryOne<{ value: string }>('SELECT value FROM app_meta WHERE key = $1', [metaKey]);
  const next = Math.max(Number(sold?.n ?? 0), Number(meta?.value ?? 0)) + 1;
  await tx.execute(
    'INSERT INTO app_meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
    [metaKey, String(next)]
  );
  return `${prefix}${pad(next, 4)}`;
}
