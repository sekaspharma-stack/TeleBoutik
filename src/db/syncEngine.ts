import { db, isFirebaseConfigured } from './firebaseClient';
import {
  doc,
  setDoc,
  deleteDoc,
  writeBatch,
  collection,
  getDocsFromServer,
  serverTimestamp,
  type WriteBatch,
} from 'firebase/firestore';
import { getDb, query, execute } from './localDb';
import { withTimeout } from '../lib/async';

const CLOUD_WRITE_TIMEOUT_MS = 20000;
const CLOUD_READ_TIMEOUT_MS = 25000;
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
    currency_code: data.currency_code ?? 'USD',
    exchange_rate: data.exchange_rate ?? 1,
    exchange_rate_buy: data.exchange_rate_buy ?? 1,
    change_currency: data.change_currency ?? 'USD',
    change_amount: data.change_amount ?? 0,
    receipt_ref: data.receipt_ref ?? '',
    receipt_hash: data.receipt_hash ?? '',
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
        await withTimeout(syncEntity(op.entity, op.operation, op.record_id, op.data), CLOUD_WRITE_TIMEOUT_MS, `${op.entity}/${op.record_id}`);
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
  { table: 'telecom_stock', collection: 'telecom_stock' },
  { table: 'sim_cards', collection: 'sim_cards' },
  { table: 'sim_stock_batches', collection: 'sim_stock_batches' },
  { table: 'sim_batch_sales', collection: 'sim_batch_sales' },
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
        await withTimeout(syncTableToCloud(table), CLOUD_WRITE_TIMEOUT_MS * 3, table);
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
          await withTimeout(syncRecordToCloud(table, recordId, operation), CLOUD_WRITE_TIMEOUT_MS, `${table}/${recordId}`);
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
/** Legacy safeguard: local data is never mirrored wholesale over the cloud automatically.
 * New/changed local rows must use the persisted per-record queue.
 */
export async function syncAllLocalTablesToCloud(): Promise<void> {
  console.warn('Full local-to-cloud mirroring is disabled to protect cloud-authoritative data.');
}

/** Flush persisted row-level local changes before reading authoritative cloud state. */
export async function flushPendingCloudTableWrites(): Promise<void> {
  await flushScheduledTableSync();
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

export type CloudPullResult = {
  available: boolean;
  failedCollections: string[];
  reconciledTables: string[];
  skippedReason?: string;
};

/**
 * Read from the Firestore server (not its possibly stale SDK cache), merge cloud rows,
 * then remove local rows absent from successfully-read cloud collections. Persisted
 * offline writes are protected from both overwrites and reconciliation deletes.
 */
let pullInFlight: Promise<CloudPullResult> | null = null;

/** Un seul téléchargement cloud à la fois : les appels concurrents partagent le même résultat. */
export function pullCloudData(): Promise<CloudPullResult> {
  if (!pullInFlight) {
    pullInFlight = (async () => {
      // Le téléchargement prioritaire (boutique + comptes) passe toujours en premier.
      if (priorityInFlight) await priorityInFlight.catch(() => undefined);
      return pullCloudDataInner();
    })().finally(() => { pullInFlight = null; });
  }
  return pullInFlight;
}

let priorityInFlight: Promise<CloudPullResult> | null = null;
const PRIORITY_COLLECTIONS = ['stores', 'app_users'];

/**
 * Téléchargement PRIORITAIRE : uniquement la boutique et les comptes utilisateurs (quelques documents),
 * ce qui suffit pour afficher l'écran de connexion. Le reste des données suit en arrière-plan.
 */
export function pullPriorityData(): Promise<CloudPullResult> {
  if (!priorityInFlight) {
    priorityInFlight = pullCloudDataInner(PRIORITY_COLLECTIONS, 12000).finally(() => { priorityInFlight = null; });
  }
  return priorityInFlight;
}

async function pullCloudDataInner(only?: string[], readTimeoutMs: number = CLOUD_READ_TIMEOUT_MS): Promise<CloudPullResult> {
  if (!isFirebaseConfigured) return { available: false, failedCollections: [], reconciledTables: [], skippedReason: 'Firebase non configuré' };
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { available: false, failedCollections: [], reconciledTables: [], skippedReason: 'Appareil hors ligne' };

  const database = await getDb();
  const entries = only ? TABLE_COLLECTIONS.filter((entry) => only.includes(entry.collection)) : TABLE_COLLECTIONS;
  const snapshots = await Promise.all(entries.map(async (entry) => {
    try {
      return { entry, snap: await withTimeout(getDocsFromServer(collection(db, entry.collection)), readTimeoutMs, entry.collection), error: null as unknown };
    } catch (error) {
      return { entry, snap: null, error };
    }
  }));
  const failedCollections = snapshots.filter((item) => !item.snap).map((item) => item.entry.collection);
  const successful = snapshots.filter((item) => item.snap !== null);
  if (successful.length === 0) {
    return { available: false, failedCollections, reconciledTables: [], skippedReason: 'Aucune collection cloud n’a pu être lue depuis le serveur' };
  }

  const pendingRows = await database.query<{ key: string; value: string }>(
    "SELECT key, value FROM app_meta WHERE key LIKE 'cloud_pending:%' OR key LIKE 'cloud_pending_full:%'"
  );
  const pendingKeys = new Set(pendingRows.rows.map((row) => row.key));

  // The main POS sale flow uses sync_ops rather than app_meta. Protect any still-pending
  // offline sale and its locally-created child ledger rows from stale cloud overwrites.
  const pendingOps = await database.query<{ entity: string; record_id: string }>(
    "SELECT entity, record_id FROM sync_ops WHERE status IN ('pending', 'conflict')"
  );
  for (const op of pendingOps.rows) {
    pendingKeys.add(`cloud_pending:${op.entity}:${op.record_id}`);
    if (op.entity !== 'sales') continue;
    for (const child of [
      { table: 'sale_lines', sql: 'SELECT id FROM sale_lines WHERE sale_id = $1' },
      { table: 'sale_payments', sql: 'SELECT id FROM sale_payments WHERE sale_id = $1' },
      { table: 'stock_movements', sql: "SELECT id FROM stock_movements WHERE reference_id = $1 AND reference_type IN ('sale','sale_cancel')" },
      { table: 'cash_movements', sql: 'SELECT id FROM cash_movements WHERE reference_id = $1' },
      { table: 'journal_entries', sql: 'SELECT id FROM journal_entries WHERE reference_id = $1' },
    ]) {
      const childRows = await database.query<{ id: string }>(child.sql, [op.record_id]);
      for (const childRow of childRows.rows) pendingKeys.add(`cloud_pending:${child.table}:${childRow.id}`);
    }
  }

  // A completely empty cloud identity with existing local business data may indicate
  // a wrong Firebase project/configuration. Never erase that local data automatically.
  const cloudStores = snapshots.find((item) => item.entry.collection === 'stores')?.snap;
  const cloudUsers = snapshots.find((item) => item.entry.collection === 'app_users')?.snap;
  const localStores = await database.query<{ count: number | string }>('SELECT COUNT(*) AS count FROM stores');
  const localUsers = await database.query<{ count: number | string }>('SELECT COUNT(*) AS count FROM users');
  if (cloudStores?.empty && cloudUsers?.empty && (Number(localStores.rows[0]?.count ?? 0) > 0 || Number(localUsers.rows[0]?.count ?? 0) > 0)) {
    console.error('Cloud-first pull paused: Firestore has no store/users while local business data exists. Verify Firebase project before any destructive reconciliation.');
    return { available: true, failedCollections, reconciledTables: [], skippedReason: 'Cloud boutique/comptes vide alors que des données locales existent; vérification requise' };
  }

  const tablesToReconcile: Array<{ table: string; remoteIds: Set<string> }> = [];

  // Import parent rows before dependent rows. Empty successful collections are authoritative too.
  for (const result of successful) {
    const { entry, snap } = result;
    const remoteIds = new Set<string>();
    for (const docSnap of snap!.docs) {
      const data = docSnap.data();
      const id = String(data.id ?? docSnap.id);
      remoteIds.add(id);
    }

    if (pendingKeys.has(`cloud_pending_full:${entry.table}`)) continue;

    const schema = await database.query<{ column_name: string }>(
      'SELECT column_name FROM information_schema.columns WHERE table_name = $1',
      [entry.table]
    );
    const allowedColumns = new Set(schema.rows.map((row) => row.column_name));

    // Une transaction par collection : PGlite/IndexedDB n'écrit sur disque qu'une fois au COMMIT
    // (avant : une écriture disque par document, cause principale de la lenteur au démarrage).
    // Un SAVEPOINT par ligne conserve la tolérance aux lignes invalides.
    await database.transaction(async (tx) => {
      for (const docSnap of snap!.docs) {
        const data = docSnap.data();
        const id = String(data.id ?? docSnap.id);
        if (pendingKeys.has(`cloud_pending:${entry.table}:${id}`)) continue;
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
        await tx.query('SAVEPOINT import_row');
        try {
          await tx.query(
            `INSERT INTO ${entry.table} (${columns.join(', ')}) VALUES (${placeholders}) ${conflictClause}`,
            values
          );
          await tx.query('RELEASE SAVEPOINT import_row');
        } catch (error) {
          await tx.query('ROLLBACK TO SAVEPOINT import_row');
          console.warn(`Could not import ${entry.collection}/${docSnap.id}:`, error);
        }
      }
    });
    tablesToReconcile.push({ table: entry.table, remoteIds });
  }

  // Delete stale local copies only for collections successfully fetched from Firestore.
  // Reverse dependency order avoids leaving orphaned child records. Bypass execute() so
  // cloud reconciliation does not create new local-to-cloud queue entries.
  const reconciledTables: string[] = [];
  for (const entry of [...tablesToReconcile].reverse()) {
    const localRows = await database.query<{ id: string }>(`SELECT id FROM ${entry.table}`);
    const staleIds = localRows.rows
      .map((row) => String(row.id))
      .filter((id) => !entry.remoteIds.has(id) && !pendingKeys.has(`cloud_pending:${entry.table}:${id}`));
    if (staleIds.length > 0) {
      await database.transaction(async (tx) => {
        for (const id of staleIds) await tx.query(`DELETE FROM ${entry.table} WHERE id = $1`, [id]);
      });
    }
    reconciledTables.push(entry.table);
  }

  return { available: true, failedCollections, reconciledTables };
}
