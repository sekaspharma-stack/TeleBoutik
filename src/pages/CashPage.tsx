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

  const cashIn = movements.filter(m => m.direction === 'in').reduce((s, m) => s + m.amount, 0);
  const cashOut = movements.filter(m => m.direction === 'out').reduce((s, m) => s + m.amount, 0);
  const expectedBalance = (cashSession?.opening_amount ?? 0) + cashIn - cashOut;

  const openSession = async (amount: number) => {
    if (!user || !store) return;
    const id = generateId();
    await execute(
      `INSERT INTO cash_sessions (id, store_id, user_id, register_number, opening_amount, status, opened_at)
       VALUES ($1, $2, $3, 1, $4, 'open', $5)`,
      [id, store.id, user.id, amount, now()]
    );
    await execute(
      `INSERT INTO cash_movements (id, cash_session_id, movement_type, payment_method, amount, direction, reference_type, user_id, reason, created_at)
       VALUES ($1, $2, 'opening', 'cash', $3, 'in', 'cash_open', $4, 'Fond de caisse', $5)`,
      [generateId(), id, amount, user.id, now()]
    );
    await addAuditLog(user, 'cash_session', 'open', null, { id, amount });
    setShowOpen(false);
    load();
  };

  const addMovement = async (type: 'deposit' | 'withdrawal', method: string, amount: number, reason: string) => {
    if (!user || !cashSession) return;
    const direction = type === 'deposit' ? 'in' : 'out';
    await execute(
      `INSERT INTO cash_movements (id, cash_session_id, movement_type, payment_method, amount, direction, reference_type, user_id, reason, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'manual', $7, $8, $9)`,
      [generateId(), cashSession.id, type, method, amount, direction, user.id, reason, now()]
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
                <button onClick={() => setShowClose(true)} className="btn-danger">
                  <Lock className="w-4 h-4" /> Clôturer
                </button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
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
                      {m.direction === 'in' ? '+' : '-'}{formatCurrency(m.amount, currency, decimals)}
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

function OpenCashModal({ onConfirm, onClose, currency, decimals }: { onConfirm: (amount: number) => void; onClose: () => void; currency: string; decimals: number }) {
  const [amount, setAmount] = useState('10000');
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">Ouvrir la caisse</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="label">Fond de caisse d'ouverture</label>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="input" />
            <p className="text-xs text-slate-400 mt-1">{formatCurrency(parseFloat(amount) || 0, currency, decimals)}</p>
          </div>
          <button onClick={() => onConfirm(parseFloat(amount) || 0)} className="btn-primary w-full">
            Ouvrir la session
          </button>
        </div>
      </div>
    </div>
  );
}

function MovementModal({ onConfirm, onClose, currency, decimals }: { onConfirm: (type: 'deposit' | 'withdrawal', method: string, amount: number, reason: string) => void; onClose: () => void; currency: string; decimals: number }) {
  const [type, setType] = useState<'deposit' | 'withdrawal'>('withdrawal');
  const [method, setMethod] = useState('cash');
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
              <option value="orange_money">Orange Money</option>
              <option value="mtn_momo">MTN MoMo</option>
              <option value="wave">Wave</option>
              <option value="card">Carte</option>
              <option value="transfer">Virement</option>
            </select>
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
            onClick={() => onConfirm(type, method, parseFloat(amount) || 0, reason || type)}
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
