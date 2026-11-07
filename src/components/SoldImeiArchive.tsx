import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, Search, FileText, History, X, Smartphone } from 'lucide-react';
import { query } from '../db/localDb';
import { useAuth } from '../context/AuthContext';
import { canSeeMargin, formatCurrency, formatDateTime, lifecycleLabel } from '../lib/utils';
import TicketModal from './TicketModal';

interface ArchivedUnit {
  id: string; imei1: string; imei2: string | null; serial_number: string | null; lifecycle_status: string;
  cost: number; received_at: string; sold_at: string | null;
  brand: string; model: string; attributes: string | Record<string, string>; sku: string;
  sale_id: string | null; ticket_number: string | null; receipt_ref: string | null; sale_date: string | null;
  sale_currency: string | null; unit_price: number | null; sale_status: string | null;
  customer_name: string | null; seller_name: string | null;
}

interface TimelineRow { id: string; created_at: string; movement_type: string; direction: string; reason: string; user_name: string | null }

const MOVEMENT_LABEL: Record<string, string> = {
  purchase: 'Entrée en stock', sale: 'Vente', return: 'Retour / annulation de vente', adjustment: 'Ajustement',
  inventory: 'Inventaire', transfer: 'Transfert', loss: 'Perte', repair: 'SAV',
};

/**
 * Archive de traçabilité : toute unité sérialisée (IMEI) qui a quitté le stock reste consultable
 * à vie — modèle, IMEI, coût, vente, reçu, client, vendeur et chronologie complète.
 * Rien n'est supprimé : quand la quantité tombe à 0, la fiche passe simplement ici.
 */
export default function SoldImeiArchive({ initialSearch = '' }: { initialSearch?: string }) {
  const { user, store } = useAuth();
  const [rows, setRows] = useState<ArchivedUnit[]>([]);
  const [search, setSearch] = useState(initialSearch);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [historyUnit, setHistoryUnit] = useState<ArchivedUnit | null>(null);

  const load = useCallback(async () => {
    setRows(await query<ArchivedUnit>(`
      SELECT iu.id, iu.imei1, iu.imei2, iu.serial_number, iu.lifecycle_status, iu.cost, iu.received_at, iu.sold_at,
             p.brand, p.model, pv.attributes, pv.sku,
             ls.sale_id, ls.ticket_number, ls.receipt_ref, ls.sale_date, ls.currency_code AS sale_currency,
             ls.unit_price, ls.status AS sale_status, c.name AS customer_name, u.name AS seller_name
      FROM imei_units iu
      JOIN product_variants pv ON pv.id = iu.variant_id
      JOIN products p ON p.id = pv.product_id
      LEFT JOIN LATERAL (
        SELECT sl.sale_id, sl.unit_price, s.ticket_number, s.receipt_ref, s.sale_date, s.currency_code, s.status, s.customer_id, s.user_id
        FROM sale_lines sl JOIN sales s ON s.id = sl.sale_id
        WHERE sl.imei_unit_id = iu.id AND s.status <> 'cancelled'
        ORDER BY s.sale_date DESC LIMIT 1
      ) ls ON true
      LEFT JOIN customers c ON c.id = ls.customer_id
      LEFT JOIN users u ON u.id = ls.user_id
      WHERE iu.lifecycle_status IN ('sold','returned','repair','traded_in','retired')
      ORDER BY COALESCE(iu.sold_at, iu.received_at) DESC
      LIMIT 500`));
  }, []);
  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase().replace(/\s/g, '');
    if (!needle) return rows;
    return rows.filter((r) => [r.imei1, r.imei2, r.serial_number, r.brand + r.model, r.ticket_number, r.receipt_ref, r.customer_name, r.seller_name, r.sku]
      .some((v) => String(v ?? '').toLowerCase().replace(/\s/g, '').includes(needle)));
  }, [rows, search]);

  if (!user || !store) return null;
  const showCost = canSeeMargin(user.role);
  const attrs = (r: ArchivedUnit) => {
    const a = typeof r.attributes === 'string' ? (JSON.parse(r.attributes || '{}') as Record<string, string>) : r.attributes;
    return Object.values(a ?? {}).join(' · ');
  };

  return (
    <div>
      <div className="mb-3 flex items-start gap-2 rounded-xl border border-primary-100 bg-primary-50 p-3 text-sm text-primary-800">
        <Archive className="mt-0.5 h-4 w-4 shrink-0" />
        <p>Les téléphones vendus (quantité 0) ne disparaissent jamais : ils sont archivés ici avec leur IMEI, leur vente, leur reçu et leur historique complet.</p>
      </div>

      <div className="relative mb-3 max-w-xl">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input className="input pl-9 font-mono" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="IMEI, modèle, n° reçu, client, vendeur…" aria-label="Rechercher dans l’archive des IMEI" inputMode="search" />
      </div>
      <p className="mb-2 text-xs text-slate-500">{filtered.length} unité(s) archivée(s)</p>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr>
              <th className="px-4 py-2.5 text-left">Appareil</th>
              <th className="px-4 py-2.5 text-left">IMEI</th>
              <th className="px-4 py-2.5 text-left">Statut</th>
              <th className="px-4 py-2.5 text-left">Vente</th>
              <th className="px-4 py-2.5 text-left">Client / vendeur</th>
              <th className="px-4 py-2.5 text-right">Prix</th>
              <th className="px-4 py-2.5 text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const cur = r.sale_currency || store.currency;
              return (
                <tr key={r.id}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2"><Smartphone className="h-4 w-4 text-slate-400" />
                      <div><p className="font-medium text-slate-800">{r.brand} {r.model}</p><p className="text-xs text-slate-400">{attrs(r)}</p></div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-700">{r.imei1}{r.imei2 && <span className="block text-slate-400">{r.imei2}</span>}</td>
                  <td className="px-4 py-2.5"><span className={r.lifecycle_status === 'sold' ? 'badge-slate' : 'badge-warning'}>{lifecycleLabel(r.lifecycle_status)}</span>
                    <p className="mt-0.5 text-[11px] text-slate-400">{r.sold_at ? formatDateTime(r.sold_at) : ''}</p></td>
                  <td className="px-4 py-2.5 text-xs">{r.ticket_number ? <><span className="font-mono text-slate-700">{r.ticket_number}</span>{r.receipt_ref && <span className="block font-mono text-[10px] text-slate-400">{r.receipt_ref}</span>}</> : <span className="text-slate-400">—</span>}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-600">{r.customer_name || (r.sale_id ? 'Client de passage' : '—')}<span className="block text-slate-400">{r.seller_name || ''}</span></td>
                  <td className="px-4 py-2.5 text-right font-medium text-slate-800">
                    {r.unit_price != null ? formatCurrency(r.unit_price, cur, cur === 'CDF' ? 0 : 2) : '—'}
                    {showCost && <span className="block text-[11px] font-normal text-slate-400">coût {formatCurrency(r.cost, store.currency, store.currency_decimals)}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <div className="flex justify-center gap-1">
                      {r.sale_id && <button title="Voir le reçu" aria-label="Voir le reçu" onClick={() => setReceiptId(r.sale_id)} className="p-1 text-slate-400 hover:text-primary-600"><FileText className="h-4 w-4" /></button>}
                      <button title="Historique de l’unité" aria-label="Historique de l’unité" onClick={() => setHistoryUnit(r)} className="p-1 text-slate-400 hover:text-primary-600"><History className="h-4 w-4" /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="p-8 text-center text-sm text-slate-400">Aucun article archivé pour le moment.</div>}
      </div>

      {receiptId && <TicketModal saleId={receiptId} mode="view" onClose={() => setReceiptId(null)} />}
      {historyUnit && <UnitHistoryModal unit={historyUnit} onClose={() => setHistoryUnit(null)} />}
    </div>
  );
}

function UnitHistoryModal({ unit, onClose }: { unit: ArchivedUnit; onClose: () => void }) {
  const [events, setEvents] = useState<TimelineRow[]>([]);
  useEffect(() => {
    void query<TimelineRow>(
      `SELECT sm.id, sm.created_at, sm.movement_type, sm.direction, sm.reason, u.name AS user_name
       FROM stock_movements sm LEFT JOIN users u ON u.id = sm.user_id
       WHERE sm.imei_unit_id = $1 ORDER BY sm.created_at ASC`, [unit.id]).then(setEvents);
  }, [unit.id]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-fade-in" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white shadow-2xl animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white p-4">
          <div><h2 className="text-lg font-semibold text-slate-800">Historique de l’unité</h2><p className="font-mono text-xs text-slate-500">{unit.brand} {unit.model} · {unit.imei1}</p></div>
          <button onClick={onClose} aria-label="Fermer"><X className="h-5 w-5 text-slate-400" /></button>
        </div>
        <ol className="space-y-3 p-4">
          <li className="text-sm"><span className="font-semibold text-slate-700">Reçu en stock</span><span className="block text-xs text-slate-500">{formatDateTime(unit.received_at)}</span></li>
          {events.map((e) => (
            <li key={e.id} className="border-l-2 border-primary-300 pl-3 text-sm">
              <span className="font-semibold text-slate-700">{MOVEMENT_LABEL[e.movement_type] ?? e.movement_type}</span> <span className="text-xs text-slate-400">({e.direction === 'in' ? 'entrée' : 'sortie'})</span>
              <span className="block text-xs text-slate-500">{formatDateTime(e.created_at)}{e.user_name ? ` · ${e.user_name}` : ''}</span>
              {e.reason && <span className="block text-xs text-slate-400">{e.reason}</span>}
            </li>
          ))}
          {events.length === 0 && <li className="text-xs text-slate-400">Aucun mouvement détaillé enregistré.</li>}
        </ol>
      </div>
    </div>
  );
}
