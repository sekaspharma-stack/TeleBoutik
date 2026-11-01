import { useCallback, useEffect, useMemo, useState } from 'react';
import { MessageCircle, Plus, Smartphone } from 'lucide-react';
import { addDebtEntry, getDebtBalances, getDebtHistory, getLastReminders, logDebtReminder } from '../../db/operations';
import type { DebtLedgerRow } from '../../db/operations';
import { errMsg, money, todayIso } from './types';
import type { OpsTabProps } from './types';

type Balance = { customer_id: string; name: string; phone: string; currency_code: string; balance: number; oldest_due_date: string | null };
const key = (d: { customer_id: string; currency_code: string }) => `${d.customer_id}-${d.currency_code}`;

export default function DebtsTab({ store, user, customers, notify, fail }: OpsTabProps) {
  const [debts, setDebts] = useState<Balance[]>([]);
  const [lastReminder, setLastReminder] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ customer_id: '', amount: '', currency: 'CDF', due_date: '', reference: '', notes: '' });
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [history, setHistory] = useState<DebtLedgerRow[]>([]);
  const [payKey, setPayKey] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState('');

  const load = useCallback(async () => {
    try {
      const [d, r] = await Promise.all([getDebtBalances(store.id), getLastReminders(store.id)]);
      setDebts(d.map(x => ({ ...x, balance: Number(x.balance) })));
      setLastReminder(Object.fromEntries(r.map(x => [x.customer_id, x.last_at])));
    } catch (e) { fail(errMsg(e, 'Chargement des dettes impossible.')); }
  }, [store.id, fail]);
  useEffect(() => { void load(); }, [load]);

  const totals = useMemo(() => debts.reduce<Record<string, number>>((acc, d) => { acc[d.currency_code] = (acc[d.currency_code] ?? 0) + d.balance; return acc; }, {}), [debts]);
  const overdue = (d: Balance) => Boolean(d.oldest_due_date && d.oldest_due_date < todayIso());

  const addDebt = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (!form.customer_id) throw new Error('Choisis un client.');
      await addDebtEntry({ storeId: store.id, customerId: form.customer_id, type: 'debt', amount: Number(form.amount), currency: form.currency, dueDate: form.due_date || null, reference: form.reference, notes: form.notes, createdBy: user.id });
      setForm(f => ({ ...f, amount: '', reference: '', notes: '' })); notify('Dette enregistrée.'); await load();
    } catch (err) { fail(errMsg(err, 'Échec de l’enregistrement.')); }
  };

  const pay = async (d: Balance) => {
    try {
      const amount = Number(payAmount);
      if (!(amount > 0)) throw new Error('Saisis un montant supérieur à zéro.');
      if (amount > d.balance) throw new Error(`Le paiement dépasse le solde (${money(d.balance, d.currency_code)}).`);
      await addDebtEntry({ storeId: store.id, customerId: d.customer_id, type: 'payment', amount, currency: d.currency_code, reference: 'Paiement dette', createdBy: user.id });
      setPayKey(null); setPayAmount(''); notify(amount === d.balance ? 'Dette soldée.' : 'Paiement enregistré.'); await load();
      if (openKey === key(d)) setHistory(await getDebtHistory(store.id, d.customer_id, d.currency_code));
    } catch (err) { fail(errMsg(err, 'Échec du paiement.')); }
  };

  const toggleHistory = async (d: Balance) => {
    if (openKey === key(d)) { setOpenKey(null); return; }
    try { setHistory(await getDebtHistory(store.id, d.customer_id, d.currency_code)); setOpenKey(key(d)); } catch (err) { fail(errMsg(err, 'Historique indisponible.')); }
  };

  const remind = async (d: Balance, channel: 'whatsapp' | 'sms') => {
    if (!d.phone) { fail('Ce client n’a pas de numéro de téléphone enregistré.'); return; }
    const msg = `Bonjour ${d.name}, rappel amical : votre solde impayé chez ${store.name} est de ${money(d.balance, d.currency_code)}. Merci de nous contacter pour convenir du règlement.`;
    try { await logDebtReminder({ storeId: store.id, customerId: d.customer_id, channel, message: msg, createdBy: user.id }); void load(); } catch { /* la relance reste possible même si le journal échoue */ }
    if (channel === 'whatsapp') window.open(`https://wa.me/${d.phone.replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener,noreferrer');
    else window.location.href = `sms:${d.phone}?body=${encodeURIComponent(msg)}`;
  };

  return (
    <section className="grid gap-4 xl:grid-cols-2">
      <form className="card space-y-3 p-4" onSubmit={e => void addDebt(e)}>
        <h2 className="font-semibold">Enregistrer une dette</h2>
        <label className="label">Client *</label>
        <select required className="input" value={form.customer_id} onChange={e => setForm(f => ({ ...f, customer_id: e.target.value }))}>
          <option value="">Choisir un client</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` — ${c.phone}` : ''}</option>)}
        </select>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label">Montant *</label><input required min="1" type="number" className="input" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} /></div>
          <div><label className="label">Devise</label><select className="input" value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}><option>CDF</option><option>USD</option></select></div>
        </div>
        <label className="label">Échéance</label>
        <input type="date" className="input" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
        <label className="label">Référence vente / note</label>
        <input className="input" value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} />
        <textarea className="input" placeholder="Notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        <button className="btn-primary" type="submit"><Plus className="h-4 w-4" />Enregistrer la dette</button>
      </form>

      <div className="card space-y-3 p-4">
        <h2 className="font-semibold">Soldes à recouvrer</h2>
        {Object.keys(totals).length > 0 && <p className="rounded-lg bg-slate-50 p-2 text-sm font-semibold">Total dû : {Object.entries(totals).map(([c, v]) => money(v, c)).join(' + ')}</p>}
        {debts.length === 0 && <p className="text-sm text-slate-500">Aucune dette ouverte.</p>}
        {debts.map(d => (
          <div key={key(d)} className="rounded-lg border border-slate-200 p-3">
            <div className="flex items-start justify-between gap-2"><b>{d.name}</b><b>{money(d.balance, d.currency_code)}</b></div>
            <p className="text-xs text-slate-500">{d.phone || 'Téléphone absent'}{lastReminder[d.customer_id] ? ` · dernière relance ${new Date(lastReminder[d.customer_id]).toLocaleDateString('fr-FR')}` : ''}</p>
            {overdue(d) && <p className="mt-1 inline-block rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">En retard depuis le {d.oldest_due_date}</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              <button className="btn-secondary" onClick={() => void remind(d, 'whatsapp')}><MessageCircle className="h-4 w-4" />WhatsApp</button>
              <button className="btn-secondary" onClick={() => void remind(d, 'sms')}><Smartphone className="h-4 w-4" />SMS</button>
              <button className="btn-secondary" onClick={() => { setPayKey(payKey === key(d) ? null : key(d)); setPayAmount(''); }}>Paiement</button>
              <button className="btn-secondary" onClick={() => void toggleHistory(d)}>{openKey === key(d) ? 'Masquer' : 'Historique'}</button>
            </div>
            {payKey === key(d) && (
              <div className="mt-2 flex gap-2">
                <input type="number" min="1" max={d.balance} className="input flex-1" placeholder={`Montant reçu (${d.currency_code})`} value={payAmount} onChange={e => setPayAmount(e.target.value)} />
                <button className="btn-secondary" onClick={() => setPayAmount(String(d.balance))}>Tout</button>
                <button className="btn-primary" onClick={() => void pay(d)}>Valider</button>
              </div>
            )}
            {openKey === key(d) && (
              <ul className="mt-2 space-y-1 border-t border-slate-100 pt-2 text-xs">
                {history.map(h => (
                  <li key={h.id} className="flex justify-between gap-2">
                    <span>{new Date(h.created_at).toLocaleDateString('fr-FR')} · {h.entry_type === 'payment' ? 'Paiement' : h.entry_type === 'debt' ? 'Dette' : 'Ajustement'}{h.reference ? ` · ${h.reference}` : ''}</span>
                    <b className={h.entry_type === 'payment' ? 'text-emerald-700' : 'text-slate-800'}>{h.entry_type === 'payment' ? '−' : '+'}{money(h.amount, h.currency_code)}</b>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        <p className="text-xs text-slate-500">Les relances ouvrent WhatsApp/SMS avec un texte prêt ; l’envoi reste à confirmer par toi et est noté dans le journal des relances.</p>
      </div>
    </section>
  );
}
