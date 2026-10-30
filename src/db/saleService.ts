import { query, queryOne, execute, generateId, now } from './localDb';
import { addAuditLog, addSyncOp } from './audit';
import type { User, Store, Sale, SaleLine, SalePayment } from '../types';
import { generateTicketNumber, maxDiscount } from '../lib/utils';
import { buildReceiptSeal } from '../lib/receipt';

export interface CompleteSaleInput {
  items: Array<{
    variant_id: string;
    imei_unit_id: string | null;
    product_name: string;
    quantity: number;
    unit_price: number;
    unit_cost: number;
    discount: number;
  }>;
  payments: Array<{
    payment_method: SalePayment['payment_method'];
    amount: number;
    reference: string | null;
    currency_code?: string;
    original_amount?: number;
    applied_rate?: number;
  }>;
  /** Ignoré : le sous-total est recalculé par le service à partir des lignes. */
  subtotal?: number;
  /** Remise globale du panier (les remises de ligne sont dans items[].discount). */
  discount: number;
  /** Ignoré : la taxe est recalculée par le service à partir de la configuration du magasin. */
  tax_amount?: number;
  /** Ignoré : le total est recalculé par le service. */
  total?: number;
  /** Id d'une approbation gérant/propriétaire (manager_approvals, action 'sale_discount'), exigée si la remise dépasse le maximum du vendeur. */
  discount_approval_id?: string | null;
  customer_id: string | null;
  customer_name: string;
  notes?: string | null;
  currency_code?: string;
  exchange_rate?: number;
  exchange_rate_buy?: number;
  change_currency?: string;
  change_amount?: number;
}

export async function completeSale(
  input: CompleteSaleInput,
  user: User,
  store: Store,
  cashSessionId: string
): Promise<Sale> {
  // PGlite conserve une connexion locale : BEGIN/COMMIT englobent toutes les écritures,
  // y compris le journal d'audit et la file de synchronisation.
  const { beginLocalTransaction, commitLocalTransaction, rollbackLocalTransaction } = await import('./localDb');
  await beginLocalTransaction();
  try {
    const result = await completeSaleInTransaction(input, user, store, cashSessionId);
    await commitLocalTransaction();
    return result;
  } catch (error) {
    try { await rollbackLocalTransaction(); } catch { /* préserver l'erreur initiale */ }
    throw error;
  }
}

const EPS = 0.01;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const PAYMENT_METHODS = new Set(['cash', 'airtel_money', 'orange_money', 'mtn_momo', 'vodacom_money', 'wave', 'card', 'transfer', 'credit', 'voucher']);
const NON_CASH_REGISTER_METHODS = new Set(['credit', 'voucher']);

/** Montant de monnaie rendue exprimé dans la devise de la vente (même formule à la vente et à l'annulation). */
function changeInSaleCurrency(changeAmount: number, changeCurrency: string, rateBuy: number): number {
  return changeCurrency === 'CDF' && rateBuy > 0 ? changeAmount / rateBuy : changeAmount;
}

export interface PricedSale {
  lines: Array<{ gross: number; lineTotal: number }>;
  gross: number;
  lineDiscounts: number;
  globalDiscount: number;
  subtotal: number;
  taxAmount: number;
  total: number;
  discountPercent: number;
}

/** Calcul de référence des totaux (même logique que le panier, mais exécutée côté service). */
export function priceSale(
  items: Array<{ quantity: number; unit_price: number; discount: number }>,
  globalDiscount: number,
  store: { tax_enabled: boolean; tax_rate: number }
): PricedSale {
  const lines = items.map((i) => {
    const gross = round2(i.unit_price * i.quantity);
    return { gross, lineTotal: round2(gross - i.discount) };
  });
  const gross = round2(lines.reduce((s, l) => s + l.gross, 0));
  const lineDiscounts = round2(items.reduce((s, i) => s + i.discount, 0));
  const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  const netBeforeTax = Math.max(0, round2(subtotal - globalDiscount));
  const taxAmount = store.tax_enabled ? round2(netBeforeTax * Number(store.tax_rate) / 100) : 0;
  const total = round2(netBeforeTax + taxAmount);
  const discountPercent = gross > 0 ? ((lineDiscounts + globalDiscount) / gross) * 100 : 0;
  return { lines, gross, lineDiscounts, globalDiscount, subtotal, taxAmount, total, discountPercent };
}

/** Retourne true si la remise a nécessité (et consommé) une approbation. */
async function assertDiscountAuthorized(input: CompleteSaleInput, priced: PricedSale, user: User, store: Store): Promise<boolean> {
  if (priced.discountPercent <= EPS / 100) return false;
  const sellerMax = Number(store.max_seller_discount ?? 5);
  const managerMax = Number(store.max_manager_discount ?? 10);
  const ownLimit = maxDiscount(user.role, sellerMax, managerMax);
  if (priced.discountPercent <= ownLimit + 0.0001) return false;

  const label = `${priced.discountPercent.toFixed(2)} %`;
  if (!input.discount_approval_id) {
    throw new Error(`Remise de ${label} supérieure à votre limite de ${ownLimit} %. L'autorisation d'un gérant ou du propriétaire est obligatoire.`);
  }
  const approval = await queryOne<{ id: string; store_id: string; action: string; target_id: string | null; requested_by: string; approved_by: string }>(
    'SELECT id, store_id, action, target_id, requested_by, approved_by FROM manager_approvals WHERE id = $1',
    [input.discount_approval_id]
  );
  if (!approval || approval.action !== 'sale_discount' || approval.store_id !== store.id || approval.requested_by !== user.id) {
    throw new Error('Autorisation de remise invalide pour ce vendeur ou ce magasin.');
  }
  if (approval.target_id) throw new Error('Cette autorisation de remise a déjà été utilisée pour une autre vente.');
  const approver = await queryOne<{ id: string; role: string; active: boolean }>('SELECT id, role, active FROM users WHERE id = $1', [approval.approved_by]);
  if (!approver || !approver.active || !['owner', 'manager'].includes(approver.role) || approver.id === user.id) {
    throw new Error('L\u2019approbateur de la remise n\u2019est pas autorisé.');
  }
  const approverLimit = maxDiscount(approver.role, sellerMax, managerMax);
  if (priced.discountPercent > approverLimit + 0.0001) {
    throw new Error(`Remise de ${label} supérieure au maximum que cet approbateur peut accorder (${approverLimit} %).`);
  }
  return true;
}

async function completeSaleInTransaction(
  input: CompleteSaleInput,
  userArg: User,
  storeArg: Store,
  cashSessionId: string
): Promise<Sale> {
  // Les valeurs de l'interface peuvent être périmées : on relit le magasin et le rôle de l'utilisateur en base.
  const store = (await queryOne<Store>('SELECT * FROM stores WHERE id = $1', [storeArg.id])) ?? storeArg;
  const dbUser = await queryOne<{ role: User['role']; active: boolean }>('SELECT role, active FROM users WHERE id = $1', [userArg.id]);
  if (dbUser && !dbUser.active) throw new Error('Cet utilisateur est désactivé : vente refusée.');
  const user: User = dbUser ? { ...userArg, role: dbUser.role } : userArg;

  if (!Array.isArray(input.items) || input.items.length === 0) throw new Error('Le panier est vide.');

  // La session de caisse doit être ouverte et appartenir au magasin de la vente.
  const session = await queryOne<{ id: string; store_id: string; status: string }>('SELECT id, store_id, status FROM cash_sessions WHERE id = $1', [cashSessionId]);
  if (!session) throw new Error('Session de caisse introuvable.');
  if (session.status !== 'open') throw new Error('La session de caisse est clôturée : ouvre une caisse avant de vendre.');
  if (session.store_id !== store.id) throw new Error('Cette session de caisse appartient à un autre magasin.');

  // --- Contrôle des lignes ---
  const globalDiscount = Number(input.discount ?? 0);
  if (!Number.isFinite(globalDiscount) || globalDiscount < 0) throw new Error('Remise globale invalide.');
  const requestedByVariant = new Map<string, number>();
  const seenUnits = new Set<string>();
  for (const item of input.items) {
    const label = item.product_name || item.variant_id;
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) throw new Error(`Quantité invalide pour « ${label} » (entier positif requis).`);
    if (!Number.isFinite(item.unit_price) || item.unit_price < 0) throw new Error(`Prix unitaire invalide pour « ${label} ».`);
    if (!Number.isFinite(item.discount) || item.discount < 0) throw new Error(`Remise invalide pour « ${label} ».`);
    if (item.discount > round2(item.unit_price * item.quantity) + EPS) {
      throw new Error(`La remise de « ${label} » dépasse le montant de la ligne.`);
    }
    const variant = await queryOne<{ id: string; is_serialized: boolean }>(
      'SELECT pv.id, p.is_serialized FROM product_variants pv JOIN products p ON p.id = pv.product_id WHERE pv.id = $1',
      [item.variant_id]
    );
    if (!variant) throw new Error(`Article introuvable : « ${label} ».`);
    if (variant.is_serialized) {
      if (!item.imei_unit_id) throw new Error(`« ${label} » est un article sérialisé : choisis une unité IMEI.`);
      if (item.quantity !== 1) throw new Error(`« ${label} » est sérialisé : la quantité doit être 1 par unité IMEI.`);
    }
    if (item.imei_unit_id) {
      if (seenUnits.has(item.imei_unit_id)) throw new Error('La même unité IMEI apparaît deux fois dans le panier.');
      seenUnits.add(item.imei_unit_id);
      // Garde-fou : une unité IMEI ne peut être vendue qu'une seule fois, même si deux validations arrivent presque en même temps.
      const unit = await queryOne<{ lifecycle_status: string; imei1: string; variant_id: string }>('SELECT lifecycle_status, imei1, variant_id FROM imei_units WHERE id = $1', [item.imei_unit_id]);
      if (!unit) throw new Error('Unité IMEI introuvable.');
      if (unit.variant_id !== item.variant_id) throw new Error(`L'IMEI ${unit.imei1} n'appartient pas à l'article « ${label} ».`);
      if (unit.lifecycle_status !== 'in_stock') throw new Error(`L'IMEI ${unit.imei1} n'est plus en stock (déjà vendu ?). Retire-le du panier.`);
    } else {
      requestedByVariant.set(item.variant_id, (requestedByVariant.get(item.variant_id) ?? 0) + item.quantity);
    }
  }

  // Stock suffisant pour les articles non sérialisés (quantités cumulées si l'article est sur plusieurs lignes).
  for (const [variantId, wanted] of requestedByVariant) {
    const row = await queryOne<{ qty: number | string }>(
      "SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN quantity ELSE -quantity END), 0) AS qty FROM stock_movements WHERE variant_id = $1",
      [variantId]
    );
    const available = Number(row?.qty ?? 0);
    if (available < wanted) {
      const name = input.items.find((i) => i.variant_id === variantId)?.product_name ?? variantId;
      throw new Error(`Stock insuffisant pour « ${name} » : ${available} disponible(s), ${wanted} demandé(s).`);
    }
  }

  // --- Totaux recalculés côté service ---
  const priced = priceSale(input.items, globalDiscount, store);
  if (globalDiscount > priced.subtotal + EPS) throw new Error('La remise globale dépasse le montant du panier.');
  if (
    (input.total !== undefined && Math.abs(input.total - priced.total) > EPS) ||
    (input.subtotal !== undefined && Math.abs(input.subtotal - priced.subtotal) > EPS)
  ) {
    console.warn('[completeSale] Totaux du panier différents du recalcul service ; valeurs du service retenues.', { cart: { subtotal: input.subtotal, total: input.total }, service: { subtotal: priced.subtotal, total: priced.total } });
  }
  const approvalUsed = await assertDiscountAuthorized(input, priced, user, store);

  // --- Paiements ---
  if (priced.total > EPS && (!Array.isArray(input.payments) || input.payments.length === 0)) throw new Error('Aucun paiement saisi.');
  let paidTotal = 0;
  let cashTotal = 0;
  for (const p of input.payments ?? []) {
    if (!PAYMENT_METHODS.has(p.payment_method)) throw new Error(`Mode de paiement inconnu : ${p.payment_method}.`);
    if (!Number.isFinite(p.amount) || p.amount <= 0) throw new Error('Montant de paiement invalide.');
    if (p.original_amount !== undefined && (!Number.isFinite(p.original_amount) || p.original_amount < 0)) throw new Error('Montant d\u2019origine du paiement invalide.');
    if (p.applied_rate !== undefined && (!Number.isFinite(p.applied_rate) || p.applied_rate <= 0)) throw new Error('Taux appliqué du paiement invalide.');
    if (p.payment_method === 'credit' && !input.customer_id) throw new Error('Une vente à crédit exige un client : sélectionne un client.');
    paidTotal += p.amount;
    if (p.payment_method === 'cash') cashTotal += p.amount;
  }
  paidTotal = round2(paidTotal);
  if (paidTotal + EPS < priced.total) {
    throw new Error(`Paiements insuffisants : ${paidTotal} saisi(s) pour un total de ${priced.total}.`);
  }
  const changeAmount = Number(input.change_amount ?? 0);
  if (!Number.isFinite(changeAmount) || changeAmount < 0) throw new Error('Monnaie rendue invalide.');
  if (changeAmount > 0) {
    if (cashTotal <= 0) throw new Error('De la monnaie ne peut être rendue que sur un paiement en espèces.');
    const changeBase = changeInSaleCurrency(changeAmount, input.change_currency ?? store.currency, input.exchange_rate_buy ?? 0);
    if (changeBase > cashTotal + EPS) throw new Error('La monnaie rendue dépasse les espèces encaissées.');
  }

  const saleId = generateId();
  let ticketNumber = generateTicketNumber();
  for (let attempt = 0; attempt < 8; attempt++) {
    const clash = await queryOne<{ id: string }>('SELECT id FROM sales WHERE ticket_number = $1 LIMIT 1', [ticketNumber]);
    if (!clash) break;
    ticketNumber = generateTicketNumber();
  }
  const saleDate = now();
  const seal = await buildReceiptSeal(
    {
      id: saleId, ticket_number: ticketNumber, store_id: store.id, sale_date: saleDate,
      subtotal: priced.subtotal, discount: globalDiscount, tax_amount: priced.taxAmount, total: priced.total,
      currency_code: input.currency_code ?? store.currency,
    },
    input.items.map((i, idx) => ({ variant_id: i.variant_id, imei_unit_id: i.imei_unit_id, quantity: i.quantity, unit_price: i.unit_price, line_total: priced.lines[idx].lineTotal }))
  );

  // L'autorisation de remise est à usage unique : on la rattache à cette vente.
  if (approvalUsed && input.discount_approval_id) {
    await execute('UPDATE manager_approvals SET target_id = $1 WHERE id = $2 AND target_id IS NULL', [saleId, input.discount_approval_id]);
  }

  const totalCost = input.items.reduce((sum, i) => sum + i.unit_cost * i.quantity, 0);

  await execute(
    `INSERT INTO sales (id, ticket_number, store_id, user_id, customer_id, subtotal, discount, tax_amount, total, total_cost, status, sale_date, notes, currency_code, exchange_rate, exchange_rate_buy, change_currency, change_amount, receipt_ref, receipt_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'completed', $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
    [saleId, ticketNumber, store.id, user.id, input.customer_id, priced.subtotal, globalDiscount, priced.taxAmount, priced.total, totalCost, saleDate, input.notes ?? null, input.currency_code ?? store.currency, input.exchange_rate ?? 1, input.exchange_rate_buy ?? 1, input.change_currency ?? store.currency, input.change_amount ?? 0, seal.ref, seal.hash]
  );

  for (const [lineIdx, item] of input.items.entries()) {
    const lineId = generateId();
    const lineTotal = priced.lines[lineIdx].lineTotal;
    await execute(
      `INSERT INTO sale_lines (id, sale_id, variant_id, imei_unit_id, product_name, quantity, unit_price, unit_cost, discount, line_total)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [lineId, saleId, item.variant_id, item.imei_unit_id, item.product_name, item.quantity, item.unit_price, item.unit_cost, item.discount, lineTotal]
    );

    await execute(
      `INSERT INTO stock_movements (id, variant_id, imei_unit_id, movement_type, direction, quantity, unit_cost, reference_type, reference_id, user_id, reason, created_at)
       VALUES ($1, $2, $3, 'sale', 'out', $4, $5, 'sale', $6, $7, 'Vente ticket ${ticketNumber}', $8)`,
      [generateId(), item.variant_id, item.imei_unit_id, item.quantity, item.unit_cost, saleId, user.id, now()]
    );

    if (item.imei_unit_id) {
      await execute(
        `UPDATE imei_units SET lifecycle_status = 'sold', sold_at = $1 WHERE id = $2`,
        [now(), item.imei_unit_id]
      );
    }
  }

  for (const payment of input.payments) {
    await execute(
      `INSERT INTO sale_payments (id, sale_id, payment_method, amount, reference, currency_code, original_amount, applied_rate)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [generateId(), saleId, payment.payment_method, payment.amount, payment.reference, payment.currency_code ?? store.currency, payment.original_amount ?? payment.amount, payment.applied_rate ?? 1]
    );

    if (payment.payment_method !== 'credit' && payment.payment_method !== 'voucher') {
      await execute(
        `INSERT INTO cash_movements (id, cash_session_id, movement_type, payment_method, amount, direction, reference_type, reference_id, user_id, reason, created_at, currency_code, original_amount, applied_rate)
         VALUES ($1, $2, 'sale', $3, $4, 'in', 'sale', $5, $6, 'Encaissement vente ${ticketNumber}', $7, $8, $9, $10)`,
        [generateId(), cashSessionId, payment.payment_method, payment.amount, saleId, user.id, now(), payment.currency_code ?? store.currency, payment.original_amount ?? payment.amount, payment.applied_rate ?? 1]
      );
    }
  }

  // Une vente à crédit devient une dette traçable, sans créer de dette si aucun client n'est sélectionné.
  if (input.customer_id) {
    for (const payment of input.payments.filter((p) => p.payment_method === 'credit' && p.amount > 0)) {
      await execute(
        `INSERT INTO customer_debt_ledger (id,store_id,customer_id,sale_id,entry_type,amount,currency_code,due_date,reference,notes,created_by)
         VALUES ($1,$2,$3,$4,'debt',$5,$6,($7::date + INTERVAL '30 days')::date::text,$8,$9,$10)`,
        [generateId(), store.id, input.customer_id, saleId, payment.amount, payment.currency_code ?? input.currency_code ?? store.currency, saleDate.slice(0,10), ticketNumber, 'Dette créée à la vente', user.id]
      );
    }
  }

  if ((input.change_amount ?? 0) > 0 && input.payments.some((p) => p.payment_method === 'cash')) {
    const changeCurrency = input.change_currency ?? store.currency;
    const changeBaseAmount = changeCurrency === 'CDF' && (input.exchange_rate_buy ?? 0) > 0
      ? (input.change_amount ?? 0) / (input.exchange_rate_buy as number)
      : (input.change_amount ?? 0);
    await execute(
      `INSERT INTO cash_movements (id, cash_session_id, movement_type, payment_method, amount, direction, reference_type, reference_id, user_id, reason, created_at, currency_code, original_amount, applied_rate)
       VALUES ($1, $2, 'adjustment', 'cash', $3, 'out', 'sale_change', $4, $5, $6, $7, $8, $9, $10)`,
      [generateId(), cashSessionId, changeBaseAmount, saleId, user.id, `Monnaie rendue ticket ${ticketNumber}`, now(), changeCurrency, input.change_amount, changeCurrency === 'CDF' ? (input.exchange_rate_buy ?? 1) : 1]
    );
  }

  await execute(
    `INSERT INTO journal_entries (id, date, account_debit, account_credit, amount, description, reference_type, reference_id, user_id, created_at)
     VALUES ($1, $2, 'Caisse', 'Ventes', $3, $4, 'sale', $5, $6, $7)`,
    [generateId(), now(), priced.total, `Vente ticket ${ticketNumber}`, saleId, user.id, now()]
  );

  await execute(
    `INSERT INTO journal_entries (id, date, account_debit, account_credit, amount, description, reference_type, reference_id, user_id, created_at)
     VALUES ($1, $2, 'COGS', 'Stock', $3, $4, 'sale', $5, $6, $7)`,
    [generateId(), now(), totalCost, `Coût marchandises vendues ticket ${ticketNumber}`, saleId, user.id, now()]
  );

  const saleData: Sale = {
    id: saleId,
    ticket_number: ticketNumber,
    store_id: store.id,
    user_id: user.id,
    customer_id: input.customer_id,
    subtotal: priced.subtotal,
    discount: globalDiscount,
    tax_amount: priced.taxAmount,
    total: priced.total,
    total_cost: totalCost,
    status: 'completed',
    sale_date: saleDate,
    notes: input.notes ?? null,
    currency_code: input.currency_code ?? store.currency,
    exchange_rate: input.exchange_rate ?? 1,
    exchange_rate_buy: input.exchange_rate_buy ?? 1,
    change_currency: input.change_currency ?? store.currency,
    change_amount: input.change_amount ?? 0,
    receipt_ref: seal.ref,
    receipt_hash: seal.hash,
  };

  await addAuditLog(user, 'sale', 'create', null, saleData);
  await addSyncOp('sales', 'insert', saleId, saleData);

  return saleData;
}

export interface CancelSaleResult {
  /** Session de caisse dans laquelle le remboursement a été enregistré (null si rien à rembourser en caisse). */
  refundSessionId: string | null;
  /** Avertissements à montrer à l'utilisateur (ex. session d'origine clôturée). */
  warnings: string[];
}

export async function cancelSale(
  saleId: string,
  reason: string,
  user: User
): Promise<CancelSaleResult> {
  const { beginLocalTransaction, commitLocalTransaction, rollbackLocalTransaction } = await import('./localDb');
  await beginLocalTransaction();
  try {
    const result = await cancelSaleInTransaction(saleId, reason, user);
    await commitLocalTransaction();
    return result;
  } catch (error) {
    try { await rollbackLocalTransaction(); } catch { /* préserver l'erreur initiale */ }
    throw error;
  }
}

async function cancelSaleInTransaction(saleId: string, reason: string, user: User): Promise<CancelSaleResult> {
  if (!reason?.trim()) throw new Error('Le motif de l’annulation est obligatoire.');
  if (!['owner', 'manager'].includes(user.role)) throw new Error('Vous n’êtes pas autorisé à annuler une vente.');
  const sale = await queryOne<Sale>('SELECT * FROM sales WHERE id = $1', [saleId]);
  if (!sale) throw new Error('Vente introuvable');
  if (sale.status === 'cancelled') throw new Error('Cette vente est déjà annulée. Aucune écriture supplémentaire n’a été créée.');
  if (sale.status !== 'completed' && sale.status !== 'on_credit') throw new Error('Seules les ventes terminées ou à crédit peuvent être annulées.');
  // Garde-fous d’idempotence : ne jamais recréer les retours de stock ou écritures comptables.
  const priorCancellation = await queryOne<{id:string}>("SELECT id FROM stock_movements WHERE reference_type='sale_cancel' AND reference_id=$1 LIMIT 1", [saleId]);
  const priorJournal = await queryOne<{id:string}>("SELECT id FROM journal_entries WHERE reference_type='sale_cancel' AND reference_id=$1 LIMIT 1", [saleId]);
  if (priorCancellation || priorJournal) throw new Error('Des écritures d’annulation existent déjà alors que la vente est active. Vérification requise : aucune écriture supplémentaire n’a été créée.');

  const refund = await planCashRefund(sale, user);

  // Transition conditionnelle pour bloquer une double annulation.
  await execute(`UPDATE sales SET status = 'cancelled' WHERE id = $1 AND status IN ('completed','on_credit')`, [saleId]);
  const current = await queryOne<Sale>('SELECT * FROM sales WHERE id=$1', [saleId]);
  if (!current || current.status !== 'cancelled') throw new Error('La vente a été modifiée par une autre opération. Recharge la liste et réessaie.');

  const lines = await query<SaleLine>('SELECT * FROM sale_lines WHERE sale_id = $1', [saleId]);
  if (lines.length === 0) throw new Error('Annulation interrompue : aucune ligne de vente trouvée. Aucune écriture ne doit être validée.');
  for (const line of lines) {
    if (!Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0) throw new Error('Quantité de vente invalide : annulation interrompue.');
    await execute(
      `INSERT INTO stock_movements (id, variant_id, imei_unit_id, movement_type, direction, quantity, unit_cost, reference_type, reference_id, user_id, reason, created_at)
       VALUES ($1, $2, $3, 'return', 'in', $4, $5, 'sale_cancel', $6, $7, 'Annulation vente', $8)`,
      [generateId(), line.variant_id, line.imei_unit_id, line.quantity, line.unit_cost, saleId, user.id, now()]
    );

    if (line.imei_unit_id) {
      await execute(
        `UPDATE imei_units SET lifecycle_status = 'in_stock', sold_at = NULL WHERE id = $1 AND lifecycle_status IN ('sold','in_stock')`,
        [line.imei_unit_id]
      );
    }
  }

  // Contrepasser les dettes à crédit liées à cette vente pour éviter un solde client fantôme.
  const debts = await query<{id:string;store_id:string;customer_id:string;amount:number;currency_code:string;reference:string}>(
    "SELECT id,store_id,customer_id,amount,currency_code,reference FROM customer_debt_ledger WHERE sale_id=$1 AND entry_type='debt'",
    [saleId]
  );
  for (const debt of debts) {
    const alreadyReversed = await queryOne<{id:string}>(
      "SELECT id FROM customer_debt_ledger WHERE sale_id=$1 AND entry_type='payment' AND reference=$2 LIMIT 1",
      [saleId, `Annulation ${debt.reference} ${debt.id}`]
    );
    if (!alreadyReversed) {
      await execute(
        `INSERT INTO customer_debt_ledger (id,store_id,customer_id,sale_id,entry_type,amount,currency_code,reference,notes,created_by,created_at) VALUES ($1,$2,$3,$4,'payment',$5,$6,$7,$8,$9,$10)`,
        [generateId(),debt.store_id,debt.customer_id,saleId,debt.amount,debt.currency_code,`Annulation ${debt.reference} ${debt.id}`,'Contrepassation automatique de la dette après annulation',user.id,now()]
      );
    }
  }

  // Remboursement en caisse : paiement moins monnaie rendue, dans la session ouverte, avec devise et taux d'origine.
  for (const line of refund.lines) {
    await execute(
      `INSERT INTO cash_movements (id, cash_session_id, movement_type, payment_method, amount, direction, reference_type, reference_id, user_id, reason, created_at, currency_code, original_amount, applied_rate)
       VALUES ($1, $2, 'adjustment', $3, $4, 'out', 'sale_cancel', $5, $6, $7, $8, $9, $10, $11)`,
      [generateId(), refund.sessionId, line.payment_method, line.amount, saleId, user.id, refund.reason, now(), line.currency_code, line.original_amount, line.applied_rate]
    );
  }

  await execute(
    `INSERT INTO journal_entries (id, date, account_debit, account_credit, amount, description, reference_type, reference_id, user_id, created_at)
     VALUES ($1, $2, 'Ventes', 'Caisse', $3, $4, 'sale_cancel', $5, $6, $7)`,
    [generateId(), now(), sale.total, `Annulation vente ${sale.ticket_number}`, saleId, user.id, now()]
  );

  await addAuditLog(user, 'sale', 'cancel', sale, { ...sale, status: 'cancelled', reason, refund_session_id: refund.sessionId, refund_warnings: refund.warnings });
  await addSyncOp('sales', 'cancel', saleId, { reason });
  return { refundSessionId: refund.lines.length ? refund.sessionId : null, warnings: refund.warnings };
}

interface CashRefundPlan {
  sessionId: string | null;
  reason: string;
  warnings: string[];
  lines: Array<{ payment_method: string; amount: number; currency_code: string; original_amount: number; applied_rate: number }>;
}

/**
 * Calcule les sorties de caisse de l'annulation et choisit la session où les enregistrer.
 * - Remboursement = paiement − monnaie rendue (la monnaie est déjà sortie de la caisse à la vente).
 * - Crédit et bon n'ont jamais touché la caisse : aucun remboursement.
 * - La session cible doit être ouverte : session d'origine si elle l'est encore, sinon la caisse ouverte
 *   de l'utilisateur, sinon l'unique caisse ouverte du magasin. Sinon l'annulation est refusée.
 * - Si la session d'origine est clôturée, l'annulation est autorisée mais signalée (message + motif du mouvement + audit).
 */
async function planCashRefund(sale: Sale, user: User): Promise<CashRefundPlan> {
  const payments = await query<SalePayment>('SELECT * FROM sale_payments WHERE sale_id = $1', [sale.id]);
  const cashPayments = payments.filter((p) => !NON_CASH_REGISTER_METHODS.has(p.payment_method) && Number(p.amount) > 0);

  // Monnaie rendue : on prend ce qui est réellement sorti de la caisse, sinon la valeur enregistrée sur la vente.
  const changeRow = await queryOne<{ total: number | string | null }>(
    "SELECT SUM(amount) AS total FROM cash_movements WHERE reference_type = 'sale_change' AND reference_id = $1 AND direction = 'out'",
    [sale.id]
  );
  let remainingChange = changeRow?.total != null
    ? Number(changeRow.total)
    : changeInSaleCurrency(Number(sale.change_amount ?? 0), sale.change_currency ?? '', Number(sale.exchange_rate_buy ?? 0));

  const lines: CashRefundPlan['lines'] = [];
  for (const p of payments) {
    if (!cashPayments.includes(p)) continue;
    const amount = Number(p.amount);
    // La monnaie ne peut venir que d'un paiement en espèces.
    const deduct = p.payment_method === 'cash' ? Math.min(remainingChange, amount) : 0;
    remainingChange -= deduct;
    const net = round2(amount - deduct);
    if (net <= 0) continue;
    const ratio = amount > 0 ? Number(p.original_amount || amount) / amount : 1;
    lines.push({
      payment_method: p.payment_method,
      amount: net,
      currency_code: p.currency_code || sale.currency_code || 'USD',
      original_amount: round2(net * ratio),
      applied_rate: Number(p.applied_rate ?? 1) || 1,
    });
  }

  const warnings: string[] = [];
  if (lines.length === 0) return { sessionId: null, reason: '', warnings, lines };

  const origin = await queryOne<{ id: string; status: string }>(
    `SELECT cs.id, cs.status FROM cash_movements cm JOIN cash_sessions cs ON cs.id = cm.cash_session_id
     WHERE cm.reference_type = 'sale' AND cm.reference_id = $1 ORDER BY cm.created_at LIMIT 1`,
    [sale.id]
  );

  let target: { id: string } | null = null;
  if (origin?.status === 'open') target = { id: origin.id };
  if (!target) target = await queryOne<{ id: string }>(
    "SELECT id FROM cash_sessions WHERE status = 'open' AND store_id = $1 AND user_id = $2 ORDER BY opened_at DESC LIMIT 1",
    [sale.store_id, user.id]
  );
  if (!target) {
    const open = await query<{ id: string }>("SELECT id FROM cash_sessions WHERE status = 'open' AND store_id = $1 ORDER BY opened_at DESC", [sale.store_id]);
    if (open.length === 1) target = open[0];
    else if (open.length > 1) throw new Error('Plusieurs caisses sont ouvertes : ouvre ta propre caisse pour enregistrer le remboursement de cette annulation.');
  }
  if (!target) throw new Error('Annulation refusée : aucune session de caisse ouverte. Ouvre une caisse pour enregistrer le remboursement, puis réessaie.');

  let reason = `Remboursement annulation vente ${sale.ticket_number}`;
  if (origin && origin.status !== 'open') {
    warnings.push(`La session de caisse d'origine de cette vente est clôturée : le remboursement a été enregistré dans la session ouverte en cours (${target.id}).`);
    reason += ` — session d'origine ${origin.id} clôturée`;
  }
  return { sessionId: target.id, reason, warnings, lines };
}

export async function getSaleById(saleId: string): Promise<Sale | null> {
  return queryOne<Sale>('SELECT * FROM sales WHERE id = $1', [saleId]);
}

export async function getSaleLines(saleId: string): Promise<SaleLine[]> {
  return query<SaleLine>('SELECT * FROM sale_lines WHERE sale_id = $1', [saleId]);
}

export async function getSalePayments(saleId: string): Promise<SalePayment[]> {
  return query<SalePayment>('SELECT * FROM sale_payments WHERE sale_id = $1', [saleId]);
}
