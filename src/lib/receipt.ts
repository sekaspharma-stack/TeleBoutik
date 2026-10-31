import { query, queryOne } from '../db/localDb';
import type { Sale, SaleLine } from '../types';

/**
 * Référence de reçu vérifiable : TB2-AAMMJJ-XXXXXX-YYYYYY
 *  - TB2 : version 2 du sceau (couvre aussi paiements, monnaie rendue, client, vendeur). « TB- » = ancien sceau → « legacy »
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
const APP_SALT = 'teleboutik-receipt-v2';
const SEAL_PREFIX = 'TB2';
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

type SaleCore = Pick<Sale, 'id' | 'ticket_number' | 'store_id' | 'sale_date' | 'subtotal' | 'discount' | 'tax_amount' | 'total'> & {
  currency_code?: string;
  /** Client et vendeur affichés sur le ticket. */
  customer_id?: string | null;
  user_id?: string | null;
  /** Taux et monnaie rendue affichés sur le ticket. */
  exchange_rate?: number;
  exchange_rate_buy?: number;
  change_currency?: string;
  change_amount?: number;
};
type LineCore = Pick<SaleLine, 'variant_id' | 'imei_unit_id' | 'quantity' | 'unit_price' | 'line_total'>;
export type PaymentCore = {
  payment_method: string;
  amount: number;
  reference?: string | null;
  currency_code?: string | null;
  original_amount?: number | null;
  applied_rate?: number | null;
};

// Les montants sont en NUMERIC(14,2) : on les compare en centimes entiers, les taux avec 6 décimales.
const money = (n: unknown) => String(Math.round((Number(n) || 0) * 100));
const rate = (n: unknown) => (Number(n) || 0).toFixed(6);

function canonicalPayload(sale: SaleCore, lines: LineCore[], payments: PaymentCore[]): string {
  const lineText = lines
    .map((l) => `${l.variant_id}:${l.imei_unit_id ?? ''}:${Number(l.quantity)}:${money(l.unit_price)}:${money(l.line_total)}`)
    .sort()
    .join(';');
  // Paiements : mode, devise, montant en devise de la vente, montant d'origine, taux appliqué, référence (encodée).
  const paymentText = payments
    .map((p) => [
      p.payment_method, p.currency_code ?? '', money(p.amount), money(p.original_amount ?? p.amount), rate(p.applied_rate ?? 1), encodeURIComponent(p.reference ?? ''),
    ].join(':'))
    .sort()
    .join(';');
  return [
    APP_SALT, sale.store_id, sale.id, sale.ticket_number, sale.sale_date,
    money(sale.subtotal), money(sale.discount), money(sale.tax_amount), money(sale.total),
    sale.currency_code ?? '', lineText,
    // v2 : ce qui s'affiche aussi sur le ticket
    paymentText,
    sale.change_currency ?? '', money(sale.change_amount ?? 0), rate(sale.exchange_rate ?? 1), rate(sale.exchange_rate_buy ?? 1),
    sale.customer_id ?? '', sale.user_id ?? '',
  ].join('|');
}

export async function buildReceiptSeal(sale: SaleCore, lines: LineCore[], payments: PaymentCore[]): Promise<{ ref: string; hash: string }> {
  const hash = await sha256Hex(canonicalPayload(sale, lines, payments));
  return { ref: `${SEAL_PREFIX}-${datePart(sale.sale_date)}-${idPart(sale.id)}-${hash.slice(0, 6).toUpperCase()}`, hash };
}

/** Normalise une saisie ou un scan : majuscules, sans espaces ni caractères invisibles. */
export function normalizeReceiptInput(value: string): string {
  return value.replace(/[\s\u200B-\u200D\uFEFF]/g, '').replace(/[–—−]/g, '-').toUpperCase();
}

export type ReceiptVerification =
  | { status: 'authentic'; sale: Sale }
  | { status: 'tampered'; sale: Sale }
  | { status: 'legacy'; sale: Sale }
  /** Plusieurs ventes portent ce n° de ticket (anciens tickets en doublon) : il faut la référence complète. */
  | { status: 'ambiguous'; sales: Sale[] }
  | { status: 'not_found' };

type StoredSale = Sale & { receipt_ref?: string; receipt_hash?: string };

/** Contrôle l'intégrité d'une vente déjà identifiée (aucune recherche par n° de ticket, donc aucune confusion possible). */
export async function verifySaleRecord(sale: StoredSale): Promise<Exclude<ReceiptVerification, { status: 'ambiguous' } | { status: 'not_found' }>> {
  // Reçu sans sceau, ou scellé avec l'ancienne version (« TB- ») : on ne peut pas le certifier.
  if (!sale.receipt_ref || !sale.receipt_hash || !sale.receipt_ref.toUpperCase().startsWith(`${SEAL_PREFIX}-`)) return { status: 'legacy', sale };

  const lines = await query<SaleLine>('SELECT * FROM sale_lines WHERE sale_id = $1', [sale.id]);
  const payments = await query<PaymentCore>('SELECT payment_method, amount, reference, currency_code, original_amount, applied_rate FROM sale_payments WHERE sale_id = $1', [sale.id]);
  const seal = await buildReceiptSeal(sale, lines, payments);
  const intact = seal.hash === sale.receipt_hash && seal.ref.toUpperCase() === sale.receipt_ref.toUpperCase();
  return { status: intact ? 'authentic' : 'tampered', sale };
}

/** Retrouve un reçu par sa référence (ou, pour les anciens reçus, par son n° de ticket) et contrôle son intégrité. */
export async function verifyReceipt(input: string): Promise<ReceiptVerification> {
  const needle = normalizeReceiptInput(input);
  if (!needle) return { status: 'not_found' };

  // 1) Référence complète : unique par construction (UUID de la vente + empreinte).
  const byRef = await queryOne<StoredSale>('SELECT * FROM sales WHERE UPPER(receipt_ref) = $1 LIMIT 1', [needle]);
  if (byRef) return verifySaleRecord(byRef);

  // 2) N° de ticket : on ne devine jamais. Si plusieurs ventes le portent, on le dit au lieu d'en afficher une au hasard.
  const byTicket = await query<StoredSale>('SELECT * FROM sales WHERE UPPER(ticket_number) = $1 ORDER BY sale_date LIMIT 6', [needle]);
  if (byTicket.length === 0) return { status: 'not_found' };
  if (byTicket.length > 1) return { status: 'ambiguous', sales: byTicket };
  return verifySaleRecord(byTicket[0]);
}
