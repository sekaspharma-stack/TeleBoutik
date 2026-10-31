import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { createWarranty, getSaleImeis, listRecentSales, listWarranties, setWarrantyStatus } from '../../db/operations';
import type { SaleImeiOption, SaleOption, WarrantyListRow } from '../../db/operations';
import { errMsg, todayIso } from './types';
import type { OpsTabProps } from './types';

type Filter = 'all' | 'active' | 'soon' | 'expired';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Toutes' }, { id: 'active', label: 'En cours' }, { id: 'soon', label: 'Expirent ≤ 30 j' }, { id: 'expired', label: 'Expirées' },
];

function daysLeft(end: string): number {
  return Math.ceil((new Date(`${end}T23:59:59`).getTime() - Date.now()) / 86400000);
}

function stateOf(w: WarrantyListRow): { key: 'active' | 'soon' | 'expired' | 'claimed' | 'void'; label: string; cls: string } {
  if (w.status === 'void') return { key: 'void', label: 'Annulée', cls: 'bg-slate-100 text-slate-600' };
  if (w.status === 'claimed') return { key: 'claimed', label: 'Réclamée', cls: 'bg-blue-100 text-blue-800' };
  const d = daysLeft(w.end_date);
  if (d < 0) return { key: 'expired', label: 'Expirée', cls: 'bg-red-100 text-red-800' };
  if (d <= 30) return { key: 'soon', label: `Expire dans ${d} j`, cls: 'bg-amber-100 text-amber-800' };
  return { key: 'active', label: `Valide (${d} j)`, cls: 'bg-emerald-100 text-emerald-800' };
}

export default function WarrantyTab({ store, user, customers, notify, fail }: OpsTabProps) {
  const [sales, setSales] = useState<SaleOption[]>([]);
  const [rows, setRows] = useState<WarrantyListRow[]>([]);
  const [imeis, setImeis] = useState<SaleImeiOption[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ sale_id: '', imei_unit_id: '', customer_id: '', start_date: todayIso(), months: '12', terms: '' });

  const load = useCallback(async () => {
    try { const [s, w] = await Promise.all([listRecentSales(store.id), listWarranties(store.id)]); setSales(s); setRows(w); }
    catch (e) { fail(errMsg(e, 'Chargement des garanties impossible.')); }
  }, [store.id, fail]);
  useEffect(() => { void load(); }, [load]);

  const pickSale = async (saleId: string) => {
    const sale = sales.find(s => s.id === saleId);
    setForm(f => ({ ...f, sale_id: saleId, imei_unit_id: '', customer_id: sale?.customer_id ?? f.customer_id }));
    setImeis([]);
    if (saleId) { try { const list = await getSaleImeis(saleId); setImeis(list); if (list.length === 1) setForm(f => ({ ...f, imei_unit_id: list[0].imei_unit_id })); } catch (e) { fail(errMsg(e, 'IMEI de la vente introuvables.')); } }
  };

  const submit = async () => {
    try {
      if (!form.sale_id) throw new Error('Choisis la vente concernée.');
      const months = Number(form.months);
      const line = imeis.find(i => i.imei_unit_id === form.imei_unit_id);
      await createWarranty({ storeId: store.id, saleId: form.sale_id, saleLineId: line?.sale_line_id ?? null, imeiUnitId: form.imei_unit_id || null, customerId: form.customer_id || null, startDate: form.start_date, durationMonths: months, terms: form.terms, createdBy: user.id });
      notify('Garantie enregistrée.');
      setForm(f => ({ ...f, sale_id: '', imei_unit_id: '', terms: '' })); setImeis([]);
      await load();
    } catch (e) { fail(errMsg(e, 'Échec de création.')); }
  };

  const change = async (id: string, status: 'active' | 'claimed' | 'void') => {
    try { await setWarrantyStatus(id, status); await load(); } catch (e) { fail(errMsg(e, 'Mise à jour impossible.')); }
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(w => {
      const st = stateOf(w).key;
      if (filter === 'active' && !(st === 'active' || st === 'soon')) return false;
      if (filter === 'soon' && st !== 'soon') return false;
      if (filter === 'expired' && st !== 'expired') return false;
      if (!q) return true;
      return [w.imei1, w.customer_name, w.ticket_number, w.phone].some(v => (v ?? '').toLowerCase().includes(q));
    });
  }, [rows, filter, search]);

  return (
    <section className="grid gap-4 xl:grid-cols-2">
      <div className="card space-y-3 p-4">
        <h2 className="font-semibold">Enregistrer une garantie</h2>
        <label className="label">Vente *</label>
        <select className="input" value={form.sale_id} onChange={e => void pickSale(e.target.value)}>
          <option value="">Choisir une vente récente</option>
          {sales.map(s => <option key={s.id} value={s.id}>{s.ticket_number} · {new Date(s.sale_date).toLocaleDateString('fr-FR')}{s.customer_name ? ` · ${s.customer_name}` : ''}</option>)}
        </select>
        {form.sale_id && (
          <>
            <label className="label">Téléphone (IMEI)</label>
            <select className="input" value={form.imei_unit_id} onChange={e => setForm(f => ({ ...f, imei_unit_id: e.target.value }))}>
              <option value="">{imeis.length === 0 ? 'Aucun IMEI sur cette vente' : 'Choisir l’IMEI'}</option>
              {imeis.map(i => <option key={i.imei_unit_id} value={i.imei_unit_id}>{i.product_name} — {i.imei1}</option>)}
            </select>
          </>
        )}
        <label className="label">Client</label>
        <select className="input" value={form.customer_id} onChange={e => setForm(f => ({ ...f, customer_id: e.target.value }))}>
          <option value="">Non renseigné</option>
          {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label">Début</label><input className="input" type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} /></div>
          <div><label className="label">Durée (mois)</label><input className="input" type="number" min="0" max="120" value={form.months} onChange={e => setForm(f => ({ ...f, months: e.target.value }))} /></div>
        </div>
        <label className="label">Conditions</label>
        <textarea className="input" value={form.terms} onChange={e => setForm(f => ({ ...f, terms: e.target.value }))} />
        <button className="btn-primary" onClick={() => void submit()}><Plus className="h-4 w-4" />Ajouter la garantie</button>
      </div>

      <div className="card space-y-3 p-4">
        <h2 className="font-semibold">Garanties ({visible.length})</h2>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Rechercher IMEI, client, ticket, téléphone" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-2">{FILTERS.map(f => <button key={f.id} onClick={() => setFilter(f.id)} className={filter === f.id ? 'btn-primary' : 'btn-secondary'}>{f.label}</button>)}</div>
        {visible.length === 0 ? <p className="text-sm text-slate-500">Aucune garantie.</p> : (
          <div className="space-y-2">
            {visible.map(w => {
              const st = stateOf(w);
              return (
                <div key={w.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-2"><b>{w.customer_name || 'Client non renseigné'}</b><span className={`rounded px-2 py-0.5 text-xs font-semibold ${st.cls}`}>{st.label}</span></div>
                  <p className="text-sm">IMEI : {w.imei1 || 'non associé'} · Ticket : {w.ticket_number || '—'}</p>
                  <p className="text-xs text-slate-500">Du {w.start_date} au {w.end_date} ({w.duration_months} mois)</p>
                  {w.terms && <p className="text-xs text-slate-600">{w.terms}</p>}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {w.status === 'active' && <button className="btn-secondary" onClick={() => void change(w.id, 'claimed')}>Marquer réclamée</button>}
                    {w.status === 'active' && <button className="btn-secondary" onClick={() => { if (window.confirm('Annuler cette garantie ?')) void change(w.id, 'void'); }}>Annuler</button>}
                    {w.status !== 'active' && <button className="btn-secondary" onClick={() => void change(w.id, 'active')}>Réactiver</button>}
                    {w.phone && st.key === 'soon' && <a className="btn-secondary" target="_blank" rel="noreferrer" href={`https://wa.me/${w.phone.replace(/\D/g, '')}?text=${encodeURIComponent(`Bonjour ${w.customer_name || ''}, votre garantie chez ${store.name} expire le ${w.end_date}.`)}`}>WhatsApp</a>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
