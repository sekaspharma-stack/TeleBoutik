import { db, isFirebaseConfigured } from './firebaseClient';
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  writeBatch,
  collection,
  getDocsFromServer,
  onSnapshot,
  serverTimestamp,
  type Unsubscribe,
  type WriteBatch,
} from 'firebase/firestore';
import { getDb, query, execute } from './localDb';
import { withTimeout } from '../lib/async';

const CLOUD_WRITE_TIMEOUT_MS = 20000;
const CLOUD_READ_TIMEOUT_MS = 25000;
import type { SyncOp, Sale, AuditLog } from '../types';

type SyncResult = {
  synced: number;
  failed: number;
  errors: string[];
};

/** Copie une ligne SQL telle quelle (toutes les colonnes) en retirant les valeurs `undefined`. */
function cleanRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) if (value !== undefined) out[key] = value;
  return out;
}

/**
 * Envoie une vente et TOUTES ses lignes liées au cloud.
 * Correctif : l'ancienne version recopiait une liste de champs fixe et écrasait les documents sans `merge`,
 * ce qui supprimait `currency_code`, `original_amount` et `applied_rate` des mouvements de caisse et des
 * paiements. Sur un autre appareil, un encaissement en CDF réapparaissait alors comme un montant USD erroné.
 * Désormais : toutes les colonnes sont envoyées, et en `merge` pour ne jamais retirer un champ déjà présent.
 */
async function upsertSale(recordId: string, data: Sale): Promise<void> {
  const saleRows = await query<Record<string, unknown>>('SELECT * FROM sales WHERE id = $1', [recordId]);
  const saleRow = saleRows[0] ?? (data as unknown as Record<string, unknown>);
  const lines = await query<Record<string, unknown>>('SELECT * FROM sale_lines WHERE sale_id = $1', [recordId]);
  const payments = await query<Record<string, unknown>>('SELECT * FROM sale_payments WHERE sale_id = $1', [recordId]);
  const stockMvts = await query<Record<string, unknown>>(
    "SELECT * FROM stock_movements WHERE reference_id = $1 AND reference_type IN ('sale','sale_cancel')",
    [recordId]
  );
  const cashMvts = await query<Record<string, unknown>>(
    "SELECT * FROM cash_movements WHERE reference_id = $1",
    [recordId]
  );
  const journalEntries = await query<Record<string, unknown>>(
    "SELECT * FROM journal_entries WHERE reference_id = $1",
    [recordId]
  );

  const batch: WriteBatch = writeBatch(db);
  const put = (collectionName: string, row: Record<string, unknown>, withSyncStamp = false) => {
    const id = String(row.id ?? '');
    if (!id) return;
    const payload = cleanRow(row);
    if (withSyncStamp) payload.synced_at = serverTimestamp();
    batch.set(doc(db, collectionName, id), payload, { merge: true });
  };

  put('sales', { ...saleRow, id: data.id ?? recordId, customer_id: saleRow.customer_id ?? null }, true);
  for (const line of lines) put('sale_lines', line);
  for (const payment of payments) put('sale_payments', payment);
  for (const movement of stockMvts) put('stock_movements', movement);
  for (const movement of cashMvts) put('cash_movements', movement);
  for (const entry of journalEntries) put('journal_entries', entry);

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

  // Check for an explicitly confirmed cloud reset before sending any persisted local queue.
  // This prevents stale operations from repopulating Firestore after a reset.
  await applyCloudResetEpoch(await getDb());

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
  // Modules ajoutés plus tard : sans ces entrées, les dettes clients, garanties et réparations
  // restaient uniquement sur l'appareil qui les avait créés.
  { table: 'customer_debt_ledger', collection: 'customer_debt_ledger' },
  { table: 'debt_reminders', collection: 'debt_reminders' },
  { table: 'warranty_records', collection: 'warranty_records' },
  { table: 'repair_records', collection: 'repair_records' },
  { table: 'manager_approvals', collection: 'manager_approvals' },
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
  tableSyncTimer = setTimeout(() => { void flushScheduledTableSync(); }, 150);
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
      tableSyncTimer = setTimeout(() => { void flushScheduledTableSync(); }, 400);
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

/**
 * Identifiant local d'un document cloud. Pour `settings`, l'id est toujours « setting:<clé> » : les anciens
 * documents créés avec un id aléatoire par chaque appareil (doublons sur la même clé) sont ramenés sur la même
 * ligne au lieu de violer la contrainte UNIQUE(key).
 */
function cloudRecordId(table: string, data: Record<string, unknown>, docId: string): string {
  if (table === 'settings' && typeof data.key === 'string' && data.key) return `setting:${data.key}`;
  return String(data.id ?? docId);
}

type LocalDatabase = Awaited<ReturnType<typeof getDb>>;
type LocalTx = Parameters<Parameters<LocalDatabase['transaction']>[0]>[0];

/** Clés `cloud_pending:<table>:<id>` des lignes locales pas encore envoyées : elles ne doivent jamais être écrasées ni supprimées. */
async function loadPendingKeys(database: LocalDatabase): Promise<Set<string>> {
  const pendingRows = await database.query<{ key: string; value: string }>(
    "SELECT key, value FROM app_meta WHERE key LIKE 'cloud_pending:%' OR key LIKE 'cloud_pending_full:%'"
  );
  const pendingKeys = new Set(pendingRows.rows.map((row) => row.key));

  // Le flux de vente principal utilise sync_ops plutôt que app_meta. On protège aussi une vente hors-ligne
  // encore en attente et ses lignes de comptabilité créées localement.
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
  return pendingKeys;
}

const allowedColumnsCache = new Map<string, Set<string>>();
async function allowedColumnsFor(database: LocalDatabase, table: string): Promise<Set<string>> {
  const cached = allowedColumnsCache.get(table);
  if (cached) return cached;
  const schema = await database.query<{ column_name: string }>(
    'SELECT column_name FROM information_schema.columns WHERE table_name = $1',
    [table]
  );
  const columns = new Set(schema.rows.map((row) => row.column_name));
  if (columns.size > 0) allowedColumnsCache.set(table, columns);
  return columns;
}

/** Insère ou met à jour UNE ligne cloud dans la base locale (tolérant : un SAVEPOINT isole une ligne invalide). */
async function importCloudRow(
  tx: LocalTx,
  table: string,
  id: string,
  data: Record<string, unknown>,
  allowedColumns: Set<string>,
  label: string
): Promise<boolean> {
  const record: Record<string, unknown> = { ...data, id };
  delete record.synced_at;
  const columns = Object.keys(record).filter((key) => allowedColumns.has(key) && /^[a-z_][a-z0-9_]*$/i.test(key));
  if (!columns.includes('id')) columns.unshift('id');
  const values = columns.map((key) => toSqlValue(key, record[key]));
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
  const updates = columns.filter((key) => key !== 'id').map((key) => `${key} = EXCLUDED.${key}`).join(', ');
  const conflictClause = updates ? `ON CONFLICT (id) DO UPDATE SET ${updates}` : 'ON CONFLICT (id) DO NOTHING';
  await tx.query('SAVEPOINT import_row');
  try {
    await tx.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) ${conflictClause}`, values);
    await tx.query('RELEASE SAVEPOINT import_row');
    return true;
  } catch (error) {
    await tx.query('ROLLBACK TO SAVEPOINT import_row');
    console.warn(`Could not import ${label}:`, error);
    return false;
  }
}

/**
 * Lignes appliquées par l'écoute temps réel PENDANT qu'un téléchargement complet est en cours.
 * Le téléchargement complet a lu le serveur un peu plus tôt : il ne doit ni écraser ces lignes plus récentes
 * ni les supprimer comme « absentes du cloud ».
 */
const liveTouchedDuringPull = new Set<string>();

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
    })().finally(() => { pullInFlight = null; if (!priorityInFlight) liveTouchedDuringPull.clear(); });
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
    priorityInFlight = pullCloudDataInner(PRIORITY_COLLECTIONS, 12000).finally(() => { priorityInFlight = null; if (!pullInFlight) liveTouchedDuringPull.clear(); });
  }
  return priorityInFlight;
}

/**
 * A confirmed cloud reset is a versioned event, not inferred from empty collections.
 * Applying a new epoch invalidates stale local business rows and queued uploads on this
 * device before any cloud data is imported. Configuration/accounts/audit history survive.
 */
async function applyCloudResetEpoch(database: Awaited<ReturnType<typeof getDb>>): Promise<void> {
  const marker = await withTimeout(getDoc(doc(db, 'system_state', 'business_data')), CLOUD_READ_TIMEOUT_MS, 'system_state/business_data');
  if (!marker.exists()) return; // legacy project: absence is not a reset
  const resetId = String(marker.data().reset_id ?? '');
  if (!resetId) return;
  const local = await database.query<{ value: string }>("SELECT value FROM app_meta WHERE key = 'cloud_reset_id'");
  if (local.rows[0]?.value === resetId) return;

  const protectedTables = new Set(['stores', 'users', 'settings', 'audit_log']);
  const tables = TABLE_COLLECTIONS.map((entry) => entry.table).filter((table) => !protectedTables.has(table)).reverse();
  await database.transaction(async (tx) => {
    // Remove stale business rows in dependency-reverse order, without invoking execute()
    // and therefore without scheduling fresh cloud uploads.
    for (const table of tables) {
      await tx.query(`DELETE FROM ${table}`);
    }
    await tx.query("DELETE FROM sync_ops");
    await tx.query("DELETE FROM app_meta WHERE key LIKE 'cloud_pending:%' OR key LIKE 'cloud_pending_full:%'");
    await tx.query(
      "INSERT INTO app_meta (key, value) VALUES ('cloud_reset_id', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
      [resetId]
    );
  });
  pendingRecordSync.clear();
  pendingFullTableSync.clear();
}

async function pullCloudDataInner(only?: string[], readTimeoutMs: number = CLOUD_READ_TIMEOUT_MS): Promise<CloudPullResult> {
  if (!isFirebaseConfigured) return { available: false, failedCollections: [], reconciledTables: [], skippedReason: 'Firebase non configuré' };
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { available: false, failedCollections: [], reconciledTables: [], skippedReason: 'Appareil hors ligne' };

  const database = await getDb();
  if (!only) await applyCloudResetEpoch(database);
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

  const pendingKeys = await loadPendingKeys(database);

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
      remoteIds.add(cloudRecordId(entry.table, docSnap.data(), docSnap.id));
    }

    if (pendingKeys.has(`cloud_pending_full:${entry.table}`)) continue;

    const allowedColumns = await allowedColumnsFor(database, entry.table);

    // Une transaction par collection : PGlite/IndexedDB n'écrit sur disque qu'une fois au COMMIT
    // (avant : une écriture disque par document, cause principale de la lenteur au démarrage).
    await database.transaction(async (tx) => {
      // Réglages : les documents à id canonique (« setting:<clé> ») passent en dernier et l'emportent sur d'anciens doublons.
      const docs = entry.table === 'settings'
        ? [...snap!.docs].sort((a, b) => Number(a.id.startsWith('setting:')) - Number(b.id.startsWith('setting:')))
        : snap!.docs;
      for (const docSnap of docs) {
        const data = docSnap.data();
        const id = cloudRecordId(entry.table, data, docSnap.id);
        if (pendingKeys.has(`cloud_pending:${entry.table}:${id}`)) continue;
        if (liveTouchedDuringPull.has(`${entry.table}:${id}`)) continue;
        await importCloudRow(tx, entry.table, id, data, allowedColumns, `${entry.collection}/${docSnap.id}`);
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
      .filter((id) => !entry.remoteIds.has(id) && !pendingKeys.has(`cloud_pending:${entry.table}:${id}`) && !liveTouchedDuringPull.has(`${entry.table}:${id}`));
    if (staleIds.length > 0) {
      await database.transaction(async (tx) => {
        for (const id of staleIds) await tx.query(`DELETE FROM ${entry.table} WHERE id = $1`, [id]);
      });
    }
    reconciledTables.push(entry.table);
  }

  return { available: true, failedCollections, reconciledTables };
}


/* -------------------------------------------------------------------------------------------------
 * SYNCHRONISATION TEMPS RÉEL (Firestore onSnapshot)
 *
 * Avant : un appareil ne voyait les changements des autres qu'au prochain téléchargement complet
 * (démarrage, bouton d'actualisation, retour réseau). Une vendeuse qui ouvrait sa caisse restait
 * invisible chez le propriétaire.
 * Maintenant : chaque collection est écoutée en continu. Dès qu'un autre appareil écrit, la ligne est
 * appliquée dans la base locale (PGlite) en quelques centaines de millisecondes, puis les écrans sont
 * rechargés. Avec le cache persistant de Firestore, un rechargement de page ne retélécharge que ce qui a changé.
 * ------------------------------------------------------------------------------------------------- */

/** Historique d'audit : volumineux et non affiché en direct. Il reste synchronisé par le téléchargement complet. */
const LIVE_EXCLUDED_COLLECTIONS = new Set(['audit_log']);
const LIVE_FLUSH_DELAY_MS = 120;
const LIVE_RETRY_DELAY_MS = 1500;
const LIVE_MAX_ATTEMPTS = 8;

type LiveChange = {
  table: string;
  id: string;
  type: 'upsert' | 'delete';
  data: Record<string, unknown>;
  label: string;
  attempts: number;
};

const liveBuffer = new Map<string, LiveChange>();
let liveUnsubscribes: Unsubscribe[] = [];
let liveNotify: ((tables: string[]) => void) | null = null;
let liveTimer: ReturnType<typeof setTimeout> | null = null;
let liveFlushing = false;

function scheduleLiveFlush(delay: number): void {
  if (liveTimer) clearTimeout(liveTimer);
  liveTimer = setTimeout(() => { liveTimer = null; void flushLiveChanges(); }, delay);
}

async function flushLiveChanges(): Promise<void> {
  if (liveFlushing) { scheduleLiveFlush(LIVE_FLUSH_DELAY_MS); return; }
  if (liveBuffer.size === 0) return;
  liveFlushing = true;
  const retry: LiveChange[] = [];
  const touched = new Set<string>();
  const changes = [...liveBuffer.values()];
  liveBuffer.clear();
  try {
    const database = await getDb();
    const pendingKeys = await loadPendingKeys(database);
    const pullRunning = Boolean(pullInFlight || priorityInFlight);

    // 1) Créations / modifications, parents avant enfants (clés étrangères).
    for (const entry of TABLE_COLLECTIONS) {
      const upserts = changes.filter((change) => change.table === entry.table && change.type === 'upsert'
        && !pendingKeys.has(`cloud_pending:${entry.table}:${change.id}`));
      if (upserts.length === 0) continue;
      const allowedColumns = await allowedColumnsFor(database, entry.table);
      await database.transaction(async (tx) => {
        for (const change of upserts) {
          const ok = await importCloudRow(tx, entry.table, change.id, change.data, allowedColumns, change.label);
          if (ok) {
            touched.add(entry.table);
            if (pullRunning) liveTouchedDuringPull.add(`${entry.table}:${change.id}`);
          } else {
            retry.push(change); // le plus souvent : le parent (clé étrangère) n'est pas encore arrivé
          }
        }
      });
    }

    // 2) Suppressions, enfants avant parents.
    for (const entry of [...TABLE_COLLECTIONS].reverse()) {
      const deletions = changes.filter((change) => change.table === entry.table && change.type === 'delete'
        && !pendingKeys.has(`cloud_pending:${entry.table}:${change.id}`));
      if (deletions.length === 0) continue;
      await database.transaction(async (tx) => {
        for (const change of deletions) {
          await tx.query('SAVEPOINT live_delete');
          try {
            await tx.query(`DELETE FROM ${entry.table} WHERE id = $1`, [change.id]);
            await tx.query('RELEASE SAVEPOINT live_delete');
            touched.add(entry.table);
            if (pullRunning) liveTouchedDuringPull.add(`${entry.table}:${change.id}`);
          } catch (error) {
            await tx.query('ROLLBACK TO SAVEPOINT live_delete');
            console.warn(`Could not apply live delete ${change.label}:`, error);
          }
        }
      });
    }
  } catch (error) {
    // Échec global (base verrouillée, erreur de transaction…) : tout est remis en file pour un nouvel essai.
    console.warn('Live cloud apply failed, will retry:', error);
    for (const change of changes) if (!retry.includes(change)) retry.push(change);
  } finally {
    liveFlushing = false;
  }

  // Les lignes refusées (parent manquant) sont réessayées : le parent arrive en général dans la seconde qui suit.
  for (const change of liveNotify ? retry : []) {
    const key = `${change.table}\u0000${change.id}`;
    if (change.attempts + 1 >= LIVE_MAX_ATTEMPTS || liveBuffer.has(key)) continue;
    liveBuffer.set(key, { ...change, attempts: change.attempts + 1 });
  }
  if (liveBuffer.size > 0) scheduleLiveFlush(retry.length > 0 ? LIVE_RETRY_DELAY_MS : LIVE_FLUSH_DELAY_MS);
  if (touched.size > 0) {
    try { liveNotify?.([...touched]); } catch (error) { console.warn('Live notify failed:', error); }
  }
}

/** Arrête l'écoute temps réel (déconnexion, changement de boutique). */
export function stopRealtimeSync(): void {
  for (const unsubscribe of liveUnsubscribes) {
    try { unsubscribe(); } catch { /* écoute déjà fermée */ }
  }
  liveUnsubscribes = [];
  liveNotify = null;
  if (liveTimer) { clearTimeout(liveTimer); liveTimer = null; }
  liveBuffer.clear();
}

/**
 * Démarre l'écoute temps réel de toutes les collections métier.
 * `onChange` reçoit la liste des tables locales réellement modifiées par un autre appareil.
 */
export function startRealtimeSync(onChange: (tables: string[]) => void): () => void {
  stopRealtimeSync();
  if (!isFirebaseConfigured) return () => undefined;
  liveNotify = onChange;

  for (const entry of TABLE_COLLECTIONS) {
    if (LIVE_EXCLUDED_COLLECTIONS.has(entry.collection)) continue;
    const unsubscribe = onSnapshot(
      collection(db, entry.collection),
      (snapshot) => {
        let queued = false;
        for (const change of snapshot.docChanges()) {
          const docSnap = change.doc;
          // Écho de NOS propres écritures : la base locale est déjà à jour (et prioritaire).
          if (docSnap.metadata.hasPendingWrites) continue;
          const data = docSnap.data();
          const id = cloudRecordId(entry.table, data, docSnap.id);
          liveBuffer.set(`${entry.table}\u0000${id}`, {
            table: entry.table,
            id,
            type: change.type === 'removed' ? 'delete' : 'upsert',
            data,
            label: `${entry.collection}/${docSnap.id}`,
            attempts: 0,
          });
          queued = true;
        }
        if (queued) scheduleLiveFlush(LIVE_FLUSH_DELAY_MS);
      },
      (error) => console.warn(`Écoute temps réel indisponible pour ${entry.collection}:`, error)
    );
    liveUnsubscribes.push(unsubscribe);
  }
  return stopRealtimeSync;
}
