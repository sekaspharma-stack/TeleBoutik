import { collection, doc, getDocs, serverTimestamp, writeBatch, setDoc } from 'firebase/firestore';
import { db, isFirebaseConfigured } from './firebaseClient';
import type { User } from '../types';

// Business data only: preserve store configuration, owner/user accounts and audit history.
/**
 * Firestore collections containing resettable operational/business data.
 * Keep stores, app_users, settings and audit_log intentionally: they contain
 * shop configuration, accounts and the permanent audit trail. Include newer
 * feature collections even when the current sync engine does not yet map them,
 * so older/manual cloud records cannot survive a reset unnoticed.
 */
export const RESETTABLE_COLLECTIONS = [
  // Catalogue, serialized stock and stock history
  'products', 'product_variants', 'imei_units', 'stock_movements', 'stock_restock_suggestions',
  // Customers, suppliers, sales, receipts and accounting
  'customers', 'suppliers', 'sales', 'sale_lines', 'sale_payments',
  'expenses', 'journal_entries', 'currency_exchanges',
  // Cash and mobile-money / telecom operations
  'cash_sessions', 'cash_movements', 'airtel_transactions', 'telecom_transactions', 'telecom_stock',
  'sim_cards', 'sim_stock_batches', 'sim_batch_sales', 'cabins', 'commission_rules',
  // Purchases, inventory and trade-ins
  'purchases', 'purchase_lines', 'inventory_sessions', 'trade_ins',
  // Newer modules: warranty/SAV, customer debt and reminders, approvals and backups
  'warranty_records', 'repair_records', 'customer_debt_ledger', 'debt_reminders',
  'credit_plans', 'credit_installments', 'manager_approvals', 'backup_records',
] as const;

export async function resetCloudBusinessData(user: User): Promise<{ deleted: number; collectionsChecked: number }> {
  if (user.role !== 'owner') throw new Error('Seul le propriétaire peut réinitialiser les données cloud.');
  if (!isFirebaseConfigured) throw new Error('Firebase n’est pas configuré.');
  if (!navigator.onLine) throw new Error('Connexion Internet requise pour réinitialiser les données cloud.');

  let deleted = 0;
  let collectionsChecked = 0;
  for (const name of RESETTABLE_COLLECTIONS) {
    const snapshot = await getDocs(collection(db, name));
    collectionsChecked += 1;
    for (let offset = 0; offset < snapshot.docs.length; offset += 400) {
      const batch = writeBatch(db);
      for (const item of snapshot.docs.slice(offset, offset + 400)) {
        batch.delete(doc(db, name, item.id));
        deleted++;
      }
      await batch.commit();
    }
  }

  // Publish an explicit reset epoch only after every collection deletion succeeds.
  // Other devices compare this marker before reconciling/pushing their stale local queue.
  const resetId = `${Date.now()}-${user.id}`;
  await setDoc(doc(db, 'system_state', 'business_data'), {
    reset_id: resetId,
    reset_at: new Date().toISOString(),
    reset_by: user.id,
    scope: 'business_data',
    preserved: ['stores', 'app_users', 'settings', 'audit_log'],
  });

  // Keep the audit collection intact and append a permanent reset event after deletion.
  const auditRef = doc(collection(db, 'audit_log'));
  await writeBatch(db).set(auditRef, {
    id: auditRef.id,
    user_id: user.id,
    user_role: user.role,
    entity: 'cloud_database',
    action: 'reset_cloud_business_data',
    before_data: { collections: [...RESETTABLE_COLLECTIONS], collections_checked: collectionsChecked, documents_deleted: deleted },
    after_data: { status: 'completed', scope: 'cloud_business_data_only', reset_id: resetId, preserved: ['stores', 'app_users', 'settings', 'audit_log'] },
    created_at: new Date().toISOString(),
    synced_at: serverTimestamp(),
  }).commit();
  return { deleted, collectionsChecked };
}
