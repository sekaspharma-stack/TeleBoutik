import { query, queryOne } from '../db/localDb';
import type { Sale, SaleLine } from '../types';

/**
 * Référence de reçu vérifiable : TB-AAMMJJ-XXXXXX-YYYYYY
 *  - AAMMJJ : date de la vente
 *  - XXXXXX : 6 caractères tirés de l'identifiant unique (UUID) de la vente → unicité
 *  - YYYYYY : empreinte SHA-256 (6 premiers caractères) du contenu du reçu
 *
 * L'empreinte complète est stockée avec la vente. Modifier après coup un montant,
 * une ligne ou la date change l'empreinte recalculée : la vérification détecte l'altération.
 *
 * Limite assumée : l'application fonctionne hors ligne dans le navigateur, donc la clé
 * de signature ne peut pas être totalement secrète. Pour une garantie « infalsifiable »
 * au sens strict, il faut signer côté serveur (voir les suggestions).
 */
const APP_SALT = 'teleboutik-receipt-v1';
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // sans I, L, O, U : lecture sans ambiguïté

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Repli (contexte non sécurisé) : double hachage FNV-1a 64 bits, moins robuste mais déterministe.
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (const b of bytes) { h1 = Math.imul(h1 ^ b, 0x01000193) >>> 0; h2 = Math.imul(h2 ^ b, 0x85ebca6b) >>> 0; }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).repeat(4);
}

function idPart(saleId: string): string {
  const hex = saleId.replace(/[^0-9a-f]/gi, '').toLowerCase().padEnd(12, '0');
  let out = '';
  for (let i = 0; i < 6; i++) out += ALPHABET[parseInt(hex.slice(i * 2, i * 2 + 2), 16) % 32];
  return out;
}

function datePart(saleDate: string): string {
  return saleDate.slice(2, 10).replace(/-/g, '');
}

type SaleCore = Pick<Sale, 'id' | 'ticket_number' | 'store_id' | 'sale_date' | 'subtotal' | 'discount' | 'tax_amount' | 'total'> & { currency_code?: string };
type LineCore = Pick<SaleLine, 'variant_id' | 'imei_unit_id' | 'quantity' | 'unit_price' | 'line_total'>;

function canonicalPayload(sale: SaleCore, lines: LineCore[]): string {
  // Les montants sont stockés en REAL (float32) : on normalise via fround avant de passer en centimes,
  // ainsi la valeur calculée à la vente et la valeur relue en base donnent exactement le même texte.
  const money = (n: number) => String(Math.round(Math.fround(Number(n) || 0) * 100));
  const lineText = lines
    .map((l) => `${l.variant_id}:${l.imei_unit_id ?? ''}:${Number(l.quantity)}:${money(l.unit_price)}:${money(l.line_total)}`)
    .sort()
    .join(';');
  return [
    APP_SALT, sale.store_id, sale.id, sale.ticket_number, sale.sale_date,
    money(sale.subtotal), money(sale.discount), money(sale.tax_amount), money(sale.total),
    sale.currency_code ?? '', lineText,
  ].join('|');
}

export async function buildReceiptSeal(sale: SaleCore, lines: LineCore[]): Promise<{ ref: string; hash: string }> {
  const hash = await sha256Hex(canonicalPayload(sale, lines));
  return { ref: `TB-${datePart(sale.sale_date)}-${idPart(sale.id)}-${hash.slice(0, 6).toUpperCase()}`, hash };
}

/** Normalise une saisie ou un scan : majuscules, sans espaces ni caractères invisibles. */
export function normalizeReceiptInput(value: string): string {
  return value.replace(/[\s\u200B-\u200D\uFEFF]/g, '').replace(/[–—−]/g, '-').toUpperCase();
}

export type ReceiptVerification =
  | { status: 'authentic'; sale: Sale }
  | { status: 'tampered'; sale: Sale }
  | { status: 'legacy'; sale: Sale }
  | { status: 'not_found' };

/** Retrouve un reçu par sa référence (ou, pour les anciens reçus, par son n° de ticket) et contrôle son intégrité. */
export async function verifyReceipt(input: string): Promise<ReceiptVerification> {
  const needle = normalizeReceiptInput(input);
  if (!needle) return { status: 'not_found' };
  const sale = await queryOne<Sale & { receipt_ref?: string; receipt_hash?: string }>(
    `SELECT * FROM sales WHERE UPPER(receipt_ref) = $1 OR UPPER(ticket_number) = $1 LIMIT 1`,
    [needle]
  );
  if (!sale) return { status: 'not_found' };
  if (!sale.receipt_ref || !sale.receipt_hash) return { status: 'legacy', sale };

  const lines = await query<SaleLine>('SELECT * FROM sale_lines WHERE sale_id = $1', [sale.id]);
  const seal = await buildReceiptSeal(sale, lines);
  const intact = seal.hash === sale.receipt_hash && seal.ref.toUpperCase() === sale.receipt_ref.toUpperCase();
  return { status: intact ? 'authentic' : 'tampered', sale };
}
