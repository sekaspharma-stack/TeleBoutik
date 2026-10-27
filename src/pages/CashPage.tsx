import { useState, useEffect, useCallback } from 'react';
import { Wallet, Lock, Unlock, Plus, ArrowDownCircle, ArrowUpCircle, X, AlertTriangle } from 'lucide-react';
import { query, queryOne, execute, generateId, now } from '../db/localDb';
import { addAuditLog } from '../db/audit';
import { useAuth } from '../context/AuthContext';
import { formatCurrency, formatDateTime, paymentLabel } from '../lib/utils';
import type { CashSession, CashMovement } from '../types';

export default function CashPage() {
  const { user, store, cashSession, setCashSession } = useAuth();
  const [sessions, setSessions] = useState<CashSession[]>([]);
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [showOpen, setShowOpen] = useState(false);
  const [showMovement, setShowMovement] = useState(false);
  const [showClose, setShowClose] = useState(false);
  const [showExchange, setShowExchange] = useState(false);
  const [exchangeRate, setExchangeRate] = useState(0);
  const [exchanges, setExchanges] = useState<Array<{ id: string; usd_amount: number; cdf_amount: number; applied_rate: number; created_at: string; user_id: string }>>([]);

  const load = useCallback(async () => {
    if (!user) return;
    const openSession = await queryOne<CashSession>(
      `SELECT * FROM cash_sessions WHERE user_id = $1 AND status = 'open' ORDER BY opened_at DESC LIMIT 1`,
      [user.id]
    );
    setCashSession(openSession ?? null);

    setSessions(await query<CashSession>(
      `SELECT * FROM cash_sessions ORDER BY opened_at DESC LIMIT 20`
    ));
    setExchanges(await query<{ id: string; usd_amount: number; cdf_amount: number; applied_rate: number; created_at: string; user_id: string }>(`SELECT * FROM currency_exchanges ORDER BY created_at DESC LIMIT 30`));
    const rateRows = await query<{ value: string }>("SELECT value FROM settings WHERE key = 'usd_cdf_exchange_rate'");
    setExchangeRate(Number(rateRows[0]?.value ?? 0));

    if (openSession) {
      setMovements(await query<CashMovement>(
        `SELECT * FROM cash_movements WHERE cash_session_id = $1 ORDER BY created_at DESC`,
        [openSession.id]
      ));
    }
  }, [user, setCashSession]);

  useEffect(() => { load(); }, [load]);

  if (!user || !store) return null;
  const currency = store.currency;
  const decimals = store.currency_decimals;

  const physicalMovements = movements.filter(m => (m.currency_code || currency) === currency && (m.payment_method || 'cash') === 'cash');
  const cashIn = physicalMovements.filter(m => m.direction === 'in' && m.movement_type !== 'opening').reduce((s, m) => s + m.amount, 0);
  const cashOut = physicalMovements.filter(m => m.direction === 'out').reduce((s, m) => s + m.amount, 0);
  const physicalOpening = physicalMovements.filter(m => m.movement_type === 'opening').reduce((s, m) => s + (m.original_amount ?? m.amount), 0);
  const expectedBalance = physicalOpening + cashIn - cashOut;
  const balanceBy = (code: string, method: string) => movements.filter(m => (m.currency_code || currency) === code && (m.payment_method || 'cash') === method).reduce((sum, m) => sum + ((m.direction === 'in' ? 1 : -1) * (m.original_amount && m.original_amount !== 0 ? m.original_amount : m.amount)), 0);
  const physicalUsd = balanceBy('USD', 'cash');
  const physicalCdf = balanceBy('CDF', 'cash');
  const mobileUsd = balanceBy('USD', 'airtel_money');
  const mobileCdf = balanceBy('CDF', 'airtel_money');
  const totalUsd = physicalUsd + mobileUsd;
  const totalCdf = physicalCdf + mobileCdf;
  const totalCdfEquivalent = totalCdf + (exchangeRate > 0 ? totalUsd * exchangeRate : 0);

  const openSession = async (funds: { usd: number; cdf: number; virtualUsd: number; virtualCdf: number }) => {
    if (!user || !store) return;
    const id = generateId();
    const primaryOpening = store.currency === 'USD' ? funds.usd : funds.cdf;
    await execute(
      `INSERT INTO cash_sessions (id, store_id, user_id, register_number, opening_amount, status, opened_at)
       VALUES ($1, $2, $3, 1, $4, 'open', $5)`,
      [id, store.id, user.id, primaryOpening, now()]
    );
    const openingFunds = [
      { amount: funds.usd, currency: 'USD', method: 'cash', reason: 'Fond physique USD' },
      { amount: funds.cdf, currency: 'CDF', method: 'cash', reason: 'Fond physique CDF' },
      { amount: funds.virtualUsd, currency: 'USD', method: 'airtel_money', reason: 'Solde Airtel Money USD' },
      { amount: funds.virtualCdf, currency: 'CDF', method: 'airtel_money', reason: 'Solde Airtel Money CDF' },
    ];
    for (const fund of openingFunds) {
      if (fund.amount <= 0) continue;
      await execute(
        `INSERT INTO cash_movements (id, cash_session_id, movement_type, payment_method, amount, direction, reference_type, user_id, reason, created_at, currency_code, original_amount, applied_rate)
         VALUES ($1, $2, 'opening', $3, $4, 'in', 'cash_open', $5, $6, $7, $8, $4, 1)`,
        [generateId(), id, fund.method, fund.amount, user.id, fund.reason, now(), fund.currency]
      );
    }
    await addAuditLog(user, 'cash_session', 'open', null, { id, ...funds });
    setShowOpen(false);
    load();
  };

  const addMovement = async (type: 'deposit' | 'withdrawal', method: string, amount: number, reason: string, currencyCode: string) => {
    if (!user || !cashSession) return;
    const direction = type === 'deposit' ? 'in' : 'out';
    await execute(
      `INSERT INTO cash_movements (id, cash_session_id, movement_type, payment_method, amount, direction, reference_type, user_id, reason, created_at, currency_code, original_amount, applied_rate)
       VALUES ($1, $2, $3, $4, $5, $6, 'manual', $7, $8, $9, $10, $5, 1)`,
      [generateId(), cashSession.id, type, method, amount, direction, user.id, reason, now(), currencyCode]
    );
    await addAuditLog(user, 'cash_movement', 'create', null, { type, amount, reason });
    setShowMovement(false);
    load();
  };

  const closeSession = async (countedAmount: number, notes: string) => {
    if (!user || !cashSession) return;
    const diff = countedAmount - expectedBalance;
    await execute(
      `UPDATE cash_sessions SET status = 'closed', closing_amount = $1, expected_closing = $2, difference = $3, closed_at = $4, notes = $5 WHERE id = $6`,
      [countedAmount, expectedBalance, diff, now(), notes, cashSession.id]
    );
    await addAuditLog(user, 'cash_session', 'close', cashSession, { closing_amount: countedAmount, expected: expectedBalance, difference: diff });
    setCashSession(null);
    setShowClose(false);
    load();
  };

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-slate-800">Caisse</h1>
        <p className="text-sm text-slate-500">Gestion des sessions et mouvements de caisse</p>
      </div>

      {cashSession ? (
        <div className="space-y-4">
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 bg-success-100 rounded-full flex items-center justify-center">
                  <Unlock className="w-5 h-5 text-success-600" />
                </div>
                <div>
                  <p className="font-semibold text-slate-800">Session ouverte</p>
                  <p className="text-xs text-slate-400">Depuis {formatDateTime(cashSession.opened_at)}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setShowMovement(true)} className="btn-secondary">
                  <Plus className="w-4 h-4" /> Mouvement
                </button>
                <button onClick={() => setShowExchange(true)} className="btn-secondary">USD → CDF</button>
                <button onClick={() => setShowClose(true)} className="btn-danger">
                  <Lock className="w-4 h-4" /> Clôturer
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
              <div className="bg-slate-50 rounded-lg p-3"><p className="text-xs text-slate-500">Espèces physiques USD</p><p className="font-bold">{formatCurrency(physicalUsd, 'USD', 2)}</p></div>
              <div className="bg-slate-50 rounded-lg p-3"><p className="text-xs text-slate-500">Espèces physiques CDF</p><p className="font-bold">{formatCurrency(physicalCdf, 'CDF', 0)}</p></div>
              <div className="bg-indigo-50 rounded-lg p-3"><p className="text-xs text-indigo-600">Airtel Money USD</p><p className="font-bold">{formatCurrency(mobileUsd, 'USD', 2)}</p></div>
              <div className="bg-indigo-50 rounded-lg p-3"><p className="text-xs text-indigo-600">Airtel Money CDF</p><p className="font-bold">{formatCurrency(mobileCdf, 'CDF', 0)}</p></div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
              <div className="rounded-lg border border-blue-100 bg-blue-50 p-3"><p className="text-xs text-blue-700">Total disponible USD</p><p className="text-lg font-bold text-blue-900">{formatCurrency(totalUsd, 'USD', 2)}</p><p className="text-xs text-blue-700">Espèces + Airtel Money</p></div>
              <div className="rounded-lg border border-amber-100 bg-amber-50 p-3"><p className="text-xs text-amber-700">Total disponible CDF</p><p className="text-lg font-bold text-amber-900">{formatCurrency(totalCdf, 'CDF', 0)}</p><p className="text-xs text-amber-700">Espèces + Airtel Money</p></div>
              <div className="rounded-lg border border-primary-100 bg-primary-50 p-3"><p className="text-xs text-primary-700">Total général en francs</p><p className="text-lg font-bold text-primary-900">{exchangeRate > 0 ? formatCurrency(totalCdfEquivalent, 'CDF', 0) : 'Taux d’échange non configuré'}</p><p className="text-xs text-primary-700">CDF + USD × {exchangeRate > 0 ? exchangeRate.toLocaleString('fr-FR') : '—'}</p></div>
            </div>
            <div className="grid grid-cols-3 gap-3 mt-3">
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-400">Fond d'ouverture</p>
                <p className="text-lg font-bold text-slate-800">{formatCurrency(cashSession.opening_amount, currency, decimals)}</p>
              </div>
              <div className="bg-success-50 rounded-lg p-3">
                <p className="text-xs text-success-600">Entrées</p>
                <p className="text-lg font-bold text-success-700">+{formatCurrency(cashIn, currency, decimals)}</p>
              </div>
              <div className="bg-error-50 rounded-lg p-3">
                <p className="text-xs text-error-600">Sorties</p>
                <p className="text-lg font-bold text-error-700">-{formatCurrency(cashOut, currency, decimals)}</p>
              </div>
            </div>

            <div className="mt-3 bg-primary-50 rounded-lg p-3 flex items-center justify-between">
              <span className="text-sm font-medium text-primary-700">Solde théorique</span>
              <span className="text-xl font-bold text-primary-700">{formatCurrency(expectedBalance, currency, decimals)}</span>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="p-3 border-b border-slate-200">
              <h3 className="font-semibold text-slate-700 text-sm">Mouvements récents</h3>
            </div>
            <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[500px]">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-2 font-medium text-slate-600">Heure</th>
                  <th className="text-left px-4 py-2 font-medium text-slate-600">Type</th>
                  <th className="text-left px-4 py-2 font-medium text-slate-600">Mode</th>
                  <th className="text-right px-4 py-2 font-medium text-slate-600">Montant</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {movements.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2 text-xs text-slate-500">{formatDateTime(m.created_at)}</td>
                    <td className="px-4 py-2">
                      <span className="flex items-center gap-1 text-slate-700">
                        {m.direction === 'in' ? <ArrowDownCircle className="w-3.5 h-3.5 text-success-500" /> : <ArrowUpCircle className="w-3.5 h-3.5 text-error-500" />}
                        {m.reason}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-500">{paymentLabel(m.payment_method)}</td>
                    <td className={`px-4 py-2 text-right font-medium ${m.direction === 'in' ? 'text-success-600' : 'text-error-600'}`}>
                      {m.direction === 'in' ? '+' : '-'}{m.currency_code && m.original_amount != null && m.currency_code !== currency ? `${m.original_amount.toLocaleString('fr-FR', { maximumFractionDigits: m.currency_code === 'CDF' ? 0 : 2 })} ${m.currency_code} (≈ ${formatCurrency(m.amount, currency, decimals)})` : formatCurrency(m.amount, currency, decimals)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="card p-8 text-center">
          <Wallet className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 mb-4">Aucune session de caisse ouverte</p>
          <button onClick={() => setShowOpen(true)} className="btn-primary">
            <Unlock className="w-4 h-4" /> Ouvrir la caisse
          </button>
        </div>
      )}

      <div className="mt-6 card overflow-hidden">
        <div className="p-3 border-b border-slate-200"><h3 className="font-semibold text-slate-700 text-sm">Échanges de devises (séparés des ventes)</h3><p className="text-xs text-slate-500">Ces opérations ne sont pas ajoutées au chiffre d’affaires des marchandises.</p></div>
        <div className="overflow-x-auto"><table className="w-full text-sm min-w-[500px]"><thead className="bg-slate-50 border-b"><tr><th className="text-left px-4 py-2">Date</th><th className="text-right px-4 py-2">USD reçus</th><th className="text-right px-4 py-2">CDF remis</th><th className="text-right px-4 py-2">Taux appliqué</th></tr></thead><tbody className="divide-y">{exchanges.map((e) => <tr key={e.id}><td className="px-4 py-2 text-xs text-slate-500">{formatDateTime(e.created_at)}</td><td className="px-4 py-2 text-right">${e.usd_amount.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}</td><td className="px-4 py-2 text-right">{e.cdf_amount.toLocaleString('fr-FR')} CDF</td><td className="px-4 py-2 text-right">{e.applied_rate.toLocaleString('fr-FR')} CDF/USD</td></tr>)}</tbody></table></div>
        {exchanges.length === 0 && <p className="p-4 text-sm text-slate-400">Aucun échange enregistré.</p>}
      </div>

      <div className="mt-6">
        <h3 className="font-semibold text-slate-700 text-sm mb-2">Historique des sessions</h3>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-slate-600">Ouverture</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">Clôture</th>
                <th className="text-right px-4 py-2 font-medium text-slate-600">Fond</th>
                <th className="text-right px-4 py-2 font-medium text-slate-600">Théorique</th>
                <th className="text-right px-4 py-2 font-medium text-slate-600">Compté</th>
                <th className="text-right px-4 py-2 font-medium text-slate-600">Écart</th>
                <th className="text-center px-4 py-2 font-medium text-slate-600">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sessions.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 text-xs text-slate-500">{formatDateTime(s.opened_at)}</td>
                  <td className="px-4 py-2 text-xs text-slate-500">{s.closed_at ? formatDateTime(s.closed_at) : '—'}</td>
                  <td className="px-4 py-2 text-right">{formatCurrency(s.opening_amount, currency, decimals)}</td>
                  <td className="px-4 py-2 text-right">{s.expected_closing != null ? formatCurrency(s.expected_closing, currency, decimals) : '—'}</td>
                  <td className="px-4 py-2 text-right">{s.closing_amount != null ? formatCurrency(s.closing_amount, currency, decimals) : '—'}</td>
                  <td className="px-4 py-2 text-right">
                    {s.difference != null ? (
                      <span className={Math.abs(s.difference) > 1 ? 'text-error-600 font-bold' : 'text-success-600'}>
                        {s.difference >= 0 ? '+' : ''}{formatCurrency(s.difference, currency, decimals)}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-2 text-center">
                    <span className={s.status === 'open' ? 'badge-success' : 'badge-slate'}>
                      {s.status === 'open' ? 'Ouverte' : 'Clôturée'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showOpen && (
        <OpenCashModal onConfirm={openSession} onClose={() => setShowOpen(false)} currency={currency} decimals={decimals} />
      )}
      {showMovement && (
        <MovementModal onConfirm={addMovement} onClose={() => setShowMovement(false)} currency={currency} decimals={decimals} />
      )}
      {showExchange && cashSession && <CurrencyExchangeModal cashSessionId={cashSession.id} onClose={() => setShowExchange(false)} onSaved={() => { setShowExchange(false); load(); }} />}
      {showClose && (
        <CloseCashModal
          expected={expectedBalance}
          onConfirm={closeSession}
          onClose={() => setShowClose(false)}
          currency={currency}
          decimals={decimals}
        />
      )}
    </div>
  );
}


function CurrencyExchangeModal({ cashSessionId, onClose, onSaved }: { cashSessionId: string; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth();
  const [usdAmount, setUsdAmount] = useState('');
  const [rate, setRate] = useState(0);
  const [saving, setSaving] = useState(false);
  useEffect(() => { query<{ value: string }>("SELECT value FROM settings WHERE key = 'usd_cdf_exchange_rate'").then((r) => setRate(Number(r[0]?.value ?? 0))).catch(() => setRate(0)); }, []);
  const cdfAmount = (Number(usdAmount) || 0) * rate;
  const save = async () => {
    const usd = Number(usdAmount);
    if (!user || !Number.isFinite(usd) || usd <= 0 || rate <= 0) { window.alert('Vérifie le montant USD et configure le taux d’échange dans Paramètres → Finance.'); return; }
    setSaving(true);
    try {
      const record = { id: generateId(), cash_session_id: cashSessionId, user_id: user.id, usd_amount: usd, cdf_amount: cdfAmount, applied_rate: rate, created_at: now(), notes: 'Échange USD vers CDF' };
      await execute('INSERT INTO currency_exchanges (id, cash_session_id, user_id, usd_amount, cdf_amount, applied_rate, created_at, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [record.id, record.cash_session_id, record.user_id, record.usd_amount, record.cdf_amount, record.applied_rate, record.created_at, record.notes]);
      await addAuditLog(user, 'currency_exchange', 'create', null, record);
      onSaved();
    } finally { setSaving(false); }
  };
  return <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}><div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}><div className="p-4 border-b flex items-center justify-between"><h2 className="font-semibold">Échange USD → CDF</h2><button onClick={onClose}><X className="w-5 h-5" /></button></div><div className="p-4 space-y-3"><p className="text-sm text-slate-500">Opération enregistrée séparément des ventes de marchandises.</p><div><label className="label">Montant reçu en USD</label><input type="number" min="0" step="0.01" value={usdAmount} onChange={(e) => setUsdAmount(e.target.value)} className="input" /></div><div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Taux d’échange</p><p className="font-semibold">{rate > 0 ? `${rate.toLocaleString('fr-FR')} CDF/USD` : 'Non configuré'}</p><p className="text-xs text-slate-500 mt-2">CDF à remettre</p><p className="text-xl font-bold">{cdfAmount.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} CDF</p></div><div className="flex gap-2"><button onClick={onClose} className="btn-secondary flex-1">Annuler</button><button onClick={save} disabled={saving || rate <= 0 || Number(usdAmount) <= 0} className="btn-primary flex-1">{saving ? 'Enregistrement…' : 'Enregistrer l’échange'}</button></div></div></div></div>;
}

function OpenCashModal({ onConfirm, onClose, currency, decimals }: { onConfirm: (funds: { usd: number; cdf: number; virtualUsd: number; virtualCdf: number }) => void; onClose: () => void; currency: string; decimals: number }) {
  const [usd, setUsd] = useState('0');
  const [cdf, setCdf] = useState('0');
  const [virtualUsd, setVirtualUsd] = useState('0');
  const [virtualCdf, setVirtualCdf] = useState('0');
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">Ouvrir la caisse</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-sm text-slate-500">Déclare les espèces physiques et les soldes Airtel Money séparément. Les montants restent dans leur devise.</p>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Fonds physiques USD</label><input type="number" min="0" step="0.01" value={usd} onChange={(e) => setUsd(e.target.value)} className="input" /></div>
            <div><label className="label">Fonds physiques CDF</label><input type="number" min="0" step="1" value={cdf} onChange={(e) => setCdf(e.target.value)} className="input" /></div>
            <div><label className="label">Solde Airtel Money USD</label><input type="number" min="0" step="0.01" value={virtualUsd} onChange={(e) => setVirtualUsd(e.target.value)} className="input" /></div>
            <div><label className="label">Solde Airtel Money CDF</label><input type="number" min="0" step="1" value={virtualCdf} onChange={(e) => setVirtualCdf(e.target.value)} className="input" /></div>
          </div>
          <button onClick={() => onConfirm({ usd: Math.max(0, Number(usd) || 0), cdf: Math.max(0, Number(cdf) || 0), virtualUsd: Math.max(0, Number(virtualUsd) || 0), virtualCdf: Math.max(0, Number(virtualCdf) || 0) })} className="btn-primary w-full">
            Ouvrir la session
          </button>
        </div>
      </div>
    </div>
  );
}

function MovementModal({ onConfirm, onClose, currency, decimals }: { onConfirm: (type: 'deposit' | 'withdrawal', method: string, amount: number, reason: string, currencyCode: string) => void; onClose: () => void; currency: string; decimals: number }) {
  const [type, setType] = useState<'deposit' | 'withdrawal'>('withdrawal');
  const [method, setMethod] = useState('cash');
  const [currencyCode, setCurrencyCode] = useState<'USD' | 'CDF'>(currency === 'CDF' ? 'CDF' : 'USD');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">Mouvement de caisse</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex gap-2">
            <button onClick={() => setType('deposit')} className={`flex-1 p-2 rounded-lg border-2 ${type === 'deposit' ? 'border-success-500 bg-success-50' : 'border-slate-200'}`}>
              <ArrowDownCircle className="w-4 h-4 mx-auto mb-1 text-success-600" />
              <span className="text-xs">Dépôt</span>
            </button>
            <button onClick={() => setType('withdrawal')} className={`flex-1 p-2 rounded-lg border-2 ${type === 'withdrawal' ? 'border-error-500 bg-error-50' : 'border-slate-200'}`}>
              <ArrowUpCircle className="w-4 h-4 mx-auto mb-1 text-error-600" />
              <span className="text-xs">Retrait</span>
            </button>
          </div>
          <div>
            <label className="label">Mode</label>
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="input">
              <option value="cash">Espèces</option>
              <option value="airtel_money">Airtel Money</option>
            </select>
          </div>
          <div>
            <label className="label">Devise</label>
            <select value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value as 'USD' | 'CDF')} className="input"><option value="USD">USD</option><option value="CDF">CDF</option></select>
          </div>
          <div>
            <label className="label">Montant</label>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="input" />
          </div>
          <div>
            <label className="label">Motif</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Dépôt banque, achat fournisseur..." className="input" />
          </div>
          <button
            onClick={() => onConfirm(type, method, parseFloat(amount) || 0, reason || type, currencyCode)}
            disabled={!amount}
            className="btn-primary w-full"
          >
            Valider
          </button>
        </div>
      </div>
    </div>
  );
}

function CloseCashModal({ expected, onConfirm, onClose, currency, decimals }: { expected: number; onConfirm: (counted: number, notes: string) => void; onClose: () => void; currency: string; decimals: number }) {
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const countedNum = parseFloat(counted) || 0;
  const diff = countedNum - expected;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">Clôturer la caisse</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <div className="p-4 space-y-3">
          <div className="bg-primary-50 rounded-lg p-3 text-center">
            <p className="text-sm text-primary-600">Solde théorique</p>
            <p className="text-xl font-bold text-primary-700">{formatCurrency(expected, currency, decimals)}</p>
          </div>
          <div>
            <label className="label">Montant compté</label>
            <input type="number" value={counted} onChange={(e) => setCounted(e.target.value)} className="input" autoFocus />
          </div>
          {counted && (
            <div className={`rounded-lg p-3 text-center ${Math.abs(diff) > 1 ? 'bg-error-50' : 'bg-success-50'}`}>
              <p className={`text-sm ${Math.abs(diff) > 1 ? 'text-error-600' : 'text-success-600'}`}>
                {Math.abs(diff) > 1 && <AlertTriangle className="w-4 h-4 inline mr-1" />}
                Écart: {diff >= 0 ? '+' : ''}{formatCurrency(diff, currency, decimals)}
              </p>
            </div>
          )}
          <div>
            <label className="label">Notes (optionnel)</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Commentaire sur l'écart..." className="input" />
          </div>
          <button onClick={() => onConfirm(countedNum, notes)} disabled={!counted} className="btn-danger w-full">
            <Lock className="w-4 h-4" /> Clôturer la session
          </button>
        </div>
      </div>
    </div>
  );
}
