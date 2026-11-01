import { useCallback, useEffect, useState } from 'react';
import { Copy, PackageSearch } from 'lucide-react';
import { clearRestockSuggestion, markRestockOrdered, suggestRestock } from '../../db/operations';
import type { RestockRow } from '../../db/operations';
import { errMsg } from './types';
import type { OpsTabProps } from './types';

export default function RestockSection({ store, notify, fail }: Pick<OpsTabProps, 'store' | 'notify' | 'fail'>) {
  const [rows, setRows] = useState<RestockRow[]>([]);
  const load = useCallback(async () => {
    try { setRows(await suggestRestock(store.id)); } catch (e) { fail(errMsg(e, 'Calcul du réassort impossible.')); }
  }, [store.id, fail]);
  useEffect(() => { void load(); }, [load]);

  const open = rows.filter(r => r.status === 'open');
  const ordered = rows.filter(r => r.status === 'ordered');
  const act = async (fn: () => Promise<void>, ok: string) => { try { await fn(); notify(ok); await load(); } catch (e) { fail(errMsg(e, 'Action impossible.')); } };

  const copyList = async () => {
    const text = `Commande ${store.name}\n` + open.map(r => `- ${r.brand} ${r.model}${r.sku ? ` (${r.sku})` : ''} : ${Number(r.suggested_quantity)}`).join('\n');
    try { await navigator.clipboard.writeText(text); notify('Liste copiée : colle-la dans WhatsApp ou un message au fournisseur.'); }
    catch { window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer'); }
  };

  return (
    <div className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold"><PackageSearch className="h-5 w-5" />Réassort suggéré ({open.length})</h2>
        {open.length > 0 && <button className="btn-secondary" onClick={() => void copyList()}><Copy className="h-4 w-4" />Copier la liste</button>}
      </div>
      {open.length === 0 && <p className="text-sm text-slate-500">Aucun article sous son stock minimum.</p>}
      {open.map(r => (
        <div key={r.id} className="rounded-lg border border-slate-200 p-3">
          <div className="flex items-start justify-between gap-2"><b>{r.brand} {r.model}</b><span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">À commander : {Number(r.suggested_quantity)}</span></div>
          <p className="text-xs text-slate-500">{r.sku || 'sans SKU'} · stock {Number(r.current_stock)} / minimum {Number(r.minimum_stock)}{r.is_serialized ? ' · téléphones' : ''}</p>
          <div className="mt-2 flex gap-2">
            <button className="btn-secondary" onClick={() => void act(() => markRestockOrdered(r.id), 'Marqué comme commandé.')}>Commandé</button>
            <button className="btn-secondary" onClick={() => void act(() => clearRestockSuggestion(r.id), 'Suggestion ignorée (elle reviendra si le stock reste bas).')}>Ignorer</button>
          </div>
        </div>
      ))}
      {ordered.length > 0 && (
        <div className="border-t border-slate-100 pt-3">
          <h3 className="mb-2 text-sm font-semibold text-slate-700">Commandes en attente ({ordered.length})</h3>
          {ordered.map(r => (
            <div key={r.id} className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-slate-50 p-2 text-sm">
              <span>{r.brand} {r.model} · {Number(r.suggested_quantity)}</span>
              <button className="btn-secondary" onClick={() => void act(() => clearRestockSuggestion(r.id), 'Réception enregistrée.')}>Reçu</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
