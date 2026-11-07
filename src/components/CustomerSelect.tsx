import { useEffect, useRef, useState } from 'react';
import { Search, UserCheck, UserPlus, X, Phone } from 'lucide-react';
import { query, execute, generateId, now } from '../db/localDb';
import { addAuditLog } from '../db/audit';
import { useAuth } from '../context/AuthContext';
import LoadingButton from './LoadingButton';
import type { Customer } from '../types';

export interface SelectedCustomer { id: string | null; name: string; phone: string }

/**
 * Recherche et récupération d'un client déjà enregistré (nom ou téléphone).
 * - au focus : les clients récents s'affichent directement ;
 * - à la frappe : recherche instantanée dans la base locale (fonctionne hors ligne) ;
 * - si personne ne correspond : bouton « Enregistrer ce client » pour l'ajouter à la base.
 */
export default function CustomerSelect({ value, onSelect, phoneHint = '', label = 'Client enregistré' }: {
  value: SelectedCustomer | null;
  onSelect: (customer: SelectedCustomer | null) => void;
  /** Numéro saisi dans le formulaire : sert à proposer la création rapide. */
  phoneHint?: string;
  label?: string;
}) {
  const { user, store } = useAuth();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<Customer[]>([]);
  const [message, setMessage] = useState('');
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(async () => {
      const needle = term.trim().toLowerCase();
      const rows = needle
        ? await query<Customer>('SELECT * FROM customers WHERE LOWER(name) LIKE $1 OR REPLACE(phone, \' \', \'\') LIKE $2 ORDER BY name LIMIT 8', [`%${needle}%`, `%${needle.replace(/\s/g, '')}%`])
        : await query<Customer>('SELECT * FROM customers ORDER BY created_at DESC LIMIT 6');
      setResults(rows);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [term, open]);

  useEffect(() => {
    const close = (event: MouseEvent) => { if (box.current && !box.current.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const pick = (customer: Customer) => {
    onSelect({ id: customer.id, name: customer.name, phone: customer.phone });
    setOpen(false); setTerm(''); setMessage('');
  };

  const canCreate = term.trim().length >= 2 || phoneHint.trim().length >= 7;
  const createFromInput = async () => {
    if (!user || !store) return;
    const typed = term.trim();
    const looksLikePhone = /^[+0-9][0-9\s()-]{6,}$/.test(typed);
    const phone = looksLikePhone ? typed : phoneHint.trim();
    const name = looksLikePhone ? '' : typed;
    if (!name && !phone) { setMessage('Saisis un nom ou un numéro.'); return; }
    if (phone) {
      const dup = await query<Customer>('SELECT * FROM customers WHERE REPLACE(phone, \' \', \'\') = $1 LIMIT 1', [phone.replace(/\s/g, '')]);
      if (dup[0]) { pick(dup[0]); setMessage('Ce numéro existait déjà : client récupéré.'); return; }
    }
    const id = generateId();
    const finalName = name || phone;
    await execute('INSERT INTO customers (id, name, phone, credit_limit, outstanding_balance, created_at) VALUES ($1,$2,$3,$4,0,$5)', [id, finalName, phone, store.credit_limit_default, now()]);
    await addAuditLog(user, 'customer', 'create', null, { id, name: finalName, phone, source: 'shop' });
    onSelect({ id, name: finalName, phone });
    setOpen(false); setTerm(''); setMessage('Nouveau client enregistré.');
  };

  return (
    <div ref={box} className="relative md:col-span-2">
      <span className="label">{label}</span>
      {value?.id ? (
        <div className="flex items-center justify-between gap-2 rounded-[10px] border border-success-500/40 bg-success-50 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <UserCheck className="h-4 w-4 shrink-0 text-success-600" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-800">{value.name}</p>
              <p className="flex items-center gap-1 text-xs text-slate-500"><Phone className="h-3 w-3" />{value.phone || 'Sans numéro'}</p>
            </div>
          </div>
          <button type="button" onClick={() => onSelect(null)} className="grid h-8 w-8 place-items-center" aria-label="Retirer le client sélectionné"><X className="h-4 w-4 text-slate-500" /></button>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-9"
              value={term}
              onFocus={() => setOpen(true)}
              onChange={(e) => { setTerm(e.target.value); setOpen(true); setMessage(''); }}
              placeholder="Rechercher un client par nom ou téléphone…"
              autoComplete="off"
              role="combobox"
              aria-expanded={open}
              aria-label="Rechercher un client enregistré"
            />
          </div>
          {open && (
            <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl" role="listbox">
              {results.map((c) => (
                <button type="button" role="option" aria-selected="false" key={c.id} onClick={() => pick(c)} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-primary-50">
                  <span className="min-w-0 truncate font-medium text-slate-800">{c.name}</span>
                  <span className="shrink-0 text-xs text-slate-500">{c.phone || '—'}</span>
                </button>
              ))}
              {results.length === 0 && <p className="px-3 py-3 text-sm text-slate-500">{term ? 'Aucun client trouvé.' : 'Aucun client enregistré pour le moment.'}</p>}
              {canCreate && (
                <div className="border-t border-slate-100 p-2">
                  <LoadingButton className="btn-secondary w-full !min-h-9 !py-1.5 text-xs" onClick={createFromInput} loadingText="Enregistrement…">
                    <UserPlus className="h-4 w-4" /> Enregistrer {term.trim() ? `« ${term.trim()} »` : 'ce numéro'} comme nouveau client
                  </LoadingButton>
                </div>
              )}
            </div>
          )}
        </>
      )}
      {message && <p className="mt-1 text-xs text-slate-500" role="status">{message}</p>}
    </div>
  );
}
