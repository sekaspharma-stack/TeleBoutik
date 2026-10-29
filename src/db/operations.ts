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

export async function suggestRestock(storeId: string) {
  const stock = await query<{variant_id:string;quantity:number;min_stock:number}>(`SELECT pv.id AS variant_id, pv.min_stock, COALESCE(SUM(CASE WHEN sm.direction='in' THEN sm.quantity ELSE -sm.quantity END),0) AS quantity FROM product_variants pv LEFT JOIN stock_movements sm ON sm.variant_id=pv.id WHERE pv.min_stock>0 GROUP BY pv.id,pv.min_stock HAVING COALESCE(SUM(CASE WHEN sm.direction='in' THEN sm.quantity ELSE -sm.quantity END),0)<pv.min_stock`);
  for (const item of stock) {
    const qty = Math.max(0, item.min_stock * 2 - item.quantity);
    await execute(`INSERT INTO stock_restock_suggestions (id,store_id,variant_id,current_stock,minimum_stock,suggested_quantity,status) VALUES ($1,$2,$3,$4,$5,$6,'open') ON CONFLICT (store_id,variant_id,status) DO UPDATE SET current_stock=EXCLUDED.current_stock,minimum_stock=EXCLUDED.minimum_stock,suggested_quantity=EXCLUDED.suggested_quantity,created_at=CURRENT_TIMESTAMP`, [generateId(),storeId,item.variant_id,item.quantity,item.min_stock,qty]);
  }
  return query(`SELECT s.*,p.brand,p.model,pv.sku FROM stock_restock_suggestions s JOIN product_variants pv ON pv.id=s.variant_id JOIN products p ON p.id=pv.product_id WHERE s.store_id=$1 AND s.status='open' ORDER BY (s.minimum_stock-s.current_stock) DESC`, [storeId]);
}

export async function getMarginByProduct(storeId: string, fromDate: string, toDate: string) {
  return query(`SELECT sl.variant_id,sl.product_name,SUM(sl.quantity) AS quantity,SUM(sl.line_total) AS revenue,SUM(sl.unit_cost*sl.quantity) AS cost,SUM(sl.line_total-sl.unit_cost*sl.quantity) AS margin FROM sale_lines sl JOIN sales s ON s.id=sl.sale_id WHERE s.store_id=$1 AND s.status<>'cancelled' AND s.sale_date::date BETWEEN $2::date AND $3::date GROUP BY sl.variant_id,sl.product_name ORDER BY margin DESC`, [storeId,fromDate,toDate]);
}

export async function approveSensitiveAction(input: { storeId: string; action: string; targetId?: string | null; requesterId: string; managerPin: string; reason: string }) {
  const { verifyPin } = await import('../lib/pin');
  const manager = await query<{id:string;role:string;pin:string}>('SELECT id,role,pin FROM users WHERE active=true AND role IN (\'owner\',\'manager\')');
  let approver: typeof manager[number] | undefined;
  for (const candidate of manager) if (await verifyPin(input.managerPin, candidate.pin)) { approver = candidate; break; }
  if (!approver) throw new Error('PIN du gérant/propriétaire incorrect.');
  if (approver.id === input.requesterId) throw new Error('Une deuxième personne autorisée doit valider cette opération.');
  const id = generateId();
  await execute('INSERT INTO manager_approvals (id,store_id,action,target_id,requested_by,approved_by,reason) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id,input.storeId,input.action,input.targetId ?? null,input.requesterId,approver.id,input.reason]);
  return { id, approvedBy: approver.id };
}

export async function getConsolidatedSales(fromDate: string, toDate: string) {
  return query(`SELECT s.store_id, st.name AS store_name, COUNT(*)::int AS sale_count, SUM(s.total) AS revenue, SUM(s.total_cost) AS cost, SUM(s.total-s.total_cost) AS margin FROM sales s LEFT JOIN stores st ON st.id=s.store_id WHERE s.status<>'cancelled' AND s.sale_date::date BETWEEN $1::date AND $2::date GROUP BY s.store_id,st.name ORDER BY revenue DESC`, [fromDate,toDate]);
}

/** Confirmation renforcée réservée au propriétaire pour les annulations de vente. */
export async function approveOwnerSensitiveAction(input: { storeId: string; action: string; targetId?: string | null; requesterId: string; ownerPin: string; reason: string }) {
  const { verifyPin } = await import('../lib/pin');
  if (!input.ownerPin?.trim()) throw new Error('PIN du propriétaire obligatoire.');
  const owners = await query<{id:string;role:string;pin:string}>("SELECT id,role,pin FROM users WHERE active=true AND role='owner'");
  let owner: typeof owners[number] | undefined;
  for (const candidate of owners) if (await verifyPin(input.ownerPin, candidate.pin)) { owner = candidate; break; }
  if (!owner) throw new Error('PIN du propriétaire incorrect.');
  if (owner.id === input.requesterId) throw new Error('Le propriétaire peut confirmer directement sans seconde validation.');
  const existing = await queryOne<{id:string}>('SELECT id FROM manager_approvals WHERE store_id=$1 AND action=$2 AND target_id=$3 AND requested_by=$4', [input.storeId,input.action,input.targetId ?? null,input.requesterId]);
  if (existing) return { id: existing.id, approvedBy: owner.id };
  const id = generateId();
  await execute('INSERT INTO manager_approvals (id,store_id,action,target_id,requested_by,approved_by,reason) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id,input.storeId,input.action,input.targetId ?? null,input.requesterId,owner.id,input.reason]);
  return { id, approvedBy: owner.id };
}
