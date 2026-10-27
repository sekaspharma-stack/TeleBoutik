import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { RadioTower, Search, Ban, CheckCircle2, AlertTriangle } from 'lucide-react';
import { getDb, query, queryOne, generateId, now } from '../db/localDb';
import { addAuditLog } from '../db/audit';
import { scheduleLocalTableSync } from '../db/syncEngine';
import { useAuth } from '../context/AuthContext';
import { formatCurrency, formatDateTime } from '../lib/utils';
import type { CashSession, TelecomTransaction } from '../types';

type Currency = 'USD' | 'CDF';
type Operator = TelecomTransaction['operator'];
type PaymentMethod = TelecomTransaction['payment_method'];
interface MovementRow { currency_code: Currency; payment_method: string; direction: 'in' | 'out'; amount: number; original_amount: number | null }
const operators: { value: Operator; label: string; method: PaymentMethod }[] = [
  { value: 'airtel', label: 'Airtel', method: 'airtel_money' },
  { value: 'orange', label: 'Orange', method: 'orange_money' },
  { value: 'mtn', label: 'MTN', method: 'mtn_momo' },
  { value: 'vodacom', label: 'Vodacom', method: 'vodacom_money' },
];
const paymentOptions: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash physique' }, { value: 'airtel_money', label: 'Airtel Money' },
  { value: 'orange_money', label: 'Orange Money' }, { value: 'mtn_momo', label: 'MTN MoMo' },
  { value: 'vodacom_money', label: 'Vodacom M-Pesa' }, { value: 'wave', label: 'Wave' },
  { value: 'card', label: 'Carte' }, { value: 'transfer', label: 'Virement' },
];

export default function TelecomSalesPage() {
  const { user, store } = useAuth();
  const [session, setSession] = useState<CashSession | null>(null);
  const [rows, setRows] = useState<TelecomTransaction[]>([]);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [serviceType, setServiceType] = useState<'units' | 'data_bundle'>('units');
  const [operator, setOperator] = useState<Operator>('airtel');
  const [phone, setPhone] = useState('');
  const [serviceName, setServiceName] = useState('');
  const [faceValue, setFaceValue] = useState('');
  const [costAmount, setCostAmount] = useState('');
  const [saleAmount, setSaleAmount] = useState('');
  const [currency, setCurrency] = useState<Currency>('CDF');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    if (!user || !store) return;
    const active = await queryOne<CashSession>("SELECT * FROM cash_sessions WHERE user_id = $1 AND status = 'open' ORDER BY opened_at DESC LIMIT 1", [user.id]);
    setSession(active);
    const history = ['owner', 'manager'].includes(user.role)
      ? await query<TelecomTransaction>('SELECT * FROM telecom_transactions WHERE store_id = $1 ORDER BY created_at DESC LIMIT 150', [store.id])
      : await query<TelecomTransaction>('SELECT * FROM telecom_transactions WHERE agent_user_id = $1 ORDER BY created_at DESC LIMIT 150', [user.id]);
    setRows(history);
    if (!active) { setBalances({}); return; }
    const movements = await query<MovementRow>('SELECT currency_code, payment_method, direction, amount, original_amount FROM cash_movements WHERE cash_session_id = $1', [active.id]);
    const next: Record<string, number> = {};
    for (const code of ['USD', 'CDF'] as Currency[]) for (const method of ['cash', 'airtel_money', 'orange_money', 'mtn_momo', 'vodacom_money']) {
      next[`${method}_${code}`] = movements.filter(m => (m.currency_code || store.currency || 'CDF') === code && m.payment_method === method)
        .reduce((sum, m) => sum + (m.direction === 'in' ? 1 : -1) * (Number(m.original_amount || 0) || Number(m.amount || 0)), 0);
    }
    setBalances(next);
  }, [user, store]);
  useEffect(() => { void load(); }, [load]);

  const visibleRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(r => [r.customer_phone, r.service_name, r.reference, r.operator, r.service_type].some(v => String(v ?? '').toLowerCase().includes(needle)));
  }, [rows, search]);
  const margin = Number(saleAmount || 0) - Number(costAmount || 0);
  if (!user || !store) return null;
  if (!['owner', 'manager', 'seller'].includes(user.role)) return <div className="card p-6">Accès réservé au propriétaire, au gérant et aux agents de vente.</div>;

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setSuccess('');
    const face = Number(faceValue); const cost = Number(costAmount); const sale = Number(saleAmount); const ref = reference.trim(); const clientPhone = phone.trim();
    if (!session) { setError('Ouvre une session de caisse avant d’enregistrer une vente.'); return; }
    if (!clientPhone || !/^[+0-9][0-9\s()-]{6,18}$/.test(clientPhone)) { setError('Saisis un numéro de téléphone valide.'); return; }
    if (!serviceName.trim()) { setError('Précise le nom des unités ou du forfait.'); return; }
    if (![face, cost, sale].every(Number.isFinite) || face <= 0 || cost < 0 || sale <= 0 || cost > sale) { setError('Vérifie les montants : valeur et vente positives, coût non négatif et coût inférieur ou égal au prix de vente.'); return; }
    if (!ref) { setError('La référence de l’opération est obligatoire pour éviter les doublons.'); return; }
    if (await queryOne<{ id: string }>('SELECT id FROM telecom_transactions WHERE reference = $1', [ref])) { setError('Cette référence existe déjà. Vérifie le reçu de l’opérateur.'); return; }
    const operatorMethod = operators.find(o => o.value === operator)!.method;
    const float = balances[`${operatorMethod}_${currency}`] ?? 0;
    if (float < cost) { setError(`Solde e-float ${operators.find(o => o.value === operator)!.label} insuffisant : ${formatCurrency(float, currency)} disponible, ${formatCurrency(cost, currency)} requis.`); return; }
    setBusy(true);
    const id = generateId(); const timestamp = now(); const incomingId = generateId(); const floatId = generateId();
    try {
      const db = await getDb();
      await db.exec('BEGIN');
      try {
        await db.query(`INSERT INTO telecom_transactions (id, store_id, cash_session_id, agent_user_id, service_type, operator, customer_phone, service_name, face_value, cost_amount, sale_amount, currency_code, payment_method, reference, status, notes, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'completed',$15,$16)`, [id, store.id, session.id, user.id, serviceType, operator, clientPhone, serviceName.trim(), face, cost, sale, currency, paymentMethod, ref, notes.trim(), timestamp]);
        const sql = `INSERT INTO cash_movements (id, cash_session_id, movement_type, payment_method, amount, direction, reference_type, reference_id, user_id, reason, created_at, currency_code, original_amount, applied_rate) VALUES ($1,$2,'sale',$3,$4,$5,'telecom_transaction',$6,$7,$8,$9,$10,$4,1)`;
        await db.query(sql, [incomingId, session.id, paymentMethod, sale, 'in', id, user.id, `Vente ${serviceType === 'units' ? 'unités' : 'Megas'} ${operator.toUpperCase()} - paiement client`, timestamp, currency]);
        await db.query(sql, [floatId, session.id, operatorMethod, cost, 'out', id, user.id, `E-float consommé - ${serviceName.trim()} (${operator.toUpperCase()})`, timestamp, currency]);
        await db.exec('COMMIT');
      } catch (err) { await db.exec('ROLLBACK'); throw err; }
      for (const [table, recordId] of [['telecom_transactions', id], ['cash_movements', incomingId], ['cash_movements', floatId]]) {
        await db.query("INSERT INTO app_meta (key, value) VALUES ($1, 'upsert') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [`cloud_pending:${table}:${recordId}`]);
        scheduleLocalTableSync(table, recordId);
      }
      await addAuditLog(user, 'telecom_transaction', 'create', null, { id, serviceType, operator, faceValue: face, costAmount: cost, saleAmount: sale, currency, reference: ref, cashSessionId: session.id });
      setSuccess(`Vente enregistrée. Marge brute estimée : ${formatCurrency(sale - cost, currency)}. Référence : ${ref}`);
      setPhone(''); setServiceName(''); setFaceValue(''); setCostAmount(''); setSaleAmount(''); setReference(''); setNotes('');
      await load();
    } catch (err) { const msg = err instanceof Error ? err.message : String(err); setError(/unique|duplicate/i.test(msg) ? 'Référence déjà utilisée.' : `Vente non enregistrée : ${msg}`); }
    finally { setBusy(false); }
  };

  const cancel = async (row: TelecomTransaction) => {
    if (!['owner', 'manager'].includes(user.role) || row.status !== 'completed') return;
    const reason = window.prompt(`Motif obligatoire pour annuler ${row.reference} :`);
    if (!reason?.trim() || !window.confirm('Confirmer l’annulation ? Les mouvements inverses seront conservés dans l’historique.')) return;
    setBusy(true); setError(''); setSuccess('');
    try {
      const db = await getDb(); const timestamp = now(); const reversalIds: string[] = [];
      await db.exec('BEGIN');
      try {
        const current = await db.query<{ status: string }>('SELECT status FROM telecom_transactions WHERE id = $1', [row.id]);
        if (current.rows[0]?.status !== 'completed') throw new Error('Cette vente est déjà annulée. Actualise la page.');
        const original = await db.query<{ cash_session_id: string; payment_method: string; amount: number; direction: 'in'|'out'; user_id: string; currency_code: string }>("SELECT cash_session_id, payment_method, amount, direction, user_id, currency_code FROM cash_movements WHERE reference_type = 'telecom_transaction' AND reference_id = $1", [row.id]);
        if (original.rows.length !== 2) throw new Error('Les écritures d’origine sont incomplètes. Annulation bloquée pour protéger la caisse.');
        for (const movement of original.rows) {
          const reversalId = generateId(); reversalIds.push(reversalId);
          await db.query(`INSERT INTO cash_movements (id, cash_session_id, movement_type, payment_method, amount, direction, reference_type, reference_id, user_id, reason, created_at, currency_code, original_amount, applied_rate) VALUES ($1,$2,'adjustment',$3,$4,$5,'telecom_cancellation',$6,$7,$8,$9,$10,$4,1)`, [reversalId, movement.cash_session_id, movement.payment_method, movement.amount, movement.direction === 'in' ? 'out' : 'in', row.id, user.id, `Annulation vente télécom : ${reason.trim()}`, timestamp, movement.currency_code]);
        }
        await db.query("UPDATE telecom_transactions SET status = 'cancelled', cancel_reason = $1, cancelled_by = $2, cancelled_at = $3 WHERE id = $4", [reason.trim(), user.id, timestamp, row.id]);
        await db.exec('COMMIT');
      } catch (err) { await db.exec('ROLLBACK'); throw err; }
      for (const rid of reversalIds) { await db.query("INSERT INTO app_meta (key, value) VALUES ($1, 'upsert') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [`cloud_pending:cash_movements:${rid}`]); scheduleLocalTableSync('cash_movements', rid); }
      await db.query("INSERT INTO app_meta (key, value) VALUES ($1, 'upsert') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [`cloud_pending:telecom_transactions:${row.id}`]); scheduleLocalTableSync('telecom_transactions', row.id);
      await addAuditLog(user, 'telecom_transaction', 'cancel', { id: row.id, status: 'completed' }, { id: row.id, status: 'cancelled', reason: reason.trim() });
      setSuccess(`Vente ${row.reference} annulée avec écritures inverses.`); await load();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };

  const labelOperator = (value: string) => operators.find(o => o.value === value)?.label ?? value;
  return <div className="space-y-5">
    <div className="flex items-center gap-3"><div className="p-3 rounded-xl bg-violet-100 text-violet-700"><RadioTower className="w-6 h-6" /></div><div><h1 className="text-2xl font-bold text-slate-900">Vente d’unités & Megas</h1><p className="text-sm text-slate-500">Recharge mobile, forfaits data, marge et e-float par opérateur.</p></div></div>
    {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertTriangle className="inline w-4 h-4 mr-2" />{error}</div>}
    {success && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 className="inline w-4 h-4 mr-2" />{success}</div>}
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">{(['cash','airtel_money','orange_money','mtn_momo','vodacom_money'] as const).map(method => <div key={method} className="card p-3"><p className="text-xs text-slate-500">{({cash:'Cash physique',airtel_money:'E-float Airtel',orange_money:'E-float Orange',mtn_momo:'E-float MTN',vodacom_money:'E-float Vodacom'})[method]} · USD</p><p className="font-bold">{formatCurrency(balances[`${method}_USD`] ?? 0, 'USD')}</p><p className="text-xs text-slate-500 mt-1">CDF : {formatCurrency(balances[`${method}_CDF`] ?? 0, 'CDF')}</p></div>)}</div>
    <form onSubmit={submit} className="card p-4 md:p-5"><div className="flex flex-wrap gap-2 mb-4"><button type="button" onClick={() => setServiceType('units')} className={`px-4 py-2 rounded-lg text-sm font-semibold ${serviceType === 'units' ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-700'}`}>Vente d’unités</button><button type="button" onClick={() => setServiceType('data_bundle')} className={`px-4 py-2 rounded-lg text-sm font-semibold ${serviceType === 'data_bundle' ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-700'}`}>Forfait Megas / Data</button></div>
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        <label className="text-sm font-medium text-slate-700">Opérateur *<select className="input mt-1" value={operator} onChange={e => setOperator(e.target.value as Operator)}>{operators.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
        <label className="text-sm font-medium text-slate-700">Téléphone client *<input className="input mt-1" value={phone} onChange={e => setPhone(e.target.value)} required maxLength={24} placeholder="+243…" /></label>
        <label className="text-sm font-medium text-slate-700">Nom du service / forfait *<input className="input mt-1" value={serviceName} onChange={e => setServiceName(e.target.value)} required maxLength={120} placeholder={serviceType === 'units' ? 'Unités 5 000 CDF' : 'Forfait 2 Go / 7 jours'} /></label>
        <label className="text-sm font-medium text-slate-700">Valeur reçue par le client *<input className="input mt-1" type="number" min="0.01" step="0.01" value={faceValue} onChange={e => setFaceValue(e.target.value)} required /></label>
        <label className="text-sm font-medium text-slate-700">Coût e-float consommé *<input className="input mt-1" type="number" min="0" step="0.01" value={costAmount} onChange={e => setCostAmount(e.target.value)} required /></label>
        <label className="text-sm font-medium text-slate-700">Prix payé par le client *<input className="input mt-1" type="number" min="0.01" step="0.01" value={saleAmount} onChange={e => setSaleAmount(e.target.value)} required /></label>
        <label className="text-sm font-medium text-slate-700">Devise<select className="input mt-1" value={currency} onChange={e => setCurrency(e.target.value as Currency)}><option value="CDF">CDF</option><option value="USD">USD</option></select></label>
        <label className="text-sm font-medium text-slate-700">Mode de paiement reçu<select className="input mt-1" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as PaymentMethod)}>{paymentOptions.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}</select></label>
        <label className="text-sm font-medium text-slate-700">Référence unique de l’opération *<input className="input mt-1" value={reference} onChange={e => setReference(e.target.value)} required maxLength={100} /></label>
        <label className="text-sm font-medium text-slate-700 md:col-span-2 xl:col-span-3">Notes (facultatif)<input className="input mt-1" value={notes} onChange={e => setNotes(e.target.value)} maxLength={500} /></label>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className={`text-sm font-semibold ${margin < 0 ? 'text-red-700' : 'text-emerald-700'}`}>Marge brute estimée : {formatCurrency(margin, currency)}<span className="block text-xs font-normal text-slate-500">Calcul : prix payé − coût e-float. Le coût doit être couvert par le solde opérateur.</span></p><button className="btn-primary" type="submit" disabled={busy || !session}>{busy ? 'Enregistrement…' : 'Enregistrer la vente'}</button></div>
      {!session && <p className="text-xs text-amber-700 mt-3">Ouvre une session de caisse pour enregistrer une vente.</p>}
    </form>
    <div className="card overflow-hidden"><div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between"><div><h2 className="font-semibold text-slate-900">Historique des recharges</h2><p className="text-xs text-slate-500 mt-1">Les 150 dernières opérations de l’agent ou de la cabine.</p></div><div className="relative"><Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" /><input className="input pl-9" value={search} onChange={e => setSearch(e.target.value)} placeholder="Téléphone, forfait, référence…" /></div></div>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-slate-500"><tr><th className="text-left p-3">Date</th><th className="text-left p-3">Type / opérateur</th><th className="text-left p-3">Client</th><th className="text-left p-3">Référence</th><th className="text-right p-3">Coût</th><th className="text-right p-3">Vente</th><th className="text-right p-3">Marge</th><th className="text-left p-3">Statut</th><th className="p-3">Action</th></tr></thead><tbody>{visibleRows.map(r => <tr key={r.id} className="border-t border-slate-100"><td className="p-3 whitespace-nowrap">{formatDateTime(r.created_at)}</td><td className="p-3">{r.service_type === 'units' ? 'Unités' : 'Megas / Data'}<div className="text-xs text-slate-500">{labelOperator(r.operator)} · {r.service_name}</div></td><td className="p-3 whitespace-nowrap">{r.customer_phone}</td><td className="p-3 font-mono text-xs">{r.reference}</td><td className="p-3 text-right whitespace-nowrap">{formatCurrency(r.cost_amount, r.currency_code)}</td><td className="p-3 text-right whitespace-nowrap">{formatCurrency(r.sale_amount, r.currency_code)}</td><td className="p-3 text-right whitespace-nowrap">{formatCurrency(r.sale_amount - r.cost_amount, r.currency_code)}</td><td className="p-3">{r.status === 'cancelled' ? <span className="text-red-700">Annulée<div className="text-xs text-slate-400">{r.cancel_reason}</div></span> : <span className="text-emerald-700">Réussie</span>}</td><td className="p-3">{r.status === 'completed' && ['owner','manager'].includes(user.role) && <button type="button" disabled={busy} onClick={() => void cancel(r)} className="text-red-700 text-xs font-medium disabled:opacity-50"><Ban className="inline w-3 h-3 mr-1"/>Annuler</button>}</td></tr>)}{visibleRows.length === 0 && <tr><td colSpan={9} className="p-8 text-center text-slate-400">Aucune recharge à afficher.</td></tr>}</tbody></table></div></div>
  </div>;
}
