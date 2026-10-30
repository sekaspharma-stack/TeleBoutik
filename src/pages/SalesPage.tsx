import { useState, useEffect, useCallback } from 'react';
import { Search, Receipt, Eye, X, Ban, ScanLine, ShieldCheck, ShieldAlert, ShieldQuestion, FileText } from 'lucide-react';
import { query } from '../db/localDb';
import { useAuth } from '../context/AuthContext';
import { formatCurrency, formatDateTime, paymentLabel, canSeeMargin, canCancelSale } from '../lib/utils';
import { cancelSale, getSaleLines, getSalePayments } from '../db/saleService';
import { approveOwnerSensitiveAction } from '../db/operations';
import type { Sale, SaleLine, SalePayment } from '../types';
import TicketModal from '../components/TicketModal';
import LoadingButton from '../components/LoadingButton';
import { verifyReceipt, type ReceiptVerification } from '../lib/receipt';

export default function SalesPage() {
  const { user, store } = useAuth();
  const [sales, setSales] = useState<Sale[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'completed' | 'cancelled' | 'on_credit'>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [checkInput, setCheckInput] = useState('');
  const [checkResult, setCheckResult] = useState<ReceiptVerification | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const loadSales = useCallback(async () => {
    let sql = `SELECT * FROM sales`;
    const params: unknown[] = [];
    if (filter !== 'all') {
      sql += ` WHERE status = $1`;
      params.push(filter);
    }
    sql += ` ORDER BY sale_date DESC LIMIT 200`;
    setSales(await query<Sale>(sql, params));
  }, [filter]);

  useEffect(() => { loadSales(); }, [loadSales]);

  if (!user || !store) return null;
  const showMargin = canSeeMargin(user.role);
  const canCancel = canCancelSale(user.role);
  const currency = store.currency;
  const decimals = store.currency_decimals;

  const filtered = sales.filter((s) => {
    if (!search) return true;
    const needle = search.toLowerCase().replace(/\s/g, '');
    return s.ticket_number.toLowerCase().includes(needle) || (s.receipt_ref ?? '').toLowerCase().includes(needle);
  });

  const todaySales = sales.filter((s) => s.status === 'completed' && s.sale_date.startsWith(new Date().toISOString().split('T')[0]));
  const todayUSD = todaySales.filter((s) => (s.currency_code || currency) === 'USD').reduce((sum, s) => sum + s.total, 0);
  const todayCDF = todaySales.filter((s) => (s.currency_code || currency) === 'CDF').reduce((sum, s) => sum + s.total, 0);

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-slate-800">Ventes</h1>
        <p className="text-sm text-slate-500">
          CA du jour : {formatCurrency(todayUSD, 'USD', 2)} · {formatCurrency(todayCDF, 'CDF', 0)} · {sales.length} ventes
        </p>
      </div>

      <div className="card mb-4 p-4">
        <div className="mb-2 flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary-100 text-primary-700"><ScanLine className="h-4 w-4" /></span>
          <div>
            <h2 className="text-sm font-bold text-slate-800">Vérifier un reçu</h2>
            <p className="text-xs text-slate-500">Saisissez ou scannez la référence imprimée sur le reçu (ex. TB2-261028-7K2M9Q-A1B2C3) ou un n° de ticket.</p>
          </div>
        </div>
        <form className="flex flex-wrap gap-2" onSubmit={(e) => e.preventDefault()}>
          <input
            className="input min-w-[220px] flex-1 font-mono uppercase"
            value={checkInput}
            onChange={(e) => { setCheckInput(e.target.value); setCheckResult(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void (async () => setCheckResult(await verifyReceipt(checkInput)))(); } }}
            placeholder="TB2-AAMMJJ-XXXXXX-YYYYYY"
            aria-label="Référence du reçu à vérifier"
            autoComplete="off"
            spellCheck={false}
          />
          <LoadingButton className="btn-primary" disabled={!checkInput.trim()} loadingText="Vérification…" onClick={async () => setCheckResult(await verifyReceipt(checkInput))}>
            <ShieldCheck className="h-4 w-4" /> Vérifier
          </LoadingButton>
        </form>
        {checkResult && <VerificationResult result={checkResult} onOpen={(id) => setReceiptId(id)} />}
      </div>

      <div className="mb-4 flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filtrer par n° ticket ou référence…"
            className="input pl-9"
          />
        </div>
        <button onClick={() => setFilter('all')} className={filter === 'all' ? 'btn-primary' : 'btn-secondary'}>Toutes</button>
        <button onClick={() => setFilter('completed')} className={filter === 'completed' ? 'btn-primary' : 'btn-secondary'}>Terminées</button>
        <button onClick={() => setFilter('cancelled')} className={filter === 'cancelled' ? 'btn-primary' : 'btn-secondary'}>Annulées</button>
        <button onClick={() => setFilter('on_credit')} className={filter === 'on_credit' ? 'btn-primary' : 'btn-secondary'}>Crédit</button>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[600px]">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium text-slate-600">Ticket / Réf.</th>
              <th className="text-left px-4 py-2.5 font-medium text-slate-600">Date</th>
              <th className="text-right px-4 py-2.5 font-medium text-slate-600">Total</th>
              {showMargin && <th className="text-right px-4 py-2.5 font-medium text-slate-600">Marge</th>}
              <th className="text-center px-4 py-2.5 font-medium text-slate-600">Statut</th>
              <th className="text-center px-4 py-2.5 font-medium text-slate-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((sale) => (
              <tr key={sale.id} className="hover:bg-slate-50">
                <td className="px-4 py-2.5 font-mono text-xs">{sale.ticket_number}{sale.receipt_ref && <span className="block text-[10px] text-slate-400">{sale.receipt_ref}</span>}</td>
                <td className="px-4 py-2.5 text-slate-500 text-xs">{formatDateTime(sale.sale_date)}</td>
                <td className="px-4 py-2.5 text-right font-medium text-slate-800">
                  {formatCurrency(sale.total, sale.currency_code || currency, (sale.currency_code || currency) === 'CDF' ? 0 : 2)}
                </td>
                {showMargin && (
                  <td className="px-4 py-2.5 text-right text-success-600 font-medium">
                    {formatCurrency(sale.total - sale.total_cost, sale.currency_code || currency, (sale.currency_code || currency) === 'CDF' ? 0 : 2)}
                  </td>
                )}
                <td className="px-4 py-2.5 text-center">
                  <span className={
                    sale.status === 'completed' ? 'badge-success' :
                    sale.status === 'cancelled' ? 'badge-error' :
                    'badge-warning'
                  }>
                    {sale.status === 'completed' ? 'Terminée' :
                     sale.status === 'cancelled' ? 'Annulée' : 'Crédit'}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-center">
                  <button onClick={() => setReceiptId(sale.id)} title="Voir le reçu" aria-label="Voir le reçu" className="text-slate-400 hover:text-primary-600 p-1">
                    <FileText className="w-4 h-4" />
                  </button>
                  <button onClick={() => setSelected(sale.id)} title="Détail de la vente" aria-label="Détail de la vente" className="text-slate-400 hover:text-primary-600 p-1 ml-1">
                    <Eye className="w-4 h-4" />
                  </button>
                  {canCancel && sale.status === 'completed' && (
                    <button
                      disabled={cancellingId !== null}
                      onClick={async () => {
                        if (cancellingId) return; // verrou : une seule annulation à la fois
                        if (!confirm('Annuler cette vente? Une contre-passation sera créée.')) return;
                        const reason = window.prompt('Motif obligatoire de l’annulation :');
                        if (!reason?.trim()) return;
                        // Le propriétaire peut annuler seul. Toute autre personne doit obtenir l'accord explicite du propriétaire.
                        const ownerPin = user.role === 'owner' ? null : window.prompt('PIN du PROPRIÉTAIRE pour confirmer cette annulation :');
                        if (user.role !== 'owner' && !ownerPin) return;
                        setCancellingId(sale.id);
                        try {
                          if (user.role !== 'owner' && ownerPin) {
                            await approveOwnerSensitiveAction({ storeId: sale.store_id, action: 'sale_cancel', targetId: sale.id, requesterId: user.id, ownerPin, reason: reason.trim() });
                          }
                          const result = await cancelSale(sale.id, reason.trim(), user);
                          await loadSales();
                          if (result.warnings.length) window.alert(result.warnings.join('\n'));
                        }
                        catch (e) { window.alert(e instanceof Error ? e.message : 'Annulation impossible'); }
                        finally { setCancellingId(null); }
                      }}
                      title="Annuler la vente"
                      aria-label="Annuler la vente"
                      className="text-slate-400 hover:text-error-600 p-1 ml-1 disabled:opacity-40"
                    >
                      {cancellingId === sale.id ? <span className="spinner inline-block" /> : <Ban className="w-4 h-4" />}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="p-8 text-center text-slate-400 text-sm">
            <Receipt className="w-10 h-10 mx-auto mb-2 opacity-30" />
            Aucune vente
          </div>
        )}
      </div>

      {selected && (
        <SaleDetailModal saleId={selected} onClose={() => setSelected(null)} />
      )}
      {receiptId && <TicketModal saleId={receiptId} mode="view" onClose={() => setReceiptId(null)} />}
    </div>
  );
}

function VerificationResult({ result, onOpen }: { result: ReceiptVerification; onOpen: (saleId: string) => void }) {
  const { store } = useAuth();
  const map = {
    authentic: { icon: ShieldCheck, cls: 'border-success-500/40 bg-success-50 text-success-700', title: 'Reçu authentique', text: 'Le contenu correspond exactement à ce qui a été enregistré lors de la vente.' },
    tampered: { icon: ShieldAlert, cls: 'border-red-300 bg-red-50 text-red-700', title: 'Reçu altéré', text: 'La référence existe mais les montants ou lignes ont été modifiés depuis l’émission. Ne pas accepter ce reçu.' },
    legacy: { icon: ShieldQuestion, cls: 'border-amber-300 bg-amber-50 text-amber-800', title: 'Reçu ancien (legacy)', text: 'Ticket retrouvé, mais émis avant le sceau v2 (paiements, monnaie rendue, client et vendeur non couverts) : son intégrité ne peut pas être certifiée.' },
    ambiguous: { icon: ShieldQuestion, cls: 'border-amber-300 bg-amber-50 text-amber-800', title: 'Plusieurs ventes portent ce n° de ticket', text: 'Anciens tickets en doublon : saisissez la référence complète imprimée sur le reçu (TB2-…) pour identifier la bonne vente.' },
    not_found: { icon: ShieldQuestion, cls: 'border-slate-300 bg-slate-50 text-slate-700', title: 'Aucun reçu trouvé', text: 'Cette référence n’existe pas dans la base de cette boutique. Vérifiez la saisie, ou la synchronisation si la vente vient d’un autre poste.' },
  }[result.status];
  const Icon = map.icon;
  const sale = result.status === 'not_found' || result.status === 'ambiguous' ? null : result.sale;
  const cur = sale ? (sale.currency_code || store?.currency || 'USD') : 'USD';
  return (
    <div className={`mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 ${map.cls}`} role="status">
      <div className="flex min-w-0 items-start gap-2">
        <Icon className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-bold">{map.title}</p>
          <p className="text-xs opacity-90">{map.text}</p>
          {sale && <p className="mt-1 text-xs font-semibold">N° {sale.ticket_number} · {formatDateTime(sale.sale_date)} · {formatCurrency(sale.total, cur, cur === 'CDF' ? 0 : 2)}{sale.status === 'cancelled' ? ' · ANNULÉE' : ''}</p>}
        </div>
      </div>
      {sale && <button type="button" onClick={() => onOpen(sale.id)} className="btn-secondary !min-h-9 !py-1.5 text-xs">Afficher le reçu</button>}
    </div>
  );
}

function SaleDetailModal({ saleId, onClose }: { saleId: string; onClose: () => void }) {
  const { store, user } = useAuth();
  const [sale, setSale] = useState<Sale | null>(null);
  const [lines, setLines] = useState<SaleLine[]>([]);
  const [payments, setPayments] = useState<SalePayment[]>([]);

  useEffect(() => {
    (async () => {
      const s = await import('../db/saleService');
      setSale(await s.getSaleById(saleId));
      setLines(await s.getSaleLines(saleId));
      setPayments(await s.getSalePayments(saleId));
    })();
  }, [saleId]);

  if (!sale || !store) return null;
  const showMargin = user && canSeeMargin(user.role);
  const currency = store.currency;
  const decimals = store.currency_decimals;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg animate-scale-in max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">Détail vente</h2>
            <p className="text-xs font-mono text-slate-400">{sale.ticket_number}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div className="text-sm text-slate-500">{formatDateTime(sale.sale_date)}</div>
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-400">
              <tr><th className="text-left pb-1">Produit</th><th className="text-right pb-1">Qté</th><th className="text-right pb-1">Prix</th><th className="text-right pb-1">Total</th></tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-t border-slate-100">
                  <td className="py-1.5">{l.product_name}</td>
                  <td className="text-right">{l.quantity}</td>
                  <td className="text-right">{formatCurrency(l.unit_price, sale.currency_code || currency, (sale.currency_code || currency) === 'CDF' ? 0 : 2)}</td>
                  <td className="text-right font-medium">{formatCurrency(l.line_total, sale.currency_code || currency, (sale.currency_code || currency) === 'CDF' ? 0 : 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-slate-200 pt-2 space-y-1">
            <div className="flex justify-between text-sm"><span className="text-slate-500">Sous-total</span><span>{formatCurrency(sale.subtotal, sale.currency_code || currency, (sale.currency_code || currency) === 'CDF' ? 0 : 2)}</span></div>
            {sale.discount > 0 && <div className="flex justify-between text-sm"><span className="text-slate-500">Remise</span><span>-{formatCurrency(sale.discount, sale.currency_code || currency, (sale.currency_code || currency) === 'CDF' ? 0 : 2)}</span></div>}
            {sale.tax_amount > 0 && <div className="flex justify-between text-sm"><span className="text-slate-500">TVA</span><span>{formatCurrency(sale.tax_amount, sale.currency_code || currency, (sale.currency_code || currency) === 'CDF' ? 0 : 2)}</span></div>}
            <div className="flex justify-between text-base font-bold"><span>Total</span><span className="text-primary-700">{formatCurrency(sale.total, sale.currency_code || currency, (sale.currency_code || currency) === 'CDF' ? 0 : 2)}</span></div>
          </div>
          <div className="border-t border-slate-200 pt-2">
            <p className="text-xs text-slate-400 mb-1">Paiements</p>
            {payments.map((p) => (
              <div key={p.id} className="flex justify-between text-sm">
                <span>{paymentLabel(p.payment_method)}{p.reference ? ` (${p.reference})` : ''}</span>
                <span>{formatCurrency(p.original_amount ?? p.amount, p.currency_code || sale.currency_code || currency, (p.currency_code || sale.currency_code || currency) === 'CDF' ? 0 : 2)}</span>
              </div>
            ))}
          </div>
          {showMargin && (
            <div className="border-t border-slate-200 pt-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Coût (COGS)</span>
                <span>{formatCurrency(sale.total_cost, sale.currency_code || currency, (sale.currency_code || currency) === 'CDF' ? 0 : 2)}</span>
              </div>
              <div className="flex justify-between text-sm font-bold text-success-600">
                <span>Marge brute</span>
                <span>{formatCurrency(sale.total - sale.total_cost, sale.currency_code || currency, (sale.currency_code || currency) === 'CDF' ? 0 : 2)}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
