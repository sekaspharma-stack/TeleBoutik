import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Smartphone, RefreshCw, Search, AlertTriangle, CheckCircle2, Ban } from 'lucide-react';
import { getDb, query, queryOne, generateId, now } from '../db/localDb';
import { addAuditLog } from '../db/audit';
import { scheduleLocalTableSync } from '../db/syncEngine';
import { useAuth } from '../context/AuthContext';
import { formatCurrency, formatDateTime } from '../lib/utils';
import type { AirtelTransaction, CashSession } from '../types';
import CustomerSelect, { type SelectedCustomer } from '../components/CustomerSelect';
import LoadingButton from '../components/LoadingButton';

type Currency = 'USD' | 'CDF';
type Operation = 'cash_in' | 'cash_out';
interface BalanceRow { currency_code: Currency; payment_method: string; direction: 'in' | 'out'; movement_type: string; amount: number; original_amount: number | null }

export default function AirtelMoneyPage() {
  const { user, store } = useAuth();
  const [session, setSession] = useState<CashSession | null>(null);
  const [transactions, setTransactions] = useState<AirtelTransaction[]>([]);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [operation, setOperation] = useState<Operation>('cash_in');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<Currency>('CDF');
  const [reference, setReference] = useState('');
  const [commission, setCommission] = useState('0');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [customer, setCustomer] = useState<SelectedCustomer | null>(null);
  const submitLock = useRef(false); // verrou synchrone anti double-soumission
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    if (!user || !store) return;
    const active = await queryOne<CashSession>("SELECT * FROM cash_sessions WHERE user_id = $1 AND status = 'open' ORDER BY opened_at DESC LIMIT 1", [user.id]);
    setSession(active);
    const transactionRows = ['owner', 'manager'].includes(user.role)
      ? await query<AirtelTransaction>('SELECT * FROM airtel_transactions WHERE store_id = $1 ORDER BY created_at DESC LIMIT 100', [store?.id])
      : await query<AirtelTransaction>('SELECT * FROM airtel_transactions WHERE agent_user_id = $1 ORDER BY created_at DESC LIMIT 100', [user.id]);
    setTransactions(transactionRows);
    if (!active) { setBalances({}); return; }
    const rows = await query<BalanceRow>('SELECT currency_code, payment_method, direction, movement_type, amount, original_amount FROM cash_movements WHERE cash_session_id = $1', [active.id]);
    const next: Record<string, number> = {};
    for (const code of ['USD', 'CDF'] as Currency[]) for (const method of ['cash', 'airtel_money']) {
      next[`${method}_${code}`] = rows.filter(r => (r.currency_code || store?.currency || 'CDF') === code && (r.payment_method || 'cash') === method)
        .reduce((sum, r) => sum + (r.direction === 'in' ? 1 : -1) * (Number(r.original_amount || 0) || Number(r.amount || 0)), 0);
    }
    setBalances(next);
  }, [user, store, store?.id, store?.currency]);

  useEffect(() => { void load(); }, [load]);

  const visibleTransactions = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return transactions;
    return transactions.filter(t => [t.customer_name, t.customer_phone, t.reference, t.operation_type].some(v => String(v ?? '').toLowerCase().includes(needle)));
  }, [transactions, search]);

  if (!user || !store) return null;
  if (!['owner', 'manager', 'seller'].includes(user.role)) return <div className="card p-6">Accès réservé au propriétaire, au gérant et aux agents de vente.</div>;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitLock.current) return;
    submitLock.current = true; setBusy(true);
    try { await submitTransaction(); } finally { submitLock.current = false; setBusy(false); }
  };

  const submitTransaction = async () => {
    setError(''); setSuccess('');
    const value = Number(amount); const fee = Number(commission || 0); const ref = reference.trim(); const phone = customerPhone.trim();
    if (!session) { setError("Ouvre d'abord une session de caisse pour cet agent."); return; }
    if (!phone || !/^[+0-9][0-9\s()-]{6,18}$/.test(phone)) { setError('Saisis un numéro de téléphone client valide.'); return; }
    if (!Number.isFinite(value) || value <= 0) { setError('Le montant doit être supérieur à zéro.'); return; }
    if (!ref) { setError('La référence Airtel Money est obligatoire.'); return; }
    if (!Number.isFinite(fee) || fee < 0 || fee > value) { setError('La commission doit être positive et ne peut pas dépasser le montant.'); return; }
    if (await queryOne<{ id: string }>('SELECT id FROM airtel_transactions WHERE reference = $1', [ref])) { setError('Cette référence Airtel Money existe déjà.'); return; }
    const cash = balances[`cash_${currency}`] ?? 0; const efloat = balances[`airtel_money_${currency}`] ?? 0;
    if (operation === 'cash_in' && efloat < value) { setError(`E-float insuffisant : solde ${formatCurrency(efloat, currency)}.`); return; }
    if (operation === 'cash_out' && cash < value) { setError(`Cash physique insuffisant : solde ${formatCurrency(cash, currency)}.`); return; }

    const id = generateId(); const timestamp = now();
    const cashDirection = operation === 'cash_in' ? 'in' : 'out';
    const floatDirection = operation === 'cash_in' ? 'out' : 'in';
    const cashReason = operation === 'cash_in' ? 'Airtel Money Cash In' : 'Airtel Money Cash Out';
    const floatReason = operation === 'cash_in' ? 'E-float utilisé pour dépôt Airtel Money' : 'E-float reçu pour retrait Airtel Money';
    const cashMoveId = generateId(); const floatMoveId = generateId();
    try {
      const db = await getDb();
      await db.exec('BEGIN');
      try {
        await db.query(`INSERT INTO airtel_transactions (id, store_id, cash_session_id, agent_user_id, operation_type, customer_name, customer_phone, amount, currency_code, reference, commission, status, notes, created_at, customer_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'completed',$12,$13,$14)`, [id, store.id, session.id, user.id, operation, customerName.trim(), phone, value, currency, ref, fee, notes.trim(), timestamp, customer?.id ?? null]);
        const movementSql = `INSERT INTO cash_movements (id, cash_session_id, movement_type, payment_method, amount, direction, reference_type, reference_id, user_id, reason, created_at, currency_code, original_amount, applied_rate) VALUES ($1,$2,$3,$4,$5,$6,'airtel_transaction',$7,$8,$9,$10,$11,$5,1)`;
        await db.query(movementSql, [cashMoveId, session.id, operation === 'cash_in' ? 'deposit' : 'withdrawal', 'cash', value, cashDirection, id, user.id, cashReason, timestamp, currency]);
        await db.query(movementSql, [floatMoveId, session.id, operation === 'cash_in' ? 'deposit' : 'withdrawal', 'airtel_money', value, floatDirection, id, user.id, floatReason, timestamp, currency]);
        await db.exec('COMMIT');
      } catch (err) { await db.exec('ROLLBACK'); throw err; }
      // Persist the sync queue only after the transaction commits successfully.
      const pending = [ ['airtel_transactions', id], ['cash_movements', cashMoveId], ['cash_movements', floatMoveId] ];
      for (const [table, recordId] of pending) {
        await db.query("INSERT INTO app_meta (key, value) VALUES ($1, 'upsert') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [`cloud_pending:${table}:${recordId}`]);
        scheduleLocalTableSync(table, recordId);
      }
      await addAuditLog(user, 'airtel_transaction', 'create', null, { id, operation, amount: value, currency, reference: ref, cash_session_id: session.id });
      setSuccess(`${operation === 'cash_in' ? 'Dépôt' : 'Retrait'} enregistré. Référence : ${ref}`);
      setCustomerName(''); setCustomerPhone(''); setCustomer(null); setAmount(''); setReference(''); setCommission('0'); setNotes('');
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(/unique|duplicate/i.test(message) ? 'Référence déjà utilisée. Vérifie le SMS Airtel Money.' : `Opération non enregistrée : ${message}`);
    }
  };

  const cancelTransaction = async (transaction: AirtelTransaction) => {
    if (!user || !['owner', 'manager'].includes(user.role)) return;
    if (transaction.status !== 'completed') return;
    const reason = window.prompt(`Motif obligatoire pour annuler la référence ${transaction.reference} :`);
    if (!reason?.trim()) return;
    if (!window.confirm('Confirmer l’annulation ? Une écriture inverse sera créée, sans supprimer l’opération d’origine.')) return;
    setError(''); setSuccess(''); setBusy(true);
    const timestamp = now();
    const reversalId1 = generateId(); const reversalId2 = generateId();
    const reverseCashDirection = transaction.operation_type === 'cash_in' ? 'out' : 'in';
    const reverseFloatDirection = transaction.operation_type === 'cash_in' ? 'in' : 'out';
    try {
      const db = await getDb();
      await db.exec('BEGIN');
      try {
        const current = await db.query<{ status: string }>('SELECT status FROM airtel_transactions WHERE id = $1', [transaction.id]);
        if (current.rows[0]?.status !== 'completed') throw new Error('Cette opération a déjà été annulée ou modifiée. Actualise l’historique.');
        const original = await db.query<{ id: string; payment_method: string; direction: string; amount: number }>("SELECT id, payment_method, direction, amount FROM cash_movements WHERE reference_type = 'airtel_transaction' AND reference_id = $1", [transaction.id]);
        if (original.rows.length < 2) throw new Error('Les mouvements d’origine sont incomplets. Annulation automatique bloquée.');
        const movementSql = `INSERT INTO cash_movements (id, cash_session_id, movement_type, payment_method, amount, direction, reference_type, reference_id, user_id, reason, created_at, currency_code, original_amount, applied_rate) VALUES ($1,$2,$3,$4,$5,$6,'airtel_cancellation',$7,$8,$9,$10,$11,$5,1)`;
        await db.query(movementSql, [reversalId1, transaction.cash_session_id, 'adjustment', 'cash', transaction.amount, reverseCashDirection, transaction.id, user.id, `Annulation Airtel Money: ${reason.trim()}`, timestamp, transaction.currency_code]);
        await db.query(movementSql, [reversalId2, transaction.cash_session_id, 'adjustment', 'airtel_money', transaction.amount, reverseFloatDirection, transaction.id, user.id, `Annulation Airtel Money: ${reason.trim()}`, timestamp, transaction.currency_code]);
        await db.query("UPDATE airtel_transactions SET status = 'cancelled', cancel_reason = $1, cancelled_by = $2, cancelled_at = $3 WHERE id = $4 AND status = 'completed'", [reason.trim(), user.id, timestamp, transaction.id]);
        await db.exec('COMMIT');
      } catch (err) { await db.exec('ROLLBACK'); throw err; }
      for (const [table, recordId] of [['airtel_transactions', transaction.id], ['cash_movements', reversalId1], ['cash_movements', reversalId2]]) {
        await db.query("INSERT INTO app_meta (key, value) VALUES ($1, 'upsert') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [`cloud_pending:${table}:${recordId}`]);
        scheduleLocalTableSync(table, recordId);
      }
      await addAuditLog(user, 'airtel_transaction', 'cancel', transaction, { ...transaction, status: 'cancelled', cancel_reason: reason.trim(), cancelled_by: user.id, cancelled_at: timestamp });
      setSuccess(`Annulation enregistrée pour ${transaction.reference}. L’historique d’origine est conservé.`);
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Échec de l’annulation.'); }
    finally { setBusy(false); }
  };

  return <div className="space-y-6">
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div><h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><Smartphone className="w-7 h-7 text-red-600" /> Shop Airtel Money</h1><p className="text-sm text-slate-500 mt-1">Dépôts Cash In et retraits Cash Out · Référence obligatoire · {user.name}</p></div>
      <button className="btn-secondary" onClick={() => void load()}><RefreshCw className="w-4 h-4 inline mr-2" />Actualiser</button>
    </div>

    {!session && <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900 flex gap-3"><AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" /><div><p className="font-semibold">Aucune session de caisse ouverte</p><p className="text-sm mt-1">Ouvre une session dans le menu Caisse avant d'enregistrer des dépôts ou retraits. Cela permet de contrôler les soldes réels de cet agent.</p></div></div>}

    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
      {(['USD','CDF'] as Currency[]).flatMap(code => ([{ method: 'cash', label: 'Cash physique' }, { method: 'airtel_money', label: 'E-float Airtel Money' }].map(item => <div key={`${item.method}_${code}`} className="card p-4"><p className="text-xs text-slate-500">{item.label} · {code}</p><p className="text-xl font-bold text-slate-900 mt-2">{formatCurrency(balances[`${item.method}_${code}`] ?? 0, code)}</p></div>)))}
    </div>

    <div className="card p-4 sm:p-6">
      <div className="flex gap-2 mb-5"><button type="button" className={operation === 'cash_in' ? 'btn-primary' : 'btn-secondary'} onClick={() => setOperation('cash_in')}><ArrowDownLeft className="w-4 h-4 inline mr-2" />Dépôt / Cash In</button><button type="button" className={operation === 'cash_out' ? 'btn-primary' : 'btn-secondary'} onClick={() => setOperation('cash_out')}><ArrowUpRight className="w-4 h-4 inline mr-2" />Retrait / Cash Out</button></div>
      {error && <div role="alert" className="mb-4 rounded-lg bg-red-50 text-red-700 border border-red-200 p-3 text-sm">{error}</div>}
      {success && <div role="status" className="mb-4 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 p-3 text-sm"><CheckCircle2 className="inline w-4 h-4 mr-2" />{success}</div>}
      <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <CustomerSelect value={customer} phoneHint={customerPhone} onSelect={(c) => { setCustomer(c); if (c) { setCustomerName(c.name); setCustomerPhone(c.phone); } }} />
        <label className="text-sm font-medium text-slate-700">Nom du client (facultatif)<input className="input mt-1" value={customerName} onChange={e => setCustomerName(e.target.value)} maxLength={120} /></label>
        <label className="text-sm font-medium text-slate-700">Téléphone du client *<input className="input mt-1" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} required maxLength={24} placeholder="+243…" /></label>
        <label className="text-sm font-medium text-slate-700">Montant *<input className="input mt-1" type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} required /></label>
        <label className="text-sm font-medium text-slate-700">Devise<select className="input mt-1" value={currency} onChange={e => setCurrency(e.target.value as Currency)}><option value="CDF">CDF — Franc congolais</option><option value="USD">USD — Dollar américain</option></select></label>
        <label className="text-sm font-medium text-slate-700">Référence Airtel Money *<input className="input mt-1" value={reference} onChange={e => setReference(e.target.value)} required maxLength={100} /></label>
        <label className="text-sm font-medium text-slate-700">Commission constatée<input className="input mt-1" type="number" min="0" step="0.01" value={commission} onChange={e => setCommission(e.target.value)} /><span className="block text-xs text-slate-400 mt-1">Enregistrée pour les rapports, sans modifier automatiquement le cash ou l’e-float.</span></label>
        <label className="text-sm font-medium text-slate-700 md:col-span-2">Notes (facultatif)<input className="input mt-1" value={notes} onChange={e => setNotes(e.target.value)} maxLength={500} /></label>
        <div className="md:col-span-2 flex justify-end"><LoadingButton className="btn-primary" type="submit" loading={busy} loadingText="Enregistrement…" disabled={!session}>{`Confirmer le ${operation === 'cash_in' ? 'dépôt' : 'retrait'}`}</LoadingButton></div>
      </form>
      <p className="text-xs text-slate-500 mt-4">Attention : confirme toujours l'opération dans le SMS ou l'historique Airtel Money avant de la valider ici. La référence ne doit être utilisée qu'une seule fois.</p>
    </div>

    <div className="card overflow-hidden"><div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between"><div><h2 className="font-semibold text-slate-900">Historique des opérations</h2><p className="text-xs text-slate-500 mt-1">Les 100 dernières opérations de l’agent ou de la cabine</p></div><div className="relative"><Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" /><input className="input pl-9" value={search} onChange={e => setSearch(e.target.value)} placeholder="Référence ou client…" /></div></div>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-slate-500"><tr><th className="text-left p-3">Date</th><th className="text-left p-3">Opération</th><th className="text-left p-3">Client</th><th className="text-left p-3">Référence</th><th className="text-right p-3">Montant</th><th className="text-right p-3">Commission</th><th className="text-left p-3">Statut</th><th className="p-3">Action</th></tr></thead><tbody>{visibleTransactions.map(t => <tr key={t.id} className="border-t border-slate-100"><td className="p-3 whitespace-nowrap">{formatDateTime(t.created_at)}</td><td className="p-3">{t.operation_type === 'cash_in' ? <span className="text-emerald-700">Dépôt</span> : <span className="text-blue-700">Retrait</span>}</td><td className="p-3">{t.customer_name || t.customer_phone}<div className="text-xs text-slate-400">{t.customer_phone}</div></td><td className="p-3 font-mono text-xs">{t.reference}</td><td className="p-3 text-right whitespace-nowrap">{formatCurrency(t.amount, t.currency_code)}</td><td className="p-3 text-right whitespace-nowrap">{formatCurrency(t.commission, t.currency_code)}</td><td className="p-3">{t.status === 'cancelled' ? <span className="text-red-700">Annulée</span> : <span className="text-emerald-700">Réussie</span>}{t.status === 'cancelled' && <div className="text-xs text-slate-400 max-w-48">{t.cancel_reason}</div>}</td><td className="p-3">{t.status === 'completed' && ['owner','manager'].includes(user.role) && <button type="button" className="text-red-700 text-xs font-medium disabled:opacity-50" disabled={busy} onClick={() => void cancelTransaction(t)}><Ban className="inline w-3 h-3 mr-1"/>Annuler</button>}</td></tr>)}{visibleTransactions.length === 0 && <tr><td colSpan={8} className="p-8 text-center text-slate-400">Aucune opération à afficher.</td></tr>}</tbody></table></div>
    </div>
  </div>;
}
