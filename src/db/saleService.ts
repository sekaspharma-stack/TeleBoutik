import { query, queryOne, execute, generateId, now } from './localDb';
import { addAuditLog, addSyncOp } from './audit';
import type { User, Store, Sale, SaleLine, SalePayment } from '../types';
import { generateTicketNumber } from '../lib/utils';

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
  }>;
  subtotal: number;
  discount: number;
  tax_amount: number;
  total: number;
  customer_id: string | null;
  customer_name: string;
  notes?: string | null;
}

export async function completeSale(
  input: CompleteSaleInput,
  user: User,
  store: Store,
  cashSessionId: string
): Promise<Sale> {
  const saleId = generateId();
  const ticketNumber = generateTicketNumber();

  const totalCost = input.items.reduce((sum, i) => sum + i.unit_cost * i.quantity, 0);

  await execute(
    `INSERT INTO sales (id, ticket_number, store_id, user_id, customer_id, subtotal, discount, tax_amount, total, total_cost, status, sale_date, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'completed', $11, $12)`,
    [saleId, ticketNumber, store.id, user.id, input.customer_id, input.subtotal, input.discount, input.tax_amount, input.total, totalCost, now(), input.notes ?? null]
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
      `INSERT INTO sale_payments (id, sale_id, payment_method, amount, reference)
       VALUES ($1, $2, $3, $4, $5)`,
      [generateId(), saleId, payment.payment_method, payment.amount, payment.reference]
    );

    if (payment.payment_method !== 'credit' && payment.payment_method !== 'voucher') {
      await execute(
        `INSERT INTO cash_movements (id, cash_session_id, movement_type, payment_method, amount, direction, reference_type, reference_id, user_id, reason, created_at)
         VALUES ($1, $2, 'sale', $3, $4, 'in', 'sale', $5, $6, 'Encaissement vente ${ticketNumber}', $7)`,
        [generateId(), cashSessionId, payment.payment_method, payment.amount, saleId, user.id, now()]
      );
    }
  }

  await execute(
    `INSERT INTO journal_entries (id, date, account_debit, account_credit, amount, description, reference_type, reference_id, user_id, created_at)
     VALUES ($1, $2, 'Caisse', 'Ventes', $3, 'Vente ticket ' || $4, 'sale', $5, $6, $7)`,
    [generateId(), now(), input.total, ticketNumber, saleId, user.id, now()]
  );

  await execute(
    `INSERT INTO journal_entries (id, date, account_debit, account_credit, amount, description, reference_type, reference_id, user_id, created_at)
     VALUES ($1, $2, 'COGS', 'Stock', $3, 'Coût marchandises vendues ticket ' || $4, 'sale', $5, $6, $7)`,
    [generateId(), now(), totalCost, ticketNumber, saleId, user.id, now()]
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
    sale_date: now(),
    notes: input.notes ?? null,
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
     VALUES ($1, $2, 'Ventes', 'Caisse', $3, 'Annulation vente ' || $4, 'sale_cancel', $5, $6, $7)`,
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
