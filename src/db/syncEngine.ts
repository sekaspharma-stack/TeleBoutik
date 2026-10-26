import { supabase, isSupabaseConfigured } from './supabaseClient';
import { query, execute } from './localDb';
import type { SyncOp, Sale, SaleLine, SalePayment, StockMovement, CashMovement, JournalEntry, AuditLog } from '../types';

type SyncResult = {
  synced: number;
  failed: number;
  errors: string[];
};

async function upsertSale(recordId: string, data: Sale): Promise<void> {
  const { error } = await supabase.from('sales').upsert({
    id: data.id,
    ticket_number: data.ticket_number,
    store_id: data.store_id,
    user_id: data.user_id,
    customer_id: data.customer_id,
    subtotal: data.subtotal,
    discount: data.discount,
    tax_amount: data.tax_amount,
    total: data.total,
    total_cost: data.total_cost,
    status: data.status,
    sale_date: data.sale_date,
    notes: data.notes,
  });
  if (error) throw new Error(`sales: ${error.message}`);

  const lines = await query<SaleLine>('SELECT * FROM sale_lines WHERE sale_id = $1', [recordId]);
  for (const line of lines) {
    const { error: le } = await supabase.from('sale_lines').upsert({
      id: line.id,
      sale_id: line.sale_id,
      variant_id: line.variant_id,
      imei_unit_id: line.imei_unit_id,
      product_name: line.product_name,
      quantity: line.quantity,
      unit_price: line.unit_price,
      unit_cost: line.unit_cost,
      discount: line.discount,
      line_total: line.line_total,
    });
    if (le) throw new Error(`sale_lines: ${le.message}`);
  }

  const payments = await query<SalePayment>('SELECT * FROM sale_payments WHERE sale_id = $1', [recordId]);
  for (const p of payments) {
    const { error: pe } = await supabase.from('sale_payments').upsert({
      id: p.id,
      sale_id: p.sale_id,
      payment_method: p.payment_method,
      amount: p.amount,
      reference: p.reference,
    });
    if (pe) throw new Error(`sale_payments: ${pe.message}`);
  }

  const stockMvts = await query<StockMovement>(
    "SELECT * FROM stock_movements WHERE reference_id = $1 AND reference_type IN ('sale','sale_cancel')",
    [recordId]
  );
  for (const sm of stockMvts) {
    const { error: se } = await supabase.from('stock_movements').upsert({
      id: sm.id,
      variant_id: sm.variant_id,
      imei_unit_id: sm.imei_unit_id,
      movement_type: sm.movement_type,
      direction: sm.direction,
      quantity: sm.quantity,
      unit_cost: sm.unit_cost,
      reference_type: sm.reference_type,
      reference_id: sm.reference_id,
      user_id: sm.user_id,
      reason: sm.reason,
      created_at: sm.created_at,
    });
    if (se) throw new Error(`stock_movements: ${se.message}`);
  }

  const cashMvts = await query<CashMovement>(
    "SELECT * FROM cash_movements WHERE reference_id = $1",
    [recordId]
  );
  for (const cm of cashMvts) {
    const { error: ce } = await supabase.from('cash_movements').upsert({
      id: cm.id,
      cash_session_id: cm.cash_session_id,
      movement_type: cm.movement_type,
      payment_method: cm.payment_method,
      amount: cm.amount,
      direction: cm.direction,
      reference_type: cm.reference_type,
      reference_id: cm.reference_id,
      user_id: cm.user_id,
      reason: cm.reason,
      created_at: cm.created_at,
    });
    if (ce) throw new Error(`cash_movements: ${ce.message}`);
  }

  const journalEntries = await query<JournalEntry>(
    "SELECT * FROM journal_entries WHERE reference_id = $1",
    [recordId]
  );
  for (const je of journalEntries) {
    const { error: jee } = await supabase.from('journal_entries').upsert({
      id: je.id,
      date: je.date,
      account_debit: je.account_debit,
      account_credit: je.account_credit,
      amount: je.amount,
      description: je.description,
      reference_type: je.reference_type,
      reference_id: je.reference_id,
      user_id: je.user_id,
      created_at: je.created_at,
    });
    if (jee) throw new Error(`journal_entries: ${jee.message}`);
  }
}

async function cancelSaleCloud(recordId: string, data: { reason: string }): Promise<void> {
  const { error } = await supabase
    .from('sales')
    .update({ status: 'cancelled' })
    .eq('id', recordId);
  if (error) throw new Error(`cancel sale: ${error.message}`);
}

async function syncEntity(entity: string, operation: string, recordId: string, rawData: string): Promise<void> {
  const data = JSON.parse(rawData);

  switch (entity) {
    case 'sales':
      if (operation === 'insert') {
        await upsertSale(recordId, data as Sale);
      } else if (operation === 'cancel') {
        await cancelSaleCloud(recordId, data as { reason: string });
      }
      break;

    case 'customers': {
      const { error } = await supabase.from('customers').upsert({
        id: data.id,
        name: data.name,
        phone: data.phone ?? '',
        email: data.email ?? null,
        credit_limit: data.credit_limit ?? 50000,
        outstanding_balance: data.outstanding_balance ?? 0,
        created_at: data.created_at,
      });
      if (error) throw new Error(`customers: ${error.message}`);
      break;
    }

    case 'products': {
      const { error } = await supabase.from('products').upsert({
        id: data.id,
        store_id: data.store_id ?? null,
        brand: data.brand,
        family: data.family ?? '',
        model: data.model,
        category: data.category,
        image_url: data.image_url ?? null,
        is_serialized: data.is_serialized ?? false,
        created_at: data.created_at,
        updated_at: data.updated_at,
      });
      if (error) throw new Error(`products: ${error.message}`);

      if (data.variant) {
        const v = data.variant;
        const { error: ve } = await supabase.from('product_variants').upsert({
          id: v.id,
          product_id: v.product_id,
          sku: v.sku,
          barcode: v.barcode ?? '',
          attributes: v.attributes ?? {},
          purchase_price: v.purchase_price ?? 0,
          sale_price: v.sale_price ?? 0,
          wholesale_price: v.wholesale_price ?? 0,
          min_stock: v.min_stock ?? 5,
          max_stock: v.max_stock ?? 100,
          created_at: v.created_at,
          updated_at: v.updated_at,
        });
        if (ve) throw new Error(`product_variants: ${ve.message}`);
      }
      break;
    }

    case 'cash_session': {
      const { error } = await supabase.from('cash_sessions').upsert({
        id: data.id,
        store_id: data.store_id,
        user_id: data.user_id,
        register_number: data.register_number ?? 1,
        opening_amount: data.opening_amount,
        closing_amount: data.closing_amount ?? null,
        expected_closing: data.expected_closing ?? null,
        difference: data.difference ?? null,
        status: data.status,
        opened_at: data.opened_at,
        closed_at: data.closed_at ?? null,
        notes: data.notes ?? null,
      });
      if (error) throw new Error(`cash_sessions: ${error.message}`);
      break;
    }

    case 'user': {
      const { error } = await supabase.from('app_users').upsert({
        id: data.id,
        store_id: data.store_id ?? null,
        name: data.name,
        pin: data.pin,
        role: data.role,
        active: data.active ?? true,
        commission_rate: data.commission_rate ?? 0,
        fixed_salary: data.fixed_salary ?? 0,
        created_at: data.created_at,
      });
      if (error) throw new Error(`app_users: ${error.message}`);
      break;
    }

    default:
      break;
  }

  const auditLogs = await query<AuditLog>(
    'SELECT * FROM audit_log WHERE entity = $1 AND (sync_op_id IS NULL OR sync_op_id = $2)',
    [entity, recordId]
  );
  for (const al of auditLogs) {
    const { error: ae } = await supabase.from('audit_log').upsert({
      id: al.id,
      user_id: al.user_id,
      user_role: al.user_role,
      entity: al.entity,
      action: al.action,
      before_data: al.before_data ? JSON.parse(al.before_data) : null,
      after_data: al.after_data ? JSON.parse(al.after_data) : null,
      prev_hash: al.prev_hash,
      hash: al.hash,
      created_at: al.created_at,
    });
    if (ae) throw new Error(`audit_log: ${ae.message}`);
  }
}

let syncing = false;

export type SyncProgress = { completed: number; total: number; current: string | null };

export async function syncPendingOps(onProgress?: (progress: SyncProgress) => void): Promise<SyncResult> {
  if (!isSupabaseConfigured) {
    return { synced: 0, failed: 0, errors: ['Supabase non configuré'] };
  }
  if (syncing) return { synced: 0, failed: 0, errors: [] };
  if (!navigator.onLine) return { synced: 0, failed: 0, errors: [] };

  syncing = true;
  let synced = 0;
  let failed = 0;
  const errors: string[] = [];

  try {
    const ops = await query<SyncOp>(
      "SELECT * FROM sync_ops WHERE status = 'pending' ORDER BY logical_clock ASC LIMIT 50"
    );

    onProgress?.({ completed: 0, total: ops.length, current: null });
    let completed = 0;
    for (const op of ops) {
      onProgress?.({ completed, total: ops.length, current: `${op.entity}/${op.record_id}` });
      try {
        await syncEntity(op.entity, op.operation, op.record_id, op.data);
        await execute(
          "UPDATE sync_ops SET status = 'synced', synced_at = $1 WHERE id = $2",
          [new Date().toISOString().replace('T', ' ').substring(0, 19), op.id]
        );
        synced++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await execute(
          "UPDATE sync_ops SET status = 'rejected', error_message = $1 WHERE id = $2",
          [msg, op.id]
        );
        failed++;
        errors.push(`${op.entity}/${op.record_id}: ${msg}`);
      }
      completed++;
      onProgress?.({ completed, total: ops.length, current: null });
    }
  } finally {
    syncing = false;
  }

  return { synced, failed, errors };
}

export function isSyncing(): boolean {
  return syncing;
}
