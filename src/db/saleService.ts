import { query, queryOne, execute, generateId, now } from './localDb';
import { addAuditLog, addSyncOp } from './audit';
import type { User, Store, Sale, SaleLine, SalePayment } from '../types';
import { generateTicketNumber } from '../lib/utils';
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
  subtotal: number;
  discount: number;
  tax_amount: number;
  total: number;
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
  if (input.items.length === 0) throw new Error('Le panier est vide.');

  // Garde-fou serveur-local : une unité IMEI ne peut être vendue qu'une seule fois,
  // même si deux validations arrivent presque en même temps.
  for (const item of input.items) {
    if (!item.imei_unit_id) continue;
    const unit = await queryOne<{ lifecycle_status: string; imei1: string }>('SELECT lifecycle_status, imei1 FROM imei_units WHERE id = $1', [item.imei_unit_id]);
    if (!unit) throw new Error('Unité IMEI introuvable.');
    if (unit.lifecycle_status !== 'in_stock') throw new Error(`L'IMEI ${unit.imei1} n'est plus en stock (déjà vendu ?). Retire-le du panier.`);
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
      subtotal: input.subtotal, discount: input.discount, tax_amount: input.tax_amount, total: input.total,
      currency_code: input.currency_code ?? store.currency,
    },
    input.items.map((i) => ({ variant_id: i.variant_id, imei_unit_id: i.imei_unit_id, quantity: i.quantity, unit_price: i.unit_price, line_total: i.unit_price * i.quantity - i.discount }))
  );

  const totalCost = input.items.reduce((sum, i) => sum + i.unit_cost * i.quantity, 0);

  await execute(
    `INSERT INTO sales (id, ticket_number, store_id, user_id, customer_id, subtotal, discount, tax_amount, total, total_cost, status, sale_date, notes, currency_code, exchange_rate, exchange_rate_buy, change_currency, change_amount, receipt_ref, receipt_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'completed', $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
    [saleId, ticketNumber, store.id, user.id, input.customer_id, input.subtotal, input.discount, input.tax_amount, input.total, totalCost, saleDate, input.notes ?? null, input.currency_code ?? store.currency, input.exchange_rate ?? 1, input.exchange_rate_buy ?? 1, input.change_currency ?? store.currency, input.change_amount ?? 0, seal.ref, seal.hash]
  );

  for (const item of input.items) {
    const lineId = generateId();
    const lineTotal = item.unit_price * item.quantity - item.discount;
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
    [generateId(), now(), input.total, `Vente ticket ${ticketNumber}`, saleId, user.id, now()]
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
    subtotal: input.subtotal,
    discount: input.discount,
    tax_amount: input.tax_amount,
    total: input.total,
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

export async function cancelSale(
  saleId: string,
  reason: string,
  user: User
): Promise<void> {
  const sale = await queryOne<Sale>('SELECT * FROM sales WHERE id = $1', [saleId]);
  if (!sale) throw new Error('Vente introuvable');
  if (sale.status === 'cancelled') throw new Error('Vente déjà annulée');

  await execute(
    `UPDATE sales SET status = 'cancelled' WHERE id = $1`,
    [saleId]
  );

  const lines = await query<SaleLine>('SELECT * FROM sale_lines WHERE sale_id = $1', [saleId]);
  for (const line of lines) {
    await execute(
      `INSERT INTO stock_movements (id, variant_id, imei_unit_id, movement_type, direction, quantity, unit_cost, reference_type, reference_id, user_id, reason, created_at)
       VALUES ($1, $2, $3, 'return', 'in', $4, $5, 'sale_cancel', $6, $7, 'Annulation vente', $8)`,
      [generateId(), line.variant_id, line.imei_unit_id, line.quantity, line.unit_cost, saleId, user.id, now()]
    );

    if (line.imei_unit_id) {
      await execute(
        `UPDATE imei_units SET lifecycle_status = 'in_stock', sold_at = NULL WHERE id = $1`,
        [line.imei_unit_id]
      );
    }
  }

  const payments = await query<SalePayment>('SELECT * FROM sale_payments WHERE sale_id = $1', [saleId]);
  for (const payment of payments) {
    if (payment.payment_method !== 'credit' && payment.payment_method !== 'voucher') {
      const session = await queryOne<{ id: string }>(
        `SELECT cs.id FROM cash_sessions cs 
         JOIN cash_movements cm ON cm.cash_session_id = cs.id 
         WHERE cm.reference_id = $1 AND cs.status = 'open' LIMIT 1`,
        [saleId]
      );
      if (session) {
        await execute(
          `INSERT INTO cash_movements (id, cash_session_id, movement_type, payment_method, amount, direction, reference_type, reference_id, user_id, reason, created_at)
           VALUES ($1, $2, 'adjustment', $3, $4, 'out', 'sale_cancel', $5, $6, 'Remboursement annulation', $7)`,
          [generateId(), session.id, payment.payment_method, payment.amount, saleId, user.id, now()]
        );
      }
    }
  }

  await execute(
    `INSERT INTO journal_entries (id, date, account_debit, account_credit, amount, description, reference_type, reference_id, user_id, created_at)
     VALUES ($1, $2, 'Ventes', 'Caisse', $3, 'Annulation vente $4', 'sale_cancel', $5, $6, $7)`,
    [generateId(), now(), sale.total, sale.ticket_number, saleId, user.id, now()]
  );

  await addAuditLog(user, 'sale', 'cancel', sale, { ...sale, status: 'cancelled', reason });
  await addSyncOp('sales', 'cancel', saleId, { reason });
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
