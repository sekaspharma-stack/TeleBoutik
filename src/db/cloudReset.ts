import { collection, doc, getDocs, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db, isFirebaseConfigured } from './firebaseClient';
import type { User } from '../types';

// Business data only: preserve store configuration, owner/user accounts and audit history.
const RESETTABLE_COLLECTIONS = [
  'products', 'product_variants', 'imei_units', 'stock_movements', 'customers', 'suppliers',
  'sales', 'sale_lines', 'sale_payments', 'cash_sessions', 'cash_movements', 'airtel_transactions', 'telecom_transactions', 'telecom_stock', 'sim_cards', 'sim_stock_batches', 'sim_batch_sales', 'cabins', 'commission_rules', 'currency_exchanges',
  'expenses', 'journal_entries', 'settings', 'credit_plans', 'credit_installments', 'purchases',
  'purchase_lines', 'inventory_sessions', 'trade_ins',
];

export async function resetCloudBusinessData(user: User): Promise<{ deleted: number }> {
  if (user.role !== 'owner') throw new Error('Seul le propriétaire peut réinitialiser les données cloud.');
  if (!isFirebaseConfigured) throw new Error('Firebase n’est pas configuré.');
  if (!navigator.onLine) throw new Error('Connexion Internet requise pour réinitialiser les données cloud.');

  let deleted = 0;
  for (const name of RESETTABLE_COLLECTIONS) {
    const snapshot = await getDocs(collection(db, name));
    for (let offset = 0; offset < snapshot.docs.length; offset += 400) {
      const batch = writeBatch(db);
      for (const item of snapshot.docs.slice(offset, offset + 400)) {
        batch.delete(doc(db, name, item.id));
        deleted++;
      }
      await batch.commit();
    }
  }

  // Keep the audit collection intact and append a permanent reset event after deletion.
  const auditRef = doc(collection(db, 'audit_log'));
  await writeBatch(db).set(auditRef, {
    id: auditRef.id,
    user_id: user.id,
    user_role: user.role,
    entity: 'cloud_database',
    action: 'reset_cloud_business_data',
    before_data: { collections: RESETTABLE_COLLECTIONS, documents_deleted: deleted },
    after_data: { status: 'completed', scope: 'cloud_business_data_only' },
    created_at: new Date().toISOString(),
    synced_at: serverTimestamp(),
  }).commit();
  return { deleted };
}
