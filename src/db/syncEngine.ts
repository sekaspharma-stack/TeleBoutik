import { db, isFirebaseConfigured } from './firebaseClient';
import {
  doc,
  setDoc,
  deleteDoc,
  writeBatch,
  collection,
  getDocs,
  serverTimestamp,
  type WriteBatch,
} from 'firebase/firestore';
import { getDb, query, execute } from './localDb';
import type { SyncOp, Sale, SaleLine, SalePayment, StockMovement, CashMovement, JournalEntry, AuditLog } from '../types';

type SyncResult = {
  synced: number;
  failed: number;
  errors: string[];
};

async function upsertSale(recordId: string, data: Sale): Promise<void> {
  const lines = await query<SaleLine>('SELECT * FROM sale_lines WHERE sale_id = $1', [recordId]);
  const payments = await query<SalePayment>('SELECT * FROM sale_payments WHERE sale_id = $1', [recordId]);
  const stockMvts = await query<StockMovement>(
    "SELECT * FROM stock_movements WHERE reference_id = $1 AND reference_type IN ('sale','sale_cancel')",
    [recordId]
  );
  const cashMvts = await query<CashMovement>(
    "SELECT * FROM cash_movements WHERE reference_id = $1",
    [recordId]
  );
  const journalEntries = await query<JournalEntry>(
    "SELECT * FROM journal_entries WHERE reference_id = $1",
    [recordId]
  );

  const batch: WriteBatch = writeBatch(db);

  batch.set(doc(db, 'sales', data.id), {
    id: data.id,
    ticket_number: data.ticket_number,
    store_id: data.store_id,
    user_id: data.user_id,
    customer_id: data.customer_id ?? null,
    subtotal: data.subtotal,
    discount: data.discount,
    tax_amount: data.tax_amount,
    total: data.total,
    total_cost: data.total_cost,
    status: data.status,
    sale_date: data.sale_date,
    notes: data.notes ?? null,
    synced_at: serverTimestamp(),
  });

  for (const line of lines) {
    batch.set(doc(db, 'sale_lines', line.id), {
      id: line.id,
      sale_id: line.sale_id,
      variant_id: line.variant_id,
      imei_unit_id: line.imei_unit_id ?? null,
      product_name: line.product_name,
      quantity: line.quantity,
      unit_price: line.unit_price,
      unit_cost: line.unit_cost,
      discount: line.discount,
      line_total: line.line_total,
    });
  }

  for (const p of payments) {
    batch.set(doc(db, 'sale_payments', p.id), {
      id: p.id,
      sale_id: p.sale_id,
      payment_method: p.payment_method,
      amount: p.amount,
      reference: p.reference ?? null,
    });
  }

  for (const sm of stockMvts) {
    batch.set(doc(db, 'stock_movements', sm.id), {
      id: sm.id,
      variant_id: sm.variant_id,
      imei_unit_id: sm.imei_unit_id ?? null,
      movement_type: sm.movement_type,
      direction: sm.direction,
      quantity: sm.quantity,
      unit_cost: sm.unit_cost,
      reference_type: sm.reference_type,
      reference_id: sm.reference_id ?? null,
      user_id: sm.user_id,
      reason: sm.reason,
      created_at: sm.created_at,
    });
  }

  for (const cm of cashMvts) {
    batch.set(doc(db, 'cash_movements', cm.id), {
      id: cm.id,
      cash_session_id: cm.cash_session_id,
      movement_type: cm.movement_type,
      payment_method: cm.payment_method,
      amount: cm.amount,
      direction: cm.direction,
      reference_type: cm.reference_type,
      reference_id: cm.reference_id ?? null,
      user_id: cm.user_id,
      reason: cm.reason,
      created_at: cm.created_at,
    });
  }

  for (const je of journalEntries) {
    batch.set(doc(db, 'journal_entries', je.id), {
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
  }

  await batch.commit();
}

async function cancelSaleCloud(recordId: string): Promise<void> {
  await setDoc(doc(db, 'sales', recordId), {
    id: recordId,
    status: 'cancelled',
    synced_at: serverTimestamp(),
  }, { merge: true });
}

async function syncEntity(entity: string, operation: string, recordId: string, rawData: string): Promise<void> {
  const data = JSON.parse(rawData);

  switch (entity) {
    case 'sales':
      if (operation === 'insert') {
        await upsertSale(recordId, data as Sale);
      } else if (operation === 'cancel') {
        await cancelSaleCloud(recordId);
      }
      break;

    case 'customers': {
      await setDoc(doc(db, 'customers', data.id), {
        id: data.id,
        name: data.name,
        phone: data.phone ?? '',
        email: data.email ?? null,
        credit_limit: data.credit_limit ?? 50000,
        outstanding_balance: data.outstanding_balance ?? 0,
        created_at: data.created_at,
        synced_at: serverTimestamp(),
      });
      break;
    }

    case 'products': {
      await setDoc(doc(db, 'products', data.id), {
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
        synced_at: serverTimestamp(),
      });

      if (data.variant) {
        const v = data.variant;
        await setDoc(doc(db, 'product_variants', v.id), {
          id: v.id,
          product_id: v.product_id,
          sku: v.sku,
          barcode: v.barcode ?? '',
          attributes: v.attributes ?? {},
          purchase_price: v.purchase_price ?? 0,
          sale_price: v.sale_price ?? 0,
          wholesale_price: v.wholesale_price ?? 0,
          currency_code: v.currency_code ?? 'USD',
          min_stock: v.min_stock ?? 5,
          max_stock: v.max_stock ?? 100,
          created_at: v.created_at,
          updated_at: v.updated_at,
          synced_at: serverTimestamp(),
        });
      }
      break;
    }

    case 'cash_session': {
      await setDoc(doc(db, 'cash_sessions', data.id), {
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
        synced_at: serverTimestamp(),
      });
      break;
    }

    case 'user': {
      await setDoc(doc(db, 'app_users', data.id), {
        id: data.id,
        store_id: data.store_id ?? null,
        name: data.name,
        pin: data.pin,
        role: data.role,
        active: data.active ?? true,
        commission_rate: data.commission_rate ?? 0,
        fixed_salary: data.fixed_salary ?? 0,
        created_at: data.created_at,
        synced_at: serverTimestamp(),
      });
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
    await setDoc(doc(db, 'audit_log', al.id), {
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
      synced_at: serverTimestamp(),
    });
  }
}

let syncing = false;

export type SyncProgress = { completed: number; total: number; current: string | null };

export async function syncPendingOps(onProgress?: (progress: SyncProgress) => void): Promise<SyncResult> {
  if (!isFirebaseConfigured) {
    return { synced: 0, failed: 0, errors: ['Firebase non configuré'] };
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
        const transient = /fetch|network|unavailable|deadline|timeout|offline|temporarily|resource-exhausted/i.test(msg);
        await execute(
          "UPDATE sync_ops SET status = $1, error_message = $2 WHERE id = $3",
          [transient ? 'pending' : 'rejected', msg, op.id]
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

const TABLE_COLLECTIONS: Array<{ table: string; collection: string }> = [
  { table: 'stores', collection: 'stores' },
  { table: 'users', collection: 'app_users' },
  { table: 'products', collection: 'products' },
  { table: 'product_variants', collection: 'product_variants' },
  { table: 'imei_units', collection: 'imei_units' },
  { table: 'stock_movements', collection: 'stock_movements' },
  { table: 'customers', collection: 'customers' },
  { table: 'suppliers', collection: 'suppliers' },
  { table: 'sales', collection: 'sales' },
  { table: 'sale_lines', collection: 'sale_lines' },
  { table: 'sale_payments', collection: 'sale_payments' },
  { table: 'cash_sessions', collection: 'cash_sessions' },
  { table: 'cash_movements', collection: 'cash_movements' },
  { table: 'airtel_transactions', collection: 'airtel_transactions' },
  { table: 'telecom_transactions', collection: 'telecom_transactions' },
  { table: 'sim_cards', collection: 'sim_cards' },
  { table: 'cabins', collection: 'cabins' },
  { table: 'commission_rules', collection: 'commission_rules' },
  { table: 'currency_exchanges', collection: 'currency_exchanges' },
  { table: 'expenses', collection: 'expenses' },
  { table: 'journal_entries', collection: 'journal_entries' },
  { table: 'audit_log', collection: 'audit_log' },
  { table: 'settings', collection: 'settings' },
  { table: 'credit_plans', collection: 'credit_plans' },
  { table: 'credit_installments', collection: 'credit_installments' },
  { table: 'purchases', collection: 'purchases' },
  { table: 'purchase_lines', collection: 'purchase_lines' },
  { table: 'inventory_sessions', collection: 'inventory_sessions' },
  { table: 'trade_ins', collection: 'trade_ins' },
];

const TABLE_BY_NAME = new Map<string, { table: string; collection: string }>(TABLE_COLLECTIONS.map((entry) => [entry.table, entry] as const));
type PendingRecordOperation = 'upsert' | 'delete';
const pendingRecordSync = new Map<string, Map<string, PendingRecordOperation>>();
const pendingFullTableSync = new Set<string>();
let tableSyncTimer: ReturnType<typeof setTimeout> | null = null;
let tableSyncRunning = false;

/** Queue one changed row instead of re-uploading an entire table after every SQL write. */
export function scheduleLocalTableSync(
  tableName: string,
  recordId: string | null = null,
  operation: PendingRecordOperation = 'upsert'
): void {
  if (!TABLE_BY_NAME.has(tableName)) return;
  if (recordId) {
    const records = pendingRecordSync.get(tableName) ?? new Map<string, PendingRecordOperation>();
    records.set(recordId, operation);
    pendingRecordSync.set(tableName, records);
  } else {
    pendingFullTableSync.add(tableName);
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  if (tableSyncTimer) clearTimeout(tableSyncTimer);
  tableSyncTimer = setTimeout(() => { void flushScheduledTableSync(); }, 1200);
}

/** Restore the persisted queue after a refresh or an offline session. */
export async function restorePendingCloudSync(): Promise<void> {
  try {
    const pending = await query<{ key: string; value: string }>(
      "SELECT key, value FROM app_meta WHERE key LIKE 'cloud_pending:%' OR key LIKE 'cloud_pending_full:%'"
    );
    for (const row of pending) {
      if (row.key.startsWith('cloud_pending_full:')) {
        scheduleLocalTableSync(row.key.slice('cloud_pending_full:'.length));
        continue;
      }
      const rest = row.key.slice('cloud_pending:'.length);
      const separator = rest.indexOf(':');
      if (separator < 0) continue;
      scheduleLocalTableSync(rest.slice(0, separator), rest.slice(separator + 1), row.value === 'delete' ? 'delete' : 'upsert');
    }
  } catch (error) {
    console.warn('Unable to restore cloud sync queue:', error);
  }
}

async function removePersistedQueueKey(key: string): Promise<void> {
  const database = await getDb();
  await database.query('DELETE FROM app_meta WHERE key = $1', [key]);
}

async function flushScheduledTableSync(): Promise<void> {
  if (tableSyncRunning || !isFirebaseConfigured || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
  tableSyncRunning = true;
  try {
    for (const table of [...pendingFullTableSync]) {
      if (typeof navigator !== 'undefined' && !navigator.onLine) break;
      pendingFullTableSync.delete(table);
      try {
        await syncTableToCloud(table);
        await removePersistedQueueKey(`cloud_pending_full:${table}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/fetch|network|unavailable|deadline|timeout|offline|temporarily|resource-exhausted/i.test(message)) pendingFullTableSync.add(table);
        console.warn(`Full cloud sync blocked for ${table}:`, error);
        break;
      }
    }

    for (const [table, records] of [...pendingRecordSync.entries()]) {
      for (const [recordId, operation] of [...records.entries()]) {
        if (typeof navigator !== 'undefined' && !navigator.onLine) break;
        try {
          await syncRecordToCloud(table, recordId, operation);
          records.delete(recordId);
          await removePersistedQueueKey(`cloud_pending:${table}:${recordId}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (/fetch|network|unavailable|deadline|timeout|offline|temporarily|resource-exhausted/i.test(message)) {
            // Leave the row queued for a later retry.
          } else {
            // Keep the persisted marker; a future online event or app reload can retry it.
            records.delete(recordId);
          }
          console.warn(`Cloud sync blocked for ${table}/${recordId}:`, error);
          break;
        }
      }
      if (records.size === 0) pendingRecordSync.delete(table);
    }
  } finally {
    tableSyncRunning = false;
    if ((pendingFullTableSync.size > 0 || pendingRecordSync.size > 0) && (typeof navigator === 'undefined' || navigator.onLine)) {
      if (tableSyncTimer) clearTimeout(tableSyncTimer);
      tableSyncTimer = setTimeout(() => { void flushScheduledTableSync(); }, 5000);
    }
  }
}

async function syncRecordToCloud(tableName: string, recordId: string, operation: PendingRecordOperation): Promise<void> {
  const entry = TABLE_BY_NAME.get(tableName);
  if (!entry || !isFirebaseConfigured) return;
  const ref = doc(db, entry.collection, recordId);
  if (operation === 'delete') {
    await deleteDoc(ref);
    return;
  }
  const rows = await query<Record<string, unknown>>(`SELECT * FROM ${entry.table} WHERE id = $1`, [recordId]);
  if (rows.length === 0) {
    await deleteDoc(ref);
    return;
  }
  const safeData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rows[0])) if (value !== undefined) safeData[key] = value;
  safeData.synced_at = serverTimestamp();
  await setDoc(ref, safeData, { merge: true });
}

async function syncTableToCloud(tableName: string): Promise<void> {
  const entry = TABLE_BY_NAME.get(tableName);
  if (!entry || !isFirebaseConfigured) return;
  const rows = await query<Record<string, unknown>>(`SELECT * FROM ${entry.table}`);
  if (rows.length === 0) return;
  for (let offset = 0; offset < rows.length; offset += 400) {
    const batch: WriteBatch = writeBatch(db);
    for (const row of rows.slice(offset, offset + 400)) {
      const id = String(row.id ?? '');
      if (!id) continue;
      const safeData: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) if (value !== undefined) safeData[key] = value;
      safeData.synced_at = serverTimestamp();
      batch.set(doc(db, entry.collection, id), safeData, { merge: true });
    }
    await batch.commit();
  }
}

/** Bootstrap an empty Firestore project once; normal edits use the row-level queue. */
export async function syncAllLocalTablesToCloud(): Promise<void> {
  if (!isFirebaseConfigured || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
  try {
    const remoteStores = await getDocs(collection(db, 'stores'));
    if (!remoteStores.empty) return;
  } catch (error) {
    console.warn('Cannot determine whether Firestore is empty; skipping full initial mirror:', error);
    return;
  }
  for (const entry of TABLE_COLLECTIONS) {
    try {
      const rows = await query<{ count: number | string }>(`SELECT COUNT(*) AS count FROM ${entry.table}`);
      if (Number(rows[0]?.count ?? 0) > 0) await syncTableToCloud(entry.table);
    } catch (error) {
      console.warn(`Initial cloud mirror skipped ${entry.table}:`, error);
    }
  }
}

function toSqlValue(key: string, value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (key === 'synced_at') return undefined;
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    const date = (value as { toDate: () => Date }).toDate();
    return date.toISOString().replace('T', ' ').substring(0, 19);
  }
  const jsonColumns = new Set(['attributes', 'before_data', 'after_data', 'checklist', 'photos']);
  if (jsonColumns.has(key) && typeof value === 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return JSON.stringify(value);
  return value;
}

export async function pullCloudData(): Promise<void> {
  if (!isFirebaseConfigured || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
  const database = await getDb();

  // Read collections in parallel to keep the startup delay bounded; import rows in
  // dependency order so parent rows exist before their children.
  const snapshots = await Promise.all(TABLE_COLLECTIONS.map(async (entry) => {
    try {
      return { entry, snap: await getDocs(collection(db, entry.collection)), error: null as unknown };
    } catch (error) {
      return { entry, snap: null, error };
    }
  }));
  const pendingRows = await database.query<{ key: string }>(
    "SELECT key FROM app_meta WHERE key LIKE 'cloud_pending:%' OR key LIKE 'cloud_pending_full:%'"
  );
  const pendingKeys = new Set(pendingRows.rows.map((row) => row.key));

  for (const result of snapshots) {
    if (!result.snap) {
      console.warn(`Cloud read unavailable for ${result.entry.collection}:`, result.error);
      continue;
    }
    if (result.snap.empty) continue;

    if (pendingKeys.has(`cloud_pending_full:${result.entry.table}`)) continue;

    const schema = await database.query<{ column_name: string }>(
      'SELECT column_name FROM information_schema.columns WHERE table_name = $1',
      [result.entry.table]
    );
    const allowedColumns = new Set(schema.rows.map((row) => row.column_name));

    for (const docSnap of result.snap.docs) {
      const data = docSnap.data();
      const id = String(data.id ?? docSnap.id);
      if (pendingKeys.has(`cloud_pending:${result.entry.table}:${id}`)) continue;
      const record: Record<string, unknown> = { ...data, id };
      delete record.synced_at;
      const columns = Object.keys(record).filter((key) => allowedColumns.has(key) && /^[a-z_][a-z0-9_]*$/i.test(key));
      if (!columns.includes('id')) columns.unshift('id');
      const values = columns.map((key) => toSqlValue(key, record[key]));
      const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
      const updates = columns.filter((key) => key !== 'id').map((key) => `${key} = EXCLUDED.${key}`).join(', ');
      const conflictClause = updates
        ? `ON CONFLICT (id) DO UPDATE SET ${updates}`
        : 'ON CONFLICT (id) DO NOTHING';
      try {
        await database.query(
          `INSERT INTO ${result.entry.table} (${columns.join(', ')}) VALUES (${placeholders}) ${conflictClause}`,
          values
        );
      } catch (error) {
        console.warn(`Could not import ${result.entry.collection}/${docSnap.id}:`, error);
      }
    }
  }
}

