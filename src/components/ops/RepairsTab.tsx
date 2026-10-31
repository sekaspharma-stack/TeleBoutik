import { useCallback, useEffect, useState } from 'react';
import { Camera, Plus } from 'lucide-react';
import { query, execute, now } from '../../db/localDb';
import { findActiveWarrantyByImei, recordRepair } from '../../db/operations';
import CameraScanner from '../CameraScanner';
import { errMsg, money, todayIso } from './types';
import type { OpsTabProps } from './types';

type Repair = { id: string; imei: string; problem: string; status: string; received_at: string; diagnosis: string; repair_action: string; technician: string; parts_cost: number; labor_cost: number; customer_name: string | null };
const STATUS: Record<string, { label: string; cls: string }> = {
  received: { label: 'Reçu', cls: 'bg-slate-100 text-slate-700' },
  in_progress: { label: 'En cours', cls: 'bg-amber-100 text-amber-800' },
  ready: { label: 'Prêt', cls: 'bg-emerald-100 text-emerald-800' },
  returned: { label: 'Rendu', cls: 'bg-blue-100 text-blue-800' },
};
const EMPTY = { imei: '', problem: '', diagnosis: '', repair_action: '', technician: '', customer_id: '', parts: '', labor: '' };

export default function RepairsTab({ store, user, customers, notify, fail }: OpsTabProps) {
  const [rows, setRows] = useState<Repair[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [scan, setScan] = useState(false);
  const [warranty, setWarranty] = useState<{ end_date: string; customer_name: string | null } | null>(null);
  const [filter, setFilter] = useState<'open' | 'all'>('open');

  const load = useCallback(async () => {
    try {
      setRows(await query<Repair>(
        `SELECT r.id, r.imei, r.problem, r.status, r.received_at, r.diagnosis, r.repair_action, r.technician, r.parts_cost, r.labor_cost, c.name AS customer_name
         FROM repair_records r LEFT JOIN customers c ON c.id = r.customer_id WHERE r.store_id=$1 ORDER BY r.received_at DESC LIMIT 150`, [store.id]));
    } catch (e) { fail(errMsg(e, 'Chargement du SAV impossible.')); }
  }, [store.id, fail]);
  useEffect(() => { void load(); }, [load]);

  // Vérifie automatiquement si l'IMEI saisi est sous garantie.
  useEffect(() => {
    let alive = true;
    const imei = form.imei.trim();
    if (imei.length < 8) { setWarranty(null); return; }
    findActiveWarrantyByImei(store.id, imei, todayIso()).then(w => { if (alive) setWarranty(w); }).catch(() => { if (alive) setWarranty(null); });
    return () => { alive = false; };
  }, [form.imei, store.id]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const parts = Number(form.parts || 0), labor = Number(form.labor || 0);
      if (parts < 0 || labor < 0 || !Number.isFinite(parts) || !Number.isFinite(labor)) throw new Error('Les coûts doivent être positifs.');
      await recordRepair({ storeId: store.id, imei: form.imei, customerId: form.customer_id || null, problem: form.problem, diagnosis: form.diagnosis, repairAction: form.repair_action, technician: form.technician, partsCost: parts, laborCost: labor, createdBy: user.id });
      setForm(EMPTY); notify('Dossier SAV créé.'); await load();
    } catch (err) { fail(errMsg(err, 'Échec SAV.')); }
  };

  const setStatus = async (id: string, status: string) => {
    try {
      if (status === 'returned') await execute('UPDATE repair_records SET status=$1, returned_at=$2 WHERE id=$3', [status, now(), id]);
      else await execute('UPDATE repair_records SET status=$1 WHERE id=$2', [status, id]);
      await load();
    } catch (err) { fail(errMsg(err, 'Mise à jour impossible.')); }
  };

  const shown = rows.filter(r => filter === 'all' || r.status !== 'returned');

  return (
    <section className="grid gap-4 xl:grid-cols-2">
      <form className="card space-y-3 p-4" onSubmit={e => void submit(e)}>
        <h2 className="font-semibold">Nouveau dossier SAV</h2>
        <label className="label">IMEI *</label>
        <div className="flex gap-2">
          <input required className="input flex-1" inputMode="numeric" value={form.imei} onChange={e => setForm(f => ({ ...f, imei: e.target.value }))} />
          <button type="button" className="btn-secondary" aria-label="Scanner l’IMEI" onClick={() => setScan(true)}><Camera className="h-4 w-4" /></button>
        </div>
        {scan && <CameraScanner onDetected={v => { setScan(false); setForm(f => ({ ...f, imei: v })); }} onClose={() => setScan(false)} />}
        {form.imei.trim().length >= 8 && (
          warranty
            ? <p role="status" className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800">Sous garantie jusqu’au {warranty.end_date}{warranty.customer_name ? ` (${warranty.customer_name})` : ''} : réparation gratuite pour le client.</p>
            : <p className="rounded-lg bg-slate-50 p-2 text-sm text-slate-600">Aucune garantie valide trouvée pour cet IMEI.</p>
        )}
        <label className="label">Client</label>
        <select className="input" value={form.customer_id} onChange={e => setForm(f => ({ ...f, customer_id: e.target.value }))}>
          <option value="">Non renseigné</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label className="label">Panne signalée *</label>
        <textarea required className="input" value={form.problem} onChange={e => setForm(f => ({ ...f, problem: e.target.value }))} />
        <label className="label">Diagnostic</label>
        <textarea className="input" value={form.diagnosis} onChange={e => setForm(f => ({ ...f, diagnosis: e.target.value }))} />
        <label className="label">Réparation effectuée</label>
        <textarea className="input" value={form.repair_action} onChange={e => setForm(f => ({ ...f, repair_action: e.target.value }))} />
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label">Pièces ({store.currency})</label><input type="number" min="0" className="input" value={form.parts} onChange={e => setForm(f => ({ ...f, parts: e.target.value }))} /></div>
          <div><label className="label">Main d’œuvre ({store.currency})</label><input type="number" min="0" className="input" value={form.labor} onChange={e => setForm(f => ({ ...f, labor: e.target.value }))} /></div>
        </div>
        <label className="label">Technicien</label>
        <input className="input" value={form.technician} onChange={e => setForm(f => ({ ...f, technician: e.target.value }))} />
        <button className="btn-primary" type="submit"><Plus className="h-4 w-4" />Créer le dossier</button>
      </form>

      <div className="card space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">Dossiers SAV ({shown.length})</h2>
          <div className="flex gap-2"><button className={filter === 'open' ? 'btn-primary' : 'btn-secondary'} onClick={() => setFilter('open')}>Ouverts</button><button className={filter === 'all' ? 'btn-primary' : 'btn-secondary'} onClick={() => setFilter('all')}>Tous</button></div>
        </div>
        {shown.length === 0 && <p className="text-sm text-slate-500">Aucun dossier.</p>}
        {shown.map(r => {
          const st = STATUS[r.status] ?? STATUS.received;
          const total = Number(r.parts_cost) + Number(r.labor_cost);
          return (
            <div key={r.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-start justify-between gap-2"><b>{r.imei}</b><span className={`rounded px-2 py-0.5 text-xs font-semibold ${st.cls}`}>{st.label}</span></div>
              <p className="text-sm">{r.problem}</p>
              <p className="text-xs text-slate-500">{r.customer_name || 'Client non renseigné'} · reçu le {new Date(r.received_at).toLocaleDateString('fr-FR')} · {r.technician || 'sans technicien'}</p>
              {r.diagnosis && <p className="text-sm">Diagnostic : {r.diagnosis}</p>}
              {r.repair_action && <p className="text-sm">Action : {r.repair_action}</p>}
              {total > 0 && <p className="text-xs text-slate-600">Coût : {money(total, store.currency)}</p>}
              {r.status !== 'returned' && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {r.status === 'received' && <button className="btn-secondary" onClick={() => void setStatus(r.id, 'in_progress')}>Démarrer</button>}
                  {(r.status === 'received' || r.status === 'in_progress') && <button className="btn-secondary" onClick={() => void setStatus(r.id, 'ready')}>Prêt</button>}
                  <button className="btn-secondary" onClick={() => void setStatus(r.id, 'returned')}>Rendu au client</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
