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
];
const paymentOptions: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Espèces' }, { value: 'airtel_money', label: 'Airtel Money' },
];

export default function TelecomSalesPage() {
  const { user, store } = useAuth();
  const [session, setSession] = useState<CashSession | null>(null);
  const [rows, setRows] = useState<TelecomTransaction[]>([]);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [unitStock, setUnitStock] = useState<Record<string, number>>({ units: 0, data_bundle: 0 });
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
    const stockRows = await query<{ service_type: 'units' | 'data_bundle'; quantity: number }>(`SELECT service_type, quantity FROM telecom_stock WHERE store_id = $1 AND operator = 'airtel'`, [store.id]);
    setUnitStock({ units: Number(stockRows.find(r => r.service_type === 'units')?.quantity ?? 0), data_bundle: Number(stockRows.find(r => r.service_type === 'data_bundle')?.quantity ?? 0) });
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
    const quantity = Number(faceValue); const face = quantity; const cost = Number(costAmount); const sale = Number(saleAmount); const ref = reference.trim() || `TB-${Date.now()}`; const clientPhone = phone.trim();
    if (!session) { setError('Ouvre une session de caisse avant d’enregistrer une vente.'); return; }
    if (clientPhone && !/^[+0-9][0-9\s()-]{6,18}$/.test(clientPhone)) { setError('Vérifie le numéro du client ou laisse ce champ vide.'); return; }
    const effectiveServiceName = serviceName.trim() || (serviceType === 'units' ? 'Unités Airtel' : 'Megas Airtel');
    if (![face, cost, sale].every(Number.isFinite) || !Number.isInteger(quantity) || quantity <= 0 || cost < 0 || sale <= 0 || cost > sale) { setError('Vérifie les montants : valeur et vente positives, coût non négatif et coût inférieur ou égal au prix de vente.'); return; }
    const stockRow = await queryOne<{ id: string; quantity: number }>('SELECT id, quantity FROM telecom_stock WHERE store_id = $1 AND service_type = $2 AND operator = $3', [store.id, serviceType, operator]);
    if (!stockRow || Number(stockRow.quantity) < quantity) { setError(`Stock ${serviceType === 'units' ? 'unités' : 'Megas'} insuffisant. Disponible : ${Number(stockRow?.quantity ?? 0).toLocaleString('fr-FR')} unités.`); return; }
    if (await queryOne<{ id: string }>('SELECT id FROM telecom_transactions WHERE reference = $1', [ref])) { setError('Cette référence existe déjà. Vérifie le reçu de l’opérateur.'); return; }
    setBusy(true);
    const id = generateId(); const timestamp = now(); const incomingId = generateId();
    try {
      const db = await getDb();
      await db.exec('BEGIN');
      try {
        await db.query(`INSERT INTO telecom_transactions (id, store_id, cash_session_id, agent_user_id, service_type, operator, customer_phone, service_name, face_value, quantity, cost_amount, sale_amount, currency_code, payment_method, reference, status, notes, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'completed',$16,$17)`, [id, store.id, session.id, user.id, serviceType, operator, clientPhone, effectiveServiceName, face, quantity, cost, sale, currency, paymentMethod, ref, notes.trim(), timestamp]);
        const sql = `INSERT INTO cash_movements (id, cash_session_id, movement_type, payment_method, amount, direction, reference_type, reference_id, user_id, reason, created_at, currency_code, original_amount, applied_rate) VALUES ($1,$2,'sale',$3,$4,$5,'telecom_transaction',$6,$7,$8,$9,$10,$4,1)`;
        await db.query(sql, [incomingId, session.id, paymentMethod, sale, 'in', id, user.id, `Vente ${serviceType === 'units' ? 'unités' : 'Megas'} ${operator.toUpperCase()} - paiement client`, timestamp, currency]);
        const currentStock = await db.query<{ quantity: number }>('SELECT quantity FROM telecom_stock WHERE id = $1', [stockRow.id]);
        if (Number(currentStock.rows[0]?.quantity ?? 0) < quantity) throw new Error('Le stock vient de changer et est insuffisant. Actualise la page avant de réessayer.');
        await db.query('UPDATE telecom_stock SET quantity = quantity - $1, updated_at = $2 WHERE id = $3 AND quantity >= $1', [quantity, timestamp, stockRow.id]);
        await db.exec('COMMIT');
      } catch (err) { await db.exec('ROLLBACK'); throw err; }
      for (const [table, recordId] of [['telecom_transactions', id], ['cash_movements', incomingId], ['telecom_stock', stockRow.id]]) {
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

  const setInitialFloat = async () => {
    if (!user || !store) return;
    const typeChoice = window.prompt('Quel stock veux-tu définir ? 1 = Unités, 2 = Megas', serviceType === 'units' ? '1' : '2');
    if (typeChoice === null) return;
    const type = typeChoice.trim() === '1' ? 'units' : typeChoice.trim() === '2' ? 'data_bundle' : null;
    if (!type) { setError('Choix invalide. Saisis 1 pour unités ou 2 pour Megas.'); return; }
    const existing = await queryOne<{ id: string; quantity: number; initial_quantity: number }>("SELECT id, quantity, initial_quantity FROM telecom_stock WHERE store_id=$1 AND service_type=$2 AND operator='airtel'", [store.id, type]);
    const sold = await queryOne<{ n: number | string }>("SELECT COUNT(*) n FROM telecom_transactions WHERE store_id=$1 AND service_type=$2 AND status='completed'", [store.id, type]);
    if (existing && Number(sold?.n ?? 0) > 0) { setError('Des ventes existent déjà pour ce type. Le stock ne peut pas être réinitialisé ici, afin de ne pas fausser l’inventaire.'); return; }
    const raw = window.prompt(`Stock initial en nombre d’unités ${type === 'units' ? 'téléphoniques' : 'de Megas'} :`, String(existing?.quantity ?? 0));
    if (raw === null) return;
    const amount = Number(raw);
    if (!Number.isInteger(amount) || amount < 0) { setError('Saisis un nombre entier positif ou zéro.'); return; }
    const id = existing?.id ?? generateId(); const timestamp = now();
    try {
      await execute("INSERT INTO telecom_stock (id,store_id,service_type,operator,quantity,initial_quantity,created_by,updated_at) VALUES ($1,$2,$3,'airtel',$4,$4,$5,$6) ON CONFLICT (store_id,service_type,operator) DO UPDATE SET quantity=EXCLUDED.quantity,initial_quantity=EXCLUDED.initial_quantity,updated_at=EXCLUDED.updated_at", [id, store.id, type, amount, user.id, timestamp]);
      await execute("INSERT INTO app_meta (key,value) VALUES ($1,'upsert') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [`cloud_pending:telecom_stock:${id}`]);
      scheduleLocalTableSync('telecom_stock', id);
      setSuccess(`Stock initial ${type === 'units' ? 'unités' : 'Megas'} défini : ${amount.toLocaleString('fr-FR')} unités.`);
      await load();
    } catch (err) { setError(`Stock non enregistré : ${err instanceof Error ? err.message : String(err)}`); }
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
        if (original.rows.length !== 1) throw new Error('L’écriture de caisse d’origine est absente ou ambiguë. Annulation bloquée pour protéger la caisse.');
        for (const movement of original.rows) {
          const reversalId = generateId(); reversalIds.push(reversalId);
          await db.query(`INSERT INTO cash_movements (id, cash_session_id, movement_type, payment_method, amount, direction, reference_type, reference_id, user_id, reason, created_at, currency_code, original_amount, applied_rate) VALUES ($1,$2,'adjustment',$3,$4,$5,'telecom_cancellation',$6,$7,$8,$9,$10,$4,1)`, [reversalId, movement.cash_session_id, movement.payment_method, movement.amount, movement.direction === 'in' ? 'out' : 'in', row.id, user.id, `Annulation vente télécom : ${reason.trim()}`, timestamp, movement.currency_code]);
        }
        await db.query("UPDATE telecom_transactions SET status = 'cancelled', cancel_reason = $1, cancelled_by = $2, cancelled_at = $3 WHERE id = $4", [reason.trim(), user.id, timestamp, row.id]);
        const stock = await db.query<{ id: string }>("SELECT id FROM telecom_stock WHERE store_id=$1 AND service_type=$2 AND operator=$3", [store.id, row.service_type, row.operator]);
        if (stock.rows[0]) await db.query('UPDATE telecom_stock SET quantity = quantity + $1, updated_at = $2 WHERE id = $3', [Math.trunc(Number(row.quantity ?? 1)), timestamp, stock.rows[0].id]);
        await db.exec('COMMIT');
      } catch (err) { await db.exec('ROLLBACK'); throw err; }
      const stockId = await queryOne<{id:string}>("SELECT id FROM telecom_stock WHERE store_id=$1 AND service_type=$2 AND operator=$3", [store.id,row.service_type,row.operator]);
      if (stockId) { await db.query("INSERT INTO app_meta (key,value) VALUES ($1,'upsert') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [`cloud_pending:telecom_stock:${stockId.id}`]); scheduleLocalTableSync('telecom_stock', stockId.id); }
      for (const rid of reversalIds) { await db.query("INSERT INTO app_meta (key, value) VALUES ($1, 'upsert') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [`cloud_pending:cash_movements:${rid}`]); scheduleLocalTableSync('cash_movements', rid); }
      await db.query("INSERT INTO app_meta (key, value) VALUES ($1, 'upsert') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [`cloud_pending:telecom_transactions:${row.id}`]); scheduleLocalTableSync('telecom_transactions', row.id);
      await addAuditLog(user, 'telecom_transaction', 'cancel', { id: row.id, status: 'completed' }, { id: row.id, status: 'cancelled', reason: reason.trim() });
      setSuccess(`Vente ${row.reference} annulée avec écritures inverses.`); await load();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };

  const labelOperator = (value: string) => operators.find(o => o.value === value)?.label ?? value;
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center gap-3"><div className="p-3 rounded-xl bg-violet-100 text-violet-700"><RadioTower className="w-6 h-6" /></div><div className="flex-1"><h1 className="text-2xl font-bold text-slate-900">Vente d’unités & Megas</h1><p className="text-sm text-slate-500">Écran simplifié pour les ventes Airtel. Les unités et les Megas se vendent en saisissant la quantité / valeur, le coût et le prix reçu.</p></div><button type="button" onClick={() => void setInitialFloat()} className="btn-secondary">Définir le stock initial unités / Megas</button></div>
    {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertTriangle className="inline w-4 h-4 mr-2" />{error}</div>}
    {success && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 className="inline w-4 h-4 mr-2" />{success}</div>}
    <div className="grid grid-cols-2 md:grid-cols-2 gap-3">{(['cash','airtel_money'] as const).map(method => <div key={method} className="card p-3"><p className="text-xs text-slate-500">{({cash:'Espèces disponibles',airtel_money:'Solde e-float Airtel'})[method]} · USD</p><p className="font-bold">{formatCurrency(balances[`${method}_USD`] ?? 0, 'USD')}</p><p className="text-xs text-slate-500 mt-1">CDF : {formatCurrency(balances[`${method}_CDF`] ?? 0, 'CDF')}</p></div>)}</div>
    <div className="grid grid-cols-2 gap-3"><div className="card p-3"><p className="text-xs text-slate-500">Stock unités disponible</p><p className="text-xl font-bold">{unitStock.units.toLocaleString('fr-FR')} unités</p></div><div className="card p-3"><p className="text-xs text-slate-500">Stock Megas disponible</p><p className="text-xl font-bold">{unitStock.data_bundle.toLocaleString('fr-FR')} unités</p></div></div>
    <form onSubmit={submit} className="card p-4 md:p-5"><div className="flex flex-wrap gap-2 mb-4"><button type="button" onClick={() => setServiceType('units')} className={`px-4 py-2 rounded-lg text-sm font-semibold ${serviceType === 'units' ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-700'}`}>Vente d’unités</button><button type="button" onClick={() => setServiceType('data_bundle')} className={`px-4 py-2 rounded-lg text-sm font-semibold ${serviceType === 'data_bundle' ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-700'}`}>Vente de Megas / Data</button></div>
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        <div className="text-sm font-medium text-slate-700"><span>Opérateur</span><div className="input mt-1 bg-slate-50">Airtel</div></div>
        <label className="text-sm font-medium text-slate-700">Téléphone client (facultatif)<input className="input mt-1" value={phone} onChange={e => setPhone(e.target.value)} maxLength={24} placeholder="+243…" /></label>
        <label className="text-sm font-medium text-slate-700">Nom / quantité (facultatif)<input className="input mt-1" value={serviceName} onChange={e => setServiceName(e.target.value)} maxLength={120} placeholder={serviceType === 'units' ? 'Ex. 5000' : 'Ex. 5000'} /></label>
        <label className="text-sm font-medium text-slate-700">{serviceType === 'units' ? 'Quantité d’unités vendues *' : 'Quantité de Megas vendus (en unités) *'}<input className="input mt-1" type="number" min="1" step="1" value={faceValue} onChange={e => setFaceValue(e.target.value)} required /></label>
        <label className="text-sm font-medium text-slate-700">Coût d’achat du stock vendu *<input className="input mt-1" type="number" min="0" step="0.01" value={costAmount} onChange={e => setCostAmount(e.target.value)} required /></label>
        <label className="text-sm font-medium text-slate-700">Prix payé par le client *<input className="input mt-1" type="number" min="0.01" step="0.01" value={saleAmount} onChange={e => setSaleAmount(e.target.value)} required /></label>
        <label className="text-sm font-medium text-slate-700">Devise<select className="input mt-1" value={currency} onChange={e => setCurrency(e.target.value as Currency)}><option value="CDF">CDF</option><option value="USD">USD</option></select></label>
        <label className="text-sm font-medium text-slate-700">Mode de paiement reçu<select className="input mt-1" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as PaymentMethod)}>{paymentOptions.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}</select></label>
        <label className="text-sm font-medium text-slate-700">Référence (facultatif)<input className="input mt-1" value={reference} onChange={e => setReference(e.target.value)} maxLength={100} placeholder="Générée automatiquement si vide" /></label>
        
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className={`text-sm font-semibold ${margin < 0 ? 'text-red-700' : 'text-emerald-700'}`}>Marge brute estimée : {formatCurrency(margin, currency)}<span className="block text-xs font-normal text-slate-500">Calcul : prix reçu − coût d’achat. Le nombre d’unités vendu est déduit du stock unités/Megas, séparément du solde e-float Airtel.</span></p><button className="btn-primary" type="submit" disabled={busy || !session}>{busy ? 'Enregistrement…' : 'Enregistrer la vente'}</button></div>
      {!session && <p className="text-xs text-amber-700 mt-3">Ouvre une session de caisse pour enregistrer une vente.</p>}
    </form>
    <div className="card overflow-hidden"><div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between"><div><h2 className="font-semibold text-slate-900">Historique des recharges</h2><p className="text-xs text-slate-500 mt-1">Les 150 dernières opérations de l’agent ou de la cabine.</p></div><div className="relative"><Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" /><input className="input pl-9" value={search} onChange={e => setSearch(e.target.value)} placeholder="Téléphone, forfait, référence…" /></div></div>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-slate-500"><tr><th className="text-left p-3">Date</th><th className="text-left p-3">Type / opérateur</th><th className="text-left p-3">Client</th><th className="text-left p-3">Référence</th><th className="text-right p-3">Coût</th><th className="text-right p-3">Vente</th><th className="text-right p-3">Marge</th><th className="text-left p-3">Statut</th><th className="p-3">Action</th></tr></thead><tbody>{visibleRows.map(r => <tr key={r.id} className="border-t border-slate-100"><td className="p-3 whitespace-nowrap">{formatDateTime(r.created_at)}</td><td className="p-3">{r.service_type === 'units' ? 'Unités' : 'Megas / Data'}<div className="text-xs text-slate-500">{labelOperator(r.operator)} · {r.service_name}</div></td><td className="p-3 whitespace-nowrap">{r.customer_phone}</td><td className="p-3 font-mono text-xs">{r.reference}</td><td className="p-3 text-right whitespace-nowrap">{formatCurrency(r.cost_amount, r.currency_code)}</td><td className="p-3 text-right whitespace-nowrap">{formatCurrency(r.sale_amount, r.currency_code)}</td><td className="p-3 text-right whitespace-nowrap">{formatCurrency(r.sale_amount - r.cost_amount, r.currency_code)}</td><td className="p-3">{r.status === 'cancelled' ? <span className="text-red-700">Annulée<div className="text-xs text-slate-400">{r.cancel_reason}</div></span> : <span className="text-emerald-700">Réussie</span>}</td><td className="p-3">{r.status === 'completed' && ['owner','manager'].includes(user.role) && <button type="button" disabled={busy} onClick={() => void cancel(r)} className="text-red-700 text-xs font-medium disabled:opacity-50"><Ban className="inline w-3 h-3 mr-1"/>Annuler</button>}</td></tr>)}{visibleRows.length === 0 && <tr><td colSpan={9} className="p-8 text-center text-slate-400">Aucune recharge à afficher.</td></tr>}</tbody></table></div></div>
  </div>;
}
