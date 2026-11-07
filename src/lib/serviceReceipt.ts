import { queryOne } from '../db/localDb';
import { formatDateTime, paymentLabel } from './utils';
import type { ReceiptData } from './receiptPrinter';

/** Données brutes d'un reçu de service (Unités/Megas, Airtel Money, SIM…). Les montants sont des nombres. */
export type ServiceReceiptInput = {
  /** Titre du document, ex. « REÇU UNITÉS AIRTEL ». */
  title: string;
  /** Numéro affiché sur la ligne « Ticket » (la référence de l'opération). */
  ticket: string;
  /** Date ISO de l'opération. */
  date: string;
  sellerName: string;
  customerName: string;
  details?: Array<{ label: string; value: string }>;
  lines: Array<{ name: string; qty: number | string; unitPrice: number; total: number }>;
  currency: string;
  total: number;
  /** Paiements reçus. `labelOverride` remplace le libellé du mode de paiement (ex. « Espèces remises »). */
  payments: Array<{ method: string; currency?: string; amount: number; labelOverride?: string }>;
  /** Montant rendu au client ; omis (ou null) pour masquer la ligne « Rendu ». */
  change?: number | null;
  warning: string;
  cancelled?: boolean;
};

export const SERVICE_WARNING_DEFAULT = 'Vérifier le reçu car le service vendu n’est ni échangé ni remboursé';

const num = (n: number, cur: string) => new Intl.NumberFormat('fr-FR', {
  minimumFractionDigits: cur === 'CDF' ? 0 : (n % 1 === 0 ? 0 : 2),
  maximumFractionDigits: cur === 'CDF' ? 0 : 2,
}).format(n).replace(/[\u00a0\u202f]/g, ' ');
const short = (n: number, cur: string) => `${num(n, cur)}${cur === 'USD' ? '$' : cur === 'EUR' ? '€' : ' ' + cur}`;
const full = (n: number, cur: string) => `${num(n, cur)} ${cur}`;

/** Même mise en forme que le ticket de caisse (« 175$ » pour les lignes, « 175 USD » pour les totaux). */
export function toReceiptData(
  input: ServiceReceiptInput,
  store: { name: string; phone?: string; footer_text?: string },
  rccm: string,
): ReceiptData {
  const customFooter = (store.footer_text || '').trim();
  const footer = !customFooter || /^merci de votre visite\s*!?$/i.test(customFooter) ? `${store.name} vous remercie !` : customFooter;
  const cur = input.currency;
  return {
    storeName: store.name,
    rccm,
    phone: store.phone || '',
    title: input.title,
    ticket: input.ticket,
    ref: '',
    date: formatDateTime(input.date),
    seller: input.sellerName,
    customer: input.customerName || 'Client comptoir',
    details: input.details,
    lines: input.lines.map((l) => ({ name: l.name, qty: String(l.qty), unit: short(l.unitPrice, cur), total: short(l.total, cur) })),
    subtotal: full(input.total, cur),
    total: full(input.total, cur),
    payments: input.payments.map((p) => {
      const c = p.currency || cur;
      return { label: p.labelOverride || `${paymentLabel(p.method)} (${c})`, amount: full(p.amount, c) };
    }),
    change: input.change == null ? '' : full(input.change, cur),
    warning: input.warning,
    footer,
  };
}

export async function getUserName(userId: string | null | undefined): Promise<string> {
  if (!userId) return '';
  const row = await queryOne<{ name: string }>('SELECT name FROM users WHERE id = $1', [userId]).catch(() => null);
  return row?.name ?? '';
}
