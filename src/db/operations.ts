import { execute, query, queryOne, generateId, now } from './localDb';

export async function createWarranty(input: { storeId: string; saleId: string; saleLineId?: string | null; imeiUnitId?: string | null; customerId?: string | null; startDate: string; durationMonths: number; terms?: string; createdBy: string }) {
  if (!Number.isInteger(input.durationMonths) || input.durationMonths < 0 || input.durationMonths > 120) throw new Error('Durée de garantie invalide.');
  const end = new Date(`${input.startDate}T12:00:00`);
  end.setMonth(end.getMonth() + input.durationMonths);
  const id = generateId();
  await execute(`INSERT INTO warranty_records (id,store_id,sale_id,sale_line_id,imei_unit_id,customer_id,start_date,end_date,duration_months,terms,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [id,input.storeId,input.saleId,input.saleLineId ?? null,input.imeiUnitId ?? null,input.customerId ?? null,input.startDate,end.toISOString().slice(0,10),input.durationMonths,input.terms ?? '',input.createdBy]);
  return queryOne('SELECT * FROM warranty_records WHERE id=$1', [id]);
}

export async function recordRepair(input: { storeId: string; imeiUnitId?: string | null; imei: string; customerId?: string | null; saleId?: string | null; problem: string; diagnosis?: string; repairAction?: string; partsCost?: number; laborCost?: number; technician?: string; createdBy: string }) {
  if (!input.imei.trim() || !input.problem.trim()) throw new Error('IMEI et description de la panne obligatoires.');
  const id = generateId();
  await execute(`INSERT INTO repair_records (id,store_id,imei_unit_id,imei,customer_id,sale_id,received_at,problem,diagnosis,repair_action,parts_cost,labor_cost,technician,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [id,input.storeId,input.imeiUnitId ?? null,input.imei,input.customerId ?? null,input.saleId ?? null,now(),input.problem,input.diagnosis ?? '',input.repairAction ?? '',input.partsCost ?? 0,input.laborCost ?? 0,input.technician ?? '',input.createdBy]);
  return queryOne('SELECT * FROM repair_records WHERE id=$1', [id]);
}

export async function addDebtEntry(input: { storeId: string; customerId: string; saleId?: string | null; type: 'debt'|'payment'|'adjustment'; amount: number; currency: string; dueDate?: string | null; reference?: string; notes?: string; createdBy: string }) {
  if (!(input.amount > 0) || !Number.isFinite(input.amount)) throw new Error('Le montant doit être supérieur à zéro.');
  const id = generateId();
  await execute(`INSERT INTO customer_debt_ledger (id,store_id,customer_id,sale_id,entry_type,amount,currency_code,due_date,reference,notes,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [id,input.storeId,input.customerId,input.saleId ?? null,input.type,input.amount,input.currency,input.dueDate ?? null,input.reference ?? '',input.notes ?? '',input.createdBy]);
  return queryOne('SELECT * FROM customer_debt_ledger WHERE id=$1', [id]);
}

export async function getDebtBalances(storeId: string) {
  return query<{customer_id:string;name:string;phone:string;currency_code:string;balance:number;oldest_due_date:string|null}>(`SELECT d.customer_id,c.name,c.phone,d.currency_code,SUM(CASE WHEN d.entry_type='payment' THEN -d.amount ELSE d.amount END) AS balance,MIN(d.due_date) FILTER (WHERE d.entry_type='debt' AND d.due_date < CURRENT_DATE::text) AS oldest_due_date FROM customer_debt_ledger d JOIN customers c ON c.id=d.customer_id WHERE d.store_id=$1 GROUP BY d.customer_id,c.name,c.phone,d.currency_code HAVING SUM(CASE WHEN d.entry_type='payment' THEN -d.amount ELSE d.amount END)>0 ORDER BY oldest_due_date NULLS LAST`, [storeId]);
}

export async function getWarrantyExpirations(storeId: string, days = 30) {
  return query(`SELECT w.*, c.name AS customer_name, c.phone, i.imei1 FROM warranty_records w LEFT JOIN customers c ON c.id=w.customer_id LEFT JOIN imei_units i ON i.id=w.imei_unit_id WHERE w.store_id=$1 AND w.status='active' AND w.end_date <= (CURRENT_DATE + ($2::text || ' days')::interval)::text ORDER BY w.end_date`, [storeId, String(days)]);
}

export type RestockRow = { id: string; variant_id: string; brand: string; model: string; sku: string; is_serialized: boolean; current_stock: number; minimum_stock: number; suggested_quantity: number; status: 'open' | 'ordered'; created_at: string };

/**
 * Recalcule les suggestions de réassort.
 * - Téléphones (IMEI) : stock = unités réellement « in_stock » (comme l'écran Stock).
 * - Accessoires : somme des mouvements de stock.
 * - Les suggestions devenues inutiles (stock remonté au-dessus du minimum) sont retirées : elles restaient affichées à tort.
 * - Un article déjà « commandé » n'est plus re-suggéré tant que la commande n'est pas marquée reçue.
 */
export async function suggestRestock(storeId: string): Promise<RestockRow[]> {
  const stock = await query<{ variant_id: string; quantity: number | string; min_stock: number | string }>(
    `SELECT pv.id AS variant_id, pv.min_stock AS min_stock,
            CASE WHEN p.is_serialized
                 THEN (SELECT COUNT(*) FROM imei_units iu WHERE iu.variant_id = pv.id AND iu.lifecycle_status = 'in_stock')
                 ELSE COALESCE((SELECT SUM(CASE WHEN sm.direction='in' THEN sm.quantity ELSE -sm.quantity END) FROM stock_movements sm WHERE sm.variant_id = pv.id), 0)
            END AS quantity
     FROM product_variants pv JOIN products p ON p.id = pv.product_id
     WHERE pv.min_stock > 0`
  );
  const ordered = new Set((await query<{ variant_id: string }>(`SELECT variant_id FROM stock_restock_suggestions WHERE store_id=$1 AND status='ordered'`, [storeId])).map(r => r.variant_id));
  const low = stock
    .map(r => ({ variant_id: r.variant_id, quantity: Math.max(0, Number(r.quantity) || 0), min_stock: Number(r.min_stock) || 0 }))
    .filter(r => r.quantity < r.min_stock && !ordered.has(r.variant_id));
  const lowIds = new Set(low.map(r => r.variant_id));

  for (const item of low) {
    const qty = Math.max(1, item.min_stock * 2 - item.quantity);
    await execute(
      `INSERT INTO stock_restock_suggestions (id,store_id,variant_id,current_stock,minimum_stock,suggested_quantity,status) VALUES ($1,$2,$3,$4,$5,$6,'open')
       ON CONFLICT (store_id,variant_id,status) DO UPDATE SET current_stock=EXCLUDED.current_stock,minimum_stock=EXCLUDED.minimum_stock,suggested_quantity=EXCLUDED.suggested_quantity`,
      [generateId(), storeId, item.variant_id, item.quantity, item.min_stock, qty]
    );
  }
  const open = await query<{ id: string; variant_id: string }>(`SELECT id, variant_id FROM stock_restock_suggestions WHERE store_id=$1 AND status='open'`, [storeId]);
  for (const row of open) if (!lowIds.has(row.variant_id)) await execute('DELETE FROM stock_restock_suggestions WHERE id=$1', [row.id]);

  return query<RestockRow>(
    `SELECT s.id, s.variant_id, p.brand, p.model, pv.sku, p.is_serialized, s.current_stock, s.minimum_stock, s.suggested_quantity, s.status, s.created_at
     FROM stock_restock_suggestions s JOIN product_variants pv ON pv.id = s.variant_id JOIN products p ON p.id = pv.product_id
     WHERE s.store_id=$1 AND s.status IN ('open','ordered')
     ORDER BY s.status, (s.minimum_stock - s.current_stock) DESC`, [storeId]
  );
}

/** Marque une suggestion « commandée » (remplace une éventuelle commande précédente du même article). */
export async function markRestockOrdered(id: string) {
  const row = await queryOne<{ store_id: string; variant_id: string }>('SELECT store_id, variant_id FROM stock_restock_suggestions WHERE id=$1', [id]);
  if (!row) return;
  await execute(`DELETE FROM stock_restock_suggestions WHERE store_id=$1 AND variant_id=$2 AND status='ordered'`, [row.store_id, row.variant_id]);
  await execute(`UPDATE stock_restock_suggestions SET status='ordered', created_at=CURRENT_TIMESTAMP WHERE id=$1`, [id]);
}

/** Commande reçue ou abandonnée : la ligne disparaît, l'article pourra être re-suggéré s'il reste sous le minimum. */
export async function clearRestockSuggestion(id: string) {
  await execute('DELETE FROM stock_restock_suggestions WHERE id=$1', [id]);
}

export async function getMarginByProduct(storeId: string, fromDate: string, toDate: string) {
  return query(`SELECT sl.variant_id,sl.product_name,SUM(sl.quantity) AS quantity,SUM(sl.line_total) AS revenue,SUM(sl.unit_cost*sl.quantity) AS cost,SUM(sl.line_total-sl.unit_cost*sl.quantity) AS margin FROM sale_lines sl JOIN sales s ON s.id=sl.sale_id WHERE s.store_id=$1 AND s.status<>'cancelled' AND s.sale_date::date BETWEEN $2::date AND $3::date GROUP BY sl.variant_id,sl.product_name ORDER BY margin DESC`, [storeId,fromDate,toDate]);
}

export async function approveSensitiveAction(input: { storeId: string; action: string; targetId?: string | null; requesterId: string; managerPin: string; reason: string }) {
  const { findUsersByPin, migratePlainPins } = await import('./pinGuard');
  await migratePlainPins();
  const manager = await query<{id:string;role:string;pin:string}>('SELECT id,role,pin FROM users WHERE active=true AND role IN (\'owner\',\'manager\')');
  const matches = await findUsersByPin(manager, input.managerPin);
  if (matches.length === 0) throw new Error('PIN du gérant/propriétaire incorrect.');
  // Si deux comptes partagent ce PIN, on retient celui qui n'est pas le demandeur.
  const approver = matches.find((m) => m.id !== input.requesterId);
  if (!approver) throw new Error('Une deuxième personne autorisée doit valider cette opération.');
  const id = generateId();
  await execute('INSERT INTO manager_approvals (id,store_id,action,target_id,requested_by,approved_by,reason) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id,input.storeId,input.action,input.targetId ?? null,input.requesterId,approver.id,input.reason]);
  return { id, approvedBy: approver.id };
}

export async function getConsolidatedSales(fromDate: string, toDate: string) {
  return query(`SELECT s.store_id, st.name AS store_name, COUNT(*)::int AS sale_count, SUM(s.total) AS revenue, SUM(s.total_cost) AS cost, SUM(s.total-s.total_cost) AS margin FROM sales s LEFT JOIN stores st ON st.id=s.store_id WHERE s.status<>'cancelled' AND s.sale_date::date BETWEEN $1::date AND $2::date GROUP BY s.store_id,st.name ORDER BY revenue DESC`, [fromDate,toDate]);
}

/** Confirmation renforcée réservée au propriétaire pour les annulations de vente. */
export async function approveOwnerSensitiveAction(input: { storeId: string; action: string; targetId?: string | null; requesterId: string; ownerPin: string; reason: string }) {
  const { findUsersByPin, migratePlainPins } = await import('./pinGuard');
  if (!input.ownerPin?.trim()) throw new Error('PIN du propriétaire obligatoire.');
  await migratePlainPins();
  const owners = await query<{id:string;role:string;pin:string}>("SELECT id,role,pin FROM users WHERE active=true AND role='owner'");
  const matches = await findUsersByPin(owners, input.ownerPin);
  if (matches.length === 0) throw new Error('PIN du propriétaire incorrect.');
  const owner = matches.find((m) => m.id !== input.requesterId);
  if (!owner) throw new Error('Le propriétaire peut confirmer directement sans seconde validation.');
  const existing = await queryOne<{id:string}>('SELECT id FROM manager_approvals WHERE store_id=$1 AND action=$2 AND target_id=$3 AND requested_by=$4', [input.storeId,input.action,input.targetId ?? null,input.requesterId]);
  if (existing) return { id: existing.id, approvedBy: owner.id };
  const id = generateId();
  await execute('INSERT INTO manager_approvals (id,store_id,action,target_id,requested_by,approved_by,reason) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id,input.storeId,input.action,input.targetId ?? null,input.requesterId,owner.id,input.reason]);
  return { id, approvedBy: owner.id };
}

// ───────────── Garanties ─────────────
export type SaleOption = { id: string; ticket_number: string; sale_date: string; total: number; currency_code: string; customer_id: string | null; customer_name: string | null };
export type SaleImeiOption = { imei_unit_id: string; imei1: string; product_name: string; sale_line_id: string };
export type WarrantyListRow = { id: string; sale_id: string; imei_unit_id: string | null; customer_id: string | null; start_date: string; end_date: string; duration_months: number; terms: string; status: string; customer_name: string | null; phone: string | null; imei1: string | null; ticket_number: string | null };

export async function listRecentSales(storeId: string, limit = 60) {
  return query<SaleOption>(
    `SELECT s.id, s.ticket_number, s.sale_date, s.total, s.currency_code, s.customer_id, c.name AS customer_name
     FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
     WHERE s.store_id=$1 AND s.status <> 'cancelled' ORDER BY s.sale_date DESC LIMIT $2`, [storeId, limit]);
}

export async function getSaleImeis(saleId: string) {
  return query<SaleImeiOption>(
    `SELECT sl.imei_unit_id, i.imei1, sl.product_name, sl.id AS sale_line_id
     FROM sale_lines sl JOIN imei_units i ON i.id = sl.imei_unit_id WHERE sl.sale_id=$1`, [saleId]);
}

export async function listWarranties(storeId: string) {
  return query<WarrantyListRow>(
    `SELECT w.id, w.sale_id, w.imei_unit_id, w.customer_id, w.start_date, w.end_date, w.duration_months, w.terms, w.status,
            c.name AS customer_name, c.phone, i.imei1, s.ticket_number
     FROM warranty_records w
     LEFT JOIN customers c ON c.id = w.customer_id
     LEFT JOIN imei_units i ON i.id = w.imei_unit_id
     LEFT JOIN sales s ON s.id = w.sale_id
     WHERE w.store_id=$1 ORDER BY w.end_date DESC LIMIT 300`, [storeId]);
}

export async function setWarrantyStatus(id: string, status: 'active' | 'claimed' | 'void') {
  await execute('UPDATE warranty_records SET status=$1 WHERE id=$2', [status, id]);
}

/** Garantie encore valable pour cet IMEI (aujourd'hui), ou null. Sert au SAV pour savoir si la réparation est sous garantie. */
export async function findActiveWarrantyByImei(storeId: string, imei: string, today: string) {
  const clean = imei.trim();
  if (!clean) return null;
  return queryOne<{ id: string; end_date: string; customer_name: string | null }>(
    `SELECT w.id, w.end_date, c.name AS customer_name
     FROM warranty_records w JOIN imei_units i ON i.id = w.imei_unit_id LEFT JOIN customers c ON c.id = w.customer_id
     WHERE w.store_id=$1 AND w.status='active' AND w.end_date >= $3 AND (i.imei1=$2 OR i.imei2=$2) ORDER BY w.end_date DESC LIMIT 1`, [storeId, clean, today]);
}

// ───────────── Dettes ─────────────
export type DebtLedgerRow = { id: string; entry_type: 'debt' | 'payment' | 'adjustment'; amount: number; currency_code: string; due_date: string | null; reference: string; notes: string; created_at: string };

export async function getDebtHistory(storeId: string, customerId: string, currency: string) {
  return query<DebtLedgerRow>(
    `SELECT id, entry_type, amount, currency_code, due_date, reference, notes, created_at
     FROM customer_debt_ledger WHERE store_id=$1 AND customer_id=$2 AND currency_code=$3 ORDER BY created_at DESC LIMIT 100`, [storeId, customerId, currency]);
}

/** Garde une trace de chaque relance ouverte (WhatsApp/SMS) dans le registre debt_reminders. */
export async function logDebtReminder(input: { storeId: string; customerId: string; channel: 'sms' | 'whatsapp' | 'manual'; message: string; createdBy: string }) {
  await execute(
    `INSERT INTO debt_reminders (id,store_id,customer_id,channel,scheduled_at,sent_at,status,message,created_by) VALUES ($1,$2,$3,$4,$5,$5,'sent',$6,$7)`,
    [generateId(), input.storeId, input.customerId, input.channel, now(), input.message, input.createdBy]);
}

export async function getLastReminders(storeId: string) {
  return query<{ customer_id: string; last_at: string }>(
    `SELECT customer_id, MAX(sent_at) AS last_at FROM debt_reminders WHERE store_id=$1 GROUP BY customer_id`, [storeId]);
}
