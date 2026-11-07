import { useState, useEffect, useCallback } from 'react';
import { Wallet, Lock, Unlock, Plus, ArrowDownCircle, ArrowUpCircle, X, AlertTriangle, Coins, Smartphone, Landmark, Sunrise } from 'lucide-react';
import { query, queryOne, execute, generateId, now } from '../db/localDb';
import { addAuditLog } from '../db/audit';
import { scheduleLocalTableSync } from '../db/syncEngine';
import { useAuth } from '../context/AuthContext';
import { useSync } from '../context/SyncContext';
import { formatCurrency, formatDateTime, paymentLabel } from '../lib/utils';
import type { CashSession, CashMovement } from '../types';
import LoadingButton from '../components/LoadingButton';
import { MoneyCard, SoftMoneyCard } from '../components/MoneyCard';

type SessionRow = CashSession & { user_name?: string | null };
type CashDetail = { cashUsd: number; cashCdf: number; airtelUsd: number; airtelCdf: number };
type CountedDetail = { cashUsd: number; cashCdf: number; airtelUsd: number | null; airtelCdf: number | null };

/** Taux USD/CDF configuré dans Paramètres → Finance : taux de vente (ex. 2300), à défaut taux d'échange (ex. 2250). 0 si absent. */
async function readUsdCdfRate(): Promise<number> {
  try {
    const rows = await query<{ key: string; value: string }>("SELECT key, value FROM settings WHERE key IN ('usd_cdf_exchange_rate','usd_cdf_sale_rate')");
    const v: Record<string, number> = {};
    for (const r of rows) v[r.key] = Number(String(r.value).replace(/\s/g, '').replace(',', '.'));
    if (v.usd_cdf_sale_rate > 0) return v.usd_cdf_sale_rate;
    if (v.usd_cdf_exchange_rate > 0) return v.usd_cdf_exchange_rate;
  } catch (error) { console.warn('Taux USD/CDF illisible', error); }
  return 0;
}

const movementAmount = (m: CashMovement) => (m.original_amount && Number(m.original_amount) !== 0 ? Number(m.original_amount) : Number(m.amount));
const sameMoney = (a: number, b: number) => Math.abs(a - b) < 0.005;

/** Fonds déclarés à l'ouverture, par devise (espèces et Airtel Money). */
function openingFunds(rows: CashMovement[], defaultCurrency: string): CashDetail {
  return sessionBalances(rows.filter((m) => m.movement_type === 'opening'), defaultCurrency);
}

/** USD et CDF restent séparés ; le CDF est converti en USD selon le taux, avec le total équivalent. */
function MoneyPair({ usd, cdf, rate, tone }: { usd: number; cdf: number; rate?: number; tone?: 'diff' }) {
  const color = (v: number) => (tone === 'diff' ? (sameMoney(v, 0) ? 'text-success-600' : 'text-error-600 font-bold') : '');
  const sign = (v: number) => (tone === 'diff' && v > 0.004 ? '+' : '');
  const total = usd + (rate && rate > 0 ? cdf / rate : 0);
  return (
    <div className="leading-tight">
      <div className={color(usd)}>{sign(usd)}{formatCurrency(usd, 'USD', 2)}</div>
      <div className={color(cdf)}>{sign(cdf)}{formatCurrency(cdf, 'CDF', 0)}</div>
      {rate && rate > 0 ? <div className={`text-xs ${tone === 'diff' ? color(total) : 'text-slate-500'}`}>≈ {sign(total)}{formatCurrency(total, 'USD', 2)} au total</div> : null}
    </div>
  );
}

/** Soldes d'une liste de mouvements, par mode de paiement et par devise (même règle que la caisse personnelle). */
function sessionBalances(rows: CashMovement[], defaultCurrency: string): CashDetail & { totalUsd: number; totalCdf: number } {
  const by = (code: string, method: string) => rows
    .filter((m) => (m.currency_code || defaultCurrency) === code && (m.payment_method || 'cash') === method)
    .reduce((sum, m) => sum + (m.direction === 'in' ? 1 : -1) * (m.original_amount && m.original_amount !== 0 ? Number(m.original_amount) : Number(m.amount)), 0);
  const cashUsd = by('USD', 'cash'), cashCdf = by('CDF', 'cash');
  const airtelUsd = by('USD', 'airtel_money'), airtelCdf = by('CDF', 'airtel_money');
  return { cashUsd, cashCdf, airtelUsd, airtelCdf, totalUsd: cashUsd + airtelUsd, totalCdf: cashCdf + airtelCdf };
}

export default function CashPage() {
  const { user, store, cashSession, setCashSession } = useAuth();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  // Propriétaire / gérant : caisses ouvertes par les AUTRES utilisateurs (vendeuses), avec leurs mouvements.
  const [teamSessions, setTeamSessions] = useState<SessionRow[]>([]);
  const [teamMovements, setTeamMovements] = useState<Record<string, CashMovement[]>>({});
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [showOpen, setShowOpen] = useState(false);
  const [showMovement, setShowMovement] = useState(false);
  const [showClose, setShowClose] = useState(false);
  const [showExchange, setShowExchange] = useState(false);
  const [exchangeRate, setExchangeRate] = useState(0);
  // Mouvements des sessions de l'historique : permettent d'afficher fond et théorique par devise, même session ouverte.
  const [historyMovements, setHistoryMovements] = useState<Record<string, CashMovement[]>>({});
  const [closingTeamSession, setClosingTeamSession] = useState<SessionRow | null>(null);
  const dataVersion = useSync((state) => state.dataVersion);
  const [exchanges, setExchanges] = useState<Array<{ id: string; usd_amount: number; cdf_amount: number; applied_rate: number; created_at: string; user_id: string }>>([]);

  const load = useCallback(async () => {
    if (!user) return;
    setExchangeRate(await readUsdCdfRate()); // en premier : un échec ailleurs ne doit jamais faire perdre le taux
    const openSession = await queryOne<CashSession>(
      `SELECT * FROM cash_sessions WHERE user_id = $1 AND status = 'open' ORDER BY opened_at DESC LIMIT 1`,
      [user.id]
    );
    setCashSession(openSession ?? null);

    setSessions(await query<SessionRow>(
      `SELECT cs.*, u.name AS user_name FROM cash_sessions cs LEFT JOIN users u ON u.id = cs.user_id ORDER BY cs.opened_at DESC LIMIT 20`
    ));

    const histRows = await query<CashMovement>(
      `SELECT * FROM cash_movements WHERE cash_session_id IN (SELECT id FROM (SELECT id FROM cash_sessions ORDER BY opened_at DESC LIMIT 20) t)`
    );
    const histGrouped: Record<string, CashMovement[]> = {};
    for (const row of histRows) (histGrouped[row.cash_session_id] ??= []).push(row);
    setHistoryMovements(histGrouped);

    if (['owner', 'manager'].includes(user.role)) {
      const others = await query<SessionRow>(
        `SELECT cs.*, u.name AS user_name FROM cash_sessions cs LEFT JOIN users u ON u.id = cs.user_id
         WHERE cs.status = 'open' AND cs.user_id <> $1 ORDER BY cs.opened_at DESC`,
        [user.id]
      );
      setTeamSessions(others);
      const grouped: Record<string, CashMovement[]> = {};
      if (others.length > 0) {
        const rows = await query<CashMovement>(
          `SELECT * FROM cash_movements WHERE cash_session_id IN (SELECT id FROM cash_sessions WHERE status = 'open' AND user_id <> $1) ORDER BY created_at DESC`,
          [user.id]
        );
        for (const row of rows) (grouped[row.cash_session_id] ??= []).push(row);
      }
      setTeamMovements(grouped);
    } else {
      setTeamSessions([]);
      setTeamMovements({});
    }
    setExchanges(await query<{ id: string; usd_amount: number; cdf_amount: number; applied_rate: number; created_at: string; user_id: string }>(`SELECT * FROM currency_exchanges ORDER BY created_at DESC LIMIT 30`));

    if (openSession) {
      setMovements(await query<CashMovement>(
        `SELECT * FROM cash_movements WHERE cash_session_id = $1 ORDER BY created_at DESC`,
        [openSession.id]
      ));
    }
  }, [user, setCashSession]);

  // Rechargement quand la synchronisation apporte des données : la page n'est plus remontée, les fenêtres restent ouvertes.
  useEffect(() => { void load(); }, [load, dataVersion]);

  if (!user || !store) return null;
  const currency = store.currency;
  const decimals = store.currency_decimals;

  const physicalMovements = movements.filter(m => (m.currency_code || currency) === currency && (m.payment_method || 'cash') === 'cash');
  const cashIn = physicalMovements.filter(m => m.direction === 'in' && m.movement_type !== 'opening').reduce((s, m) => s + m.amount, 0);
  const cashOut = physicalMovements.filter(m => m.direction === 'out').reduce((s, m) => s + m.amount, 0);
  const physicalOpening = physicalMovements.filter(m => m.movement_type === 'opening').reduce((s, m) => s + (m.original_amount ?? m.amount), 0);
  const physicalUsdBalance = movements.filter(m => (m.currency_code || currency) === 'USD' && (m.payment_method || 'cash') === 'cash').reduce((sum,m)=>sum+(m.direction==='in'?1:-1)*(Number(m.original_amount || 0) || Number(m.amount || 0)),0);
  const physicalCdfBalance = movements.filter(m => (m.currency_code || currency) === 'CDF' && (m.payment_method || 'cash') === 'cash').reduce((sum,m)=>sum+(m.direction==='in'?1:-1)*(Number(m.original_amount || 0) || Number(m.amount || 0)),0);
  const expectedBalance = exchangeRate > 0 ? physicalUsdBalance + physicalCdfBalance / exchangeRate : (currency === 'USD' ? physicalUsdBalance : physicalCdfBalance);
  const balanceBy = (code: string, method: string) => movements.filter(m => (m.currency_code || currency) === code && (m.payment_method || 'cash') === method).reduce((sum, m) => sum + ((m.direction === 'in' ? 1 : -1) * (m.original_amount && m.original_amount !== 0 ? m.original_amount : m.amount)), 0);
  const physicalUsd = balanceBy('USD', 'cash');
  const physicalCdf = balanceBy('CDF', 'cash');
  const mobileUsd = balanceBy('USD', 'airtel_money');
  const mobileCdf = balanceBy('CDF', 'airtel_money');
  const orangeUsd = balanceBy('USD', 'orange_money');
  const orangeCdf = balanceBy('CDF', 'orange_money');
  const mtnUsd = balanceBy('USD', 'mtn_momo');
  const mtnCdf = balanceBy('CDF', 'mtn_momo');
  const vodacomUsd = balanceBy('USD', 'vodacom_money');
  const vodacomCdf = balanceBy('CDF', 'vodacom_money');
  const totalUsd = physicalUsd + mobileUsd;
  const totalCdf = physicalCdf + mobileCdf;
  const totalUsdEquivalent = totalUsd + (exchangeRate > 0 ? totalCdf / exchangeRate : 0);

  const amountOf = (m: CashMovement) => (m.original_amount && m.original_amount !== 0 ? Number(m.original_amount) : Number(m.amount));
  const cashBy = (code: string, kind: 'opening' | 'in' | 'out') => movements
    .filter((m) => (m.currency_code || currency) === code && (m.payment_method || 'cash') === 'cash'
      && (kind === 'opening' ? m.movement_type === 'opening' : kind === 'in' ? (m.direction === 'in' && m.movement_type !== 'opening') : m.direction === 'out'))
    .reduce((sum, m) => sum + amountOf(m), 0);

  const convertToStoreCurrency = (amount: number, sourceCurrency: string, rateValue: number = exchangeRate) => {
    if (sourceCurrency === currency) return { amount, rate: 1 };
    if (rateValue <= 0) return { amount, rate: 1 };
    if (sourceCurrency === 'USD' && currency === 'CDF') return { amount: amount * rateValue, rate: rateValue };
    if (sourceCurrency === 'CDF' && currency === 'USD') return { amount: amount / rateValue, rate: 1 / rateValue };
    return { amount, rate: 1 };
  };

  const openSession = async (funds: { usd: number; cdf: number; virtualUsd: number; virtualCdf: number }, registerNumber = 1) => {
    if (!user || !store) return;
    const liveRate = await readUsdCdfRate();
    if (liveRate <= 0 && (funds.cdf > 0 || funds.virtualCdf > 0) && currency === 'USD') { window.alert('Le taux USD/CDF est introuvable. Configure-le dans Paramètres → Finance avant d’ouvrir la caisse avec des CDF.'); return; }
    const occupied = await queryOne<{ id: string }>("SELECT id FROM cash_sessions WHERE store_id = $1 AND register_number = $2 AND status = 'open' LIMIT 1", [store.id, registerNumber]);
    if (occupied) { window.alert('Cette cabine possède déjà une session de caisse ouverte.'); return; }
    const assigned = await queryOne<{ assigned_user_id: string | null; status: string }>('SELECT assigned_user_id, status FROM cabins WHERE store_id = $1 AND register_number = $2', [store.id, registerNumber]);
    if (assigned && (assigned.status !== 'active' || (assigned.assigned_user_id && assigned.assigned_user_id !== user.id && !['owner','manager'].includes(user.role)))) { window.alert('Cette cabine est inactive ou attribuée à un autre agent.'); return; }
    const id = generateId();
    const primaryOpening = store.currency === 'USD' ? funds.usd : funds.cdf;
    await execute(
      `INSERT INTO cash_sessions (id, store_id, user_id, register_number, opening_amount, status, opened_at)
       VALUES ($1, $2, $3, $6, $4, 'open', $5)`,
      [id, store.id, user.id, primaryOpening, now(), registerNumber]
    );
    await execute("INSERT INTO app_meta (key,value) VALUES ($1,'upsert') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [`cloud_pending:cash_sessions:${id}`]);
    scheduleLocalTableSync('cash_sessions', id);
    const openingFunds = [
      { amount: funds.usd, currency: 'USD', method: 'cash', reason: 'Fond physique USD' },
      { amount: funds.cdf, currency: 'CDF', method: 'cash', reason: 'Fond physique CDF' },
      { amount: funds.virtualUsd, currency: 'USD', method: 'airtel_money', reason: 'Stock initial / solde Airtel Money USD' },
      { amount: funds.virtualCdf, currency: 'CDF', method: 'airtel_money', reason: 'Stock initial / solde Airtel Money CDF' },
    ];
    for (const fund of openingFunds) {
      if (fund.amount <= 0) continue;
      const converted = convertToStoreCurrency(fund.amount, fund.currency, liveRate);
      const movementId = generateId();
      await execute(
        `INSERT INTO cash_movements (id, cash_session_id, movement_type, payment_method, amount, direction, reference_type, user_id, reason, created_at, currency_code, original_amount, applied_rate)
         VALUES ($1, $2, 'opening', $3, $4, 'in', 'cash_open', $5, $6, $7, $8, $9, $10)`,
        [movementId, id, fund.method, converted.amount, user.id, fund.reason, now(), fund.currency, fund.amount, converted.rate]
      );
      await execute("INSERT INTO app_meta (key,value) VALUES ($1,'upsert') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [`cloud_pending:cash_movements:${movementId}`]);
      scheduleLocalTableSync('cash_movements', movementId);
    }
    await addAuditLog(user, 'cash_session', 'open', null, { id, ...funds });
    setShowOpen(false);
    load();
  };

  const addMovement = async (type: 'deposit' | 'withdrawal', method: string, amount: number, reason: string, currencyCode: string) => {
    if (!user || !cashSession) return;
    const direction = type === 'deposit' ? 'in' : 'out';
    const movementId = generateId();
    const liveRate = await readUsdCdfRate();
    if (liveRate <= 0 && currencyCode !== currency) { window.alert('Le taux USD/CDF est introuvable. Configure-le dans Paramètres → Finance.'); return; }
    const converted = convertToStoreCurrency(amount, currencyCode, liveRate);
    await execute(
      `INSERT INTO cash_movements (id, cash_session_id, movement_type, payment_method, amount, direction, reference_type, user_id, reason, created_at, currency_code, original_amount, applied_rate)
       VALUES ($1, $2, $3, $4, $5, $6, 'manual', $7, $8, $9, $10, $11, $12)`,
      [movementId, cashSession.id, type, method, converted.amount, direction, user.id, reason, now(), currencyCode, amount, converted.rate]
    );
    await execute("INSERT INTO app_meta (key,value) VALUES ($1,'upsert') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [`cloud_pending:cash_movements:${movementId}`]);
    scheduleLocalTableSync('cash_movements', movementId);
    await addAuditLog(user, 'cash_movement', 'create', null, { type, amount, reason });
    setShowMovement(false);
    load();
  };

  /** Clôture une session : la sienne, ou celle d'un autre utilisateur pour le propriétaire / gérant. */
  const closeSession = async (session: CashSession, rows: CashMovement[], counted: CountedDetail, notes: string) => {
    if (!user) return;
    const isManager = ['owner', 'manager'].includes(user.role);
    if (session.user_id !== user.id && !isManager) { window.alert('Seul le propriétaire ou un gérant peut clôturer la caisse d’un autre utilisateur.'); return; }
    const fresh = await queryOne<{ status: string }>('SELECT status FROM cash_sessions WHERE id = $1', [session.id]);
    if (!fresh || fresh.status !== 'open') { window.alert('Cette session est déjà clôturée.'); setShowClose(false); setClosingTeamSession(null); void load(); return; }
    const exp = sessionBalances(rows, currency);
    const liveRate = await readUsdCdfRate();
    const equivalent = (usd: number, cdf: number) => (liveRate > 0 ? usd + cdf / liveRate : (currency === 'USD' ? usd : cdf));
    const expectedEq = equivalent(exp.cashUsd, exp.cashCdf);
    const countedEq = equivalent(counted.cashUsd, counted.cashCdf);
    const diff = countedEq - expectedEq;
    const detail = JSON.stringify({ expected: exp, counted, rate: liveRate, closed_by: user.id });
    await execute(
      `UPDATE cash_sessions SET status = 'closed', closing_amount = $1, expected_closing = $2, difference = $3, closed_at = $4, notes = $5, closing_detail = $6 WHERE id = $7`,
      [countedEq, expectedEq, diff, now(), notes, detail, session.id]
    );
    await execute("INSERT INTO app_meta (key,value) VALUES ($1,'upsert') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [`cloud_pending:cash_sessions:${session.id}`]);
    scheduleLocalTableSync('cash_sessions', session.id);
    await addAuditLog(user, 'cash_session', 'close', session, { counted, expected: exp, difference: diff, closed_by_other: session.user_id !== user.id });
    if (cashSession?.id === session.id) setCashSession(null);
    setShowClose(false);
    setClosingTeamSession(null);
    void load();
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

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3 mb-3">
              <MoneyCard title="Espèces physiques" subtitle="Tiroir-caisse" icon={Coins} usd={physicalUsd} cdf={physicalCdf} from="#0F766E" to="#2DD4BF" />
              <MoneyCard title="Airtel Money (e-float)" subtitle="Solde virtuel" icon={Smartphone} usd={mobileUsd} cdf={mobileCdf} from="#B91C1C" to="#F87171" />
              <MoneyCard
                title="Total disponible"
                subtitle="Espèces + Airtel Money"
                icon={Landmark}
                usd={totalUsd}
                cdf={totalCdf}
                from="#1D4ED8"
                to="#818CF8"
                grandTotalUsd={exchangeRate > 0 ? totalUsdEquivalent : null}
                grandTotalNote={exchangeRate > 0 ? <>USD + CDF converti ({formatCurrency(totalCdf / exchangeRate, 'USD', 2)}) · taux {exchangeRate.toLocaleString('fr-FR')} CDF/USD</> : undefined}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <SoftMoneyCard title="Fond d'ouverture" subtitle="Espèces au départ" icon={Sunrise} usd={cashBy('USD', 'opening')} cdf={cashBy('CDF', 'opening')} color="#64748B" />
              <SoftMoneyCard title="Entrées" subtitle="Espèces encaissées" icon={ArrowDownCircle} usd={cashBy('USD', 'in')} cdf={cashBy('CDF', 'in')} color="#16A34A" />
              <SoftMoneyCard title="Sorties" subtitle="Espèces décaissées" icon={ArrowUpCircle} usd={cashBy('USD', 'out')} cdf={cashBy('CDF', 'out')} color="#DC2626" />
            </div>

            <div className="mt-3 bg-primary-50 rounded-lg p-3 flex items-center justify-between">
              <span className="text-sm font-medium text-primary-700">Solde théorique des espèces</span>
              <div className="text-right text-primary-700">
                <div className="font-bold">{formatCurrency(physicalUsd, 'USD', 2)} · {formatCurrency(physicalCdf, 'CDF', 0)}</div>
                {exchangeRate > 0
                  ? <div className="text-xs">CDF converti : ≈ {formatCurrency(physicalCdf / exchangeRate, 'USD', 2)} · <strong className="text-base">Total ≈ {formatCurrency(physicalUsd + physicalCdf / exchangeRate, 'USD', 2)}</strong> <span className="text-primary-500">(taux {exchangeRate.toLocaleString('fr-FR')})</span></div>
                  : <div className="text-xs text-amber-700">Taux USD/CDF introuvable (Paramètres → Finance)</div>}
              </div>
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
                      {m.direction === 'in' ? '+' : '-'}{formatCurrency(Number(m.original_amount || m.amount), m.currency_code || currency, (m.currency_code || currency) === 'CDF' ? 0 : 2)}{m.currency_code && m.currency_code !== currency ? (exchangeRate > 0 ? ` (≈ ${formatCurrency(m.currency_code === 'USD' ? Number(m.original_amount || m.amount) * (currency === 'CDF' ? exchangeRate : 1 / exchangeRate) : Number(m.original_amount || m.amount) * (currency === 'USD' ? 1 / exchangeRate : exchangeRate), currency, decimals)})` : ' (équivalent indisponible : taux USD/CDF à configurer)') : ''}
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

      {['owner', 'manager'].includes(user.role) && (
        <div className="mt-6">
          <h3 className="font-semibold text-slate-700 text-sm mb-2">Caisses ouvertes par l'équipe</h3>
          {teamSessions.length === 0 ? (
            <div className="card p-4 text-sm text-slate-400">Aucune caisse ouverte par un autre utilisateur pour le moment.</div>
          ) : (
            <div className="space-y-4">
              {teamSessions.map((s) => {
                const rows = teamMovements[s.id] ?? [];
                const b = sessionBalances(rows, currency);
                return (
                  <div key={s.id} className="card p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-10 h-10 bg-success-100 rounded-full flex items-center justify-center">
                          <Unlock className="w-5 h-5 text-success-600" />
                        </div>
                        <div>
                          <p className="font-semibold text-slate-800">{s.user_name || 'Utilisateur'} · Cabine {s.register_number}</p>
                          <p className="text-xs text-slate-400">Ouverte depuis {formatDateTime(s.opened_at)} · {rows.length} mouvement{rows.length > 1 ? 's' : ''}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="badge-success">Ouverte</span>
                        <button onClick={() => setClosingTeamSession(s)} className="btn-danger text-xs"><Lock className="w-3.5 h-3.5" /> Clôturer</button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      <MoneyCard title="Espèces physiques" subtitle="Tiroir-caisse" icon={Coins} usd={b.cashUsd} cdf={b.cashCdf} from="#0F766E" to="#2DD4BF" />
                      <MoneyCard title="Airtel Money (e-float)" subtitle="Solde virtuel" icon={Smartphone} usd={b.airtelUsd} cdf={b.airtelCdf} from="#B91C1C" to="#F87171" />
                      <MoneyCard title="Total disponible" subtitle="Espèces + Airtel Money" icon={Landmark} usd={b.totalUsd} cdf={b.totalCdf} from="#1D4ED8" to="#818CF8" grandTotalUsd={exchangeRate > 0 ? b.totalUsd + b.totalCdf / exchangeRate : null} grandTotalNote={exchangeRate > 0 ? <>USD + CDF converti ({formatCurrency(b.totalCdf / exchangeRate, 'USD', 2)}) · taux {exchangeRate.toLocaleString('fr-FR')} CDF/USD</> : undefined} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="mt-6">
        <h3 className="font-semibold text-slate-700 text-sm mb-2">Historique des sessions</h3>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-slate-600">Utilisateur</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">Ouverture</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">Clôture</th>
                <th className="text-right px-4 py-2 font-medium text-slate-600">Fond espèces</th>
                <th className="text-right px-4 py-2 font-medium text-slate-600">Théorique espèces</th>
                <th className="text-right px-4 py-2 font-medium text-slate-600">Compté espèces</th>
                <th className="text-right px-4 py-2 font-medium text-slate-600">Écart</th>
                <th className="text-center px-4 py-2 font-medium text-slate-600">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sessions.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 text-xs text-slate-700">{s.user_name || '—'} · C{s.register_number}</td>
                  <td className="px-4 py-2 text-xs text-slate-500">{formatDateTime(s.opened_at)}</td>
                  <td className="px-4 py-2 text-xs text-slate-500">{s.closed_at ? formatDateTime(s.closed_at) : '—'}</td>
                  {(() => {
                    const rows = historyMovements[s.id] ?? [];
                    const open = openingFunds(rows, currency);
                    let detail: { expected?: CashDetail; counted?: CountedDetail; rate?: number } | null = null;
                    try { detail = s.closing_detail ? JSON.parse(s.closing_detail) : null; } catch { detail = null; }
                    const rateOf = (detail?.rate && detail.rate > 0 ? detail.rate : exchangeRate) || 0; // taux de la clôture, sinon taux actuel
                    const expected = detail?.expected ?? sessionBalances(rows, currency); // session ouverte : solde actuel
                    const counted = detail?.counted;
                    const legacyClosed = s.status === 'closed' && !detail;
                    return (
                      <>
                        <td className="px-4 py-2 text-right"><MoneyPair usd={open.cashUsd} cdf={open.cashCdf} rate={rateOf} /></td>
                        <td className="px-4 py-2 text-right">{legacyClosed ? (s.expected_closing != null ? formatCurrency(s.expected_closing, currency, decimals) : '—') : <MoneyPair usd={expected.cashUsd} cdf={expected.cashCdf} rate={rateOf} />}</td>
                        <td className="px-4 py-2 text-right">{counted ? <MoneyPair usd={counted.cashUsd} cdf={counted.cashCdf} rate={rateOf} /> : (legacyClosed && s.closing_amount != null ? formatCurrency(s.closing_amount, currency, decimals) : '—')}</td>
                        <td className="px-4 py-2 text-right">
                          {counted ? <MoneyPair usd={counted.cashUsd - expected.cashUsd} cdf={counted.cashCdf - expected.cashCdf} rate={rateOf} tone="diff" />
                            : legacyClosed && s.difference != null ? (
                              <span className={Math.abs(s.difference) > 1 ? 'text-error-600 font-bold' : 'text-success-600'}>{s.difference >= 0 ? '+' : ''}{formatCurrency(s.difference, currency, decimals)}</span>
                            ) : '—'}
                        </td>
                      </>
                    );
                  })()}
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
        <OpenCashModal onConfirm={openSession} onClose={() => setShowOpen(false)} currency={currency} decimals={decimals} userId={user.id} storeId={store.id} role={user.role} />
      )}
      {showMovement && (
        <MovementModal onConfirm={addMovement} onClose={() => setShowMovement(false)} currency={currency} decimals={decimals} />
      )}
      {showExchange && cashSession && <CurrencyExchangeModal cashSessionId={cashSession.id} onClose={() => setShowExchange(false)} onSaved={() => { setShowExchange(false); load(); }} />}
      {showClose && cashSession && (
        <CloseCashModal
          expected={sessionBalances(movements, currency)}
          exchangeRate={exchangeRate}
          title="Clôturer la caisse"
          onConfirm={(counted, notes) => closeSession(cashSession, movements, counted, notes)}
          onClose={() => setShowClose(false)}
          currency={currency}
          decimals={decimals}
        />
      )}
      {closingTeamSession && (
        <CloseCashModal
          expected={sessionBalances(teamMovements[closingTeamSession.id] ?? [], currency)}
          exchangeRate={exchangeRate}
          title={`Clôturer la caisse de ${closingTeamSession.user_name || 'l’utilisateur'}`}
          onConfirm={(counted, notes) => closeSession(closingTeamSession, teamMovements[closingTeamSession.id] ?? [], counted, notes)}
          onClose={() => setClosingTeamSession(null)}
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
  useEffect(() => { void readUsdCdfRate().then(setRate); }, []);
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
  return <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}><div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}><div className="p-4 border-b flex items-center justify-between"><h2 className="font-semibold">Échange USD → CDF</h2><button onClick={onClose}><X className="w-5 h-5" /></button></div><div className="p-4 space-y-3"><p className="text-sm text-slate-500">Opération enregistrée séparément des ventes de marchandises.</p><div><label className="label">Montant reçu en USD</label><input type="number" min="0" step="0.01" value={usdAmount} onChange={(e) => setUsdAmount(e.target.value)} className="input" /></div><div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Taux d’échange</p><p className="font-semibold">{rate > 0 ? `${rate.toLocaleString('fr-FR')} CDF/USD` : 'Non configuré'}</p><p className="text-xs text-slate-500 mt-2">CDF à remettre</p><p className="text-xl font-bold">{cdfAmount.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} CDF</p></div><div className="flex gap-2"><button onClick={onClose} className="btn-secondary flex-1">Annuler</button><LoadingButton onClick={save} loading={saving} loadingText="Enregistrement…" disabled={rate <= 0 || Number(usdAmount) <= 0} className="btn-primary flex-1">Enregistrer l’échange</LoadingButton></div></div></div></div>;
}

function OpenCashModal({ onConfirm, onClose, currency, decimals, userId, storeId, role }: { onConfirm: (funds: { usd: number; cdf: number; virtualUsd: number; virtualCdf: number }, registerNumber: number) => void | Promise<void>; onClose: () => void; currency: string; decimals: number; userId: string; storeId: string; role: string }) {
  const [usd, setUsd] = useState('0');
  const [cdf, setCdf] = useState('0');
  const [virtualUsd, setVirtualUsd] = useState('0');
  const [virtualCdf, setVirtualCdf] = useState('0');
  const [registerNumber, setRegisterNumber] = useState('1');
  const [cabins, setCabins] = useState<Array<{register_number:number;name:string;assigned_user_id:string|null;status:string}>>([]);
  useEffect(() => { void query<{register_number:number;name:string;assigned_user_id:string|null;status:string}>("SELECT register_number,name,assigned_user_id,status FROM cabins WHERE store_id=$1 AND status='active' AND (assigned_user_id IS NULL OR assigned_user_id=$2 OR $3 IN ('owner','manager')) ORDER BY register_number", [storeId,userId,role]).then(setCabins).catch(err => console.error('Cabines non chargées',err)); }, [storeId,userId,role]);
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">Ouvrir la caisse</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-sm text-slate-500">Déclare les fonds de départ : espèces et stock initial Airtel Money (e-float). Les montants restent dans leur devise.</p>
          <div><label className="label">Cabine / registre</label><select className="input" value={registerNumber} onChange={e=>setRegisterNumber(e.target.value)}>{!cabins.some(c=>c.register_number===1)&&<option value="1">Registre 1 (par défaut)</option>}{cabins.map(c=><option key={c.register_number} value={c.register_number}>{c.name} — registre {c.register_number}</option>)}</select></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Fonds physiques USD</label><input type="number" min="0" step="0.01" value={usd} onChange={(e) => setUsd(e.target.value)} className="input" /></div>
            <div><label className="label">Fonds physiques CDF</label><input type="number" min="0" step="1" value={cdf} onChange={(e) => setCdf(e.target.value)} className="input" /></div>
            <div><label className="label">Stock initial / solde Airtel Money USD</label><input type="number" min="0" step="0.01" value={virtualUsd} onChange={(e) => setVirtualUsd(e.target.value)} className="input" /></div>
            <div><label className="label">Stock initial / solde Airtel Money CDF</label><input type="number" min="0" step="1" value={virtualCdf} onChange={(e) => setVirtualCdf(e.target.value)} className="input" /></div>
          </div>
          <LoadingButton onClick={() => onConfirm({ usd: Math.max(0, Number(usd) || 0), cdf: Math.max(0, Number(cdf) || 0), virtualUsd: Math.max(0, Number(virtualUsd) || 0), virtualCdf: Math.max(0, Number(virtualCdf) || 0) }, Number(registerNumber))} loadingText="Ouverture…" className="btn-primary w-full">
            Ouvrir la session
          </LoadingButton>
        </div>
      </div>
    </div>
  );
}

function MovementModal({ onConfirm, onClose, currency, decimals }: { onConfirm: (type: 'deposit' | 'withdrawal', method: string, amount: number, reason: string, currencyCode: string) => void | Promise<void>; onClose: () => void; currency: string; decimals: number }) {
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
          <LoadingButton
            onClick={() => onConfirm(type, method, parseFloat(amount) || 0, reason || type, currencyCode)}
            disabled={!(parseFloat(amount) > 0)}
            loadingText="Enregistrement…"
            className="btn-primary w-full"
          >
            Valider
          </LoadingButton>
        </div>
      </div>
    </div>
  );
}

function CloseCashModal({ expected, exchangeRate, title, onConfirm, onClose, currency, decimals }: { expected: CashDetail; exchangeRate: number; title: string; onConfirm: (counted: CountedDetail, notes: string) => void | Promise<void>; onClose: () => void; currency: string; decimals: number }) {
  const [countedUsd, setCountedUsd] = useState('');
  const [countedCdf, setCountedCdf] = useState('');
  const [airtelUsd, setAirtelUsd] = useState('');
  const [airtelCdf, setAirtelCdf] = useState('');
  const [notes, setNotes] = useState('');
  const num = (v: string) => Number(v) || 0;
  const filled = (v: string) => v.trim() !== '';
  // Une devise qui a un solde théorique doit être comptée ; une devise à zéro peut rester vide (= 0).
  const needUsd = !sameMoney(expected.cashUsd, 0);
  const needCdf = !sameMoney(expected.cashCdf, 0);
  const canConfirm = (!needUsd || filled(countedUsd)) && (!needCdf || filled(countedCdf)) && (filled(countedUsd) || filled(countedCdf) || (!needUsd && !needCdf));
  const diffUsd = num(countedUsd) - expected.cashUsd;
  const diffCdf = num(countedCdf) - expected.cashCdf;
  const equivalent = (usd: number, cdf: number) => (exchangeRate > 0 ? usd + cdf / exchangeRate : (currency === 'USD' ? usd : cdf));
  const hasCount = filled(countedUsd) || filled(countedCdf);
  const bad = !sameMoney(diffUsd, 0) || !sameMoney(diffCdf, 0);
  void decimals;
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm animate-scale-in max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-slate-200 flex items-center justify-between"><h2 className="text-lg font-semibold text-slate-800">{title}</h2><button onClick={onClose} aria-label="Fermer"><X className="w-5 h-5 text-slate-400" /></button></div>
        <div className="p-4 space-y-3">
          <div className="bg-primary-50 rounded-lg p-3 text-center">
            <p className="text-sm text-primary-600">Solde théorique des espèces</p>
            <p className="text-lg font-bold text-primary-700">{formatCurrency(expected.cashUsd, 'USD', 2)}</p>
            <p className="text-lg font-bold text-primary-700">{formatCurrency(expected.cashCdf, 'CDF', 0)}</p>
            {exchangeRate > 0
              ? <p className="text-xs text-primary-600">CDF converti ≈ {formatCurrency(expected.cashCdf / exchangeRate, 'USD', 2)} · Total ≈ <strong>{formatCurrency(equivalent(expected.cashUsd, expected.cashCdf), 'USD', 2)}</strong> (taux {exchangeRate.toLocaleString('fr-FR')} CDF/USD)</p>
              : <p className="text-xs text-amber-700">Taux USD/CDF introuvable : configure-le dans Paramètres → Finance pour voir les équivalents.</p>}
            <p className="mt-1 text-xs text-slate-500">Chaque devise est comptée séparément. Le solde Airtel Money est contrôlé à part (facultatif).</p>
          </div>
          <div><label className="label">Espèces comptées en USD</label><input type="number" min="0" step="0.01" value={countedUsd} onChange={(e) => setCountedUsd(e.target.value)} className="input" autoFocus /></div>
          <div><label className="label">Espèces comptées en CDF</label><input type="number" min="0" step="1" value={countedCdf} onChange={(e) => setCountedCdf(e.target.value)} className="input" /></div>
          {hasCount && (
            <div className={`rounded-lg p-3 text-center ${bad ? 'bg-error-50' : 'bg-success-50'}`}>
              <p className={`text-sm ${bad ? 'text-error-600' : 'text-success-600'}`}>{bad && <AlertTriangle className="w-4 h-4 inline mr-1" />}Écart : {diffUsd >= 0 ? '+' : ''}{formatCurrency(diffUsd, 'USD', 2)} · {diffCdf >= 0 ? '+' : ''}{formatCurrency(diffCdf, 'CDF', 0)}</p>
              {exchangeRate > 0 && <p className="text-xs text-slate-600 mt-1">Compté : CDF ≈ {formatCurrency(num(countedCdf) / exchangeRate, 'USD', 2)} · Total ≈ {formatCurrency(equivalent(num(countedUsd), num(countedCdf)), 'USD', 2)} · Écart total ≈ {formatCurrency(equivalent(diffUsd, diffCdf), 'USD', 2)}</p>}
            </div>
          )}
          <div className="rounded-lg border border-slate-200 p-3 space-y-2">
            <p className="text-xs font-medium text-slate-600">Airtel Money (e-float) — facultatif</p>
            <p className="text-xs text-slate-500">Théorique : {formatCurrency(expected.airtelUsd, 'USD', 2)} + {formatCurrency(expected.airtelCdf, 'CDF', 0)}</p>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="label">Solde USD</label><input type="number" min="0" step="0.01" value={airtelUsd} onChange={(e) => setAirtelUsd(e.target.value)} className="input" /></div>
              <div><label className="label">Solde CDF</label><input type="number" min="0" step="1" value={airtelCdf} onChange={(e) => setAirtelCdf(e.target.value)} className="input" /></div>
            </div>
          </div>
          <div><label className="label">Notes (facultatif)</label><input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Commentaire sur l’écart…" className="input" /></div>
          <LoadingButton
            onClick={() => onConfirm({ cashUsd: num(countedUsd), cashCdf: num(countedCdf), airtelUsd: filled(airtelUsd) ? num(airtelUsd) : null, airtelCdf: filled(airtelCdf) ? num(airtelCdf) : null }, notes)}
            disabled={!canConfirm}
            loadingText="Clôture en cours…"
            className="btn-danger w-full"
          ><Lock className="w-4 h-4" /> Clôturer la session</LoadingButton>
        </div>
      </div>
    </div>
  );
}
