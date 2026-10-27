import { useState, useEffect, useCallback } from 'react';
import { Users, Search, Plus, X, Phone, Wallet } from 'lucide-react';
import { query, execute, generateId, now } from '../db/localDb';
import { addAuditLog } from '../db/audit';
import { useAuth } from '../context/AuthContext';
import { formatCurrency } from '../lib/utils';
import type { Customer } from '../types';

export default function CustomersPage() {
  const { user, store } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    setCustomers(await query<Customer>('SELECT * FROM customers ORDER BY name'));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!user || !store) return null;
  const currency = store.currency;
  const decimals = store.currency_decimals;

  const filtered = customers.filter((c) => {
    if (!search) return true;
    return c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search);
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Users className="w-6 h-6 text-primary-600" /> Clients
          </h1>
          <p className="text-sm text-slate-500">{customers.length} clients enregistrés</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary">
          <Plus className="w-4 h-4" /> Nouveau client
        </button>
      </div>

      <div className="mb-4 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Nom ou téléphone..."
          className="input pl-9 max-w-md"
        />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[500px]">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium text-slate-600">Nom</th>
              <th className="text-left px-4 py-2.5 font-medium text-slate-600">Téléphone</th>
              <th className="text-right px-4 py-2.5 font-medium text-slate-600">Limite crédit</th>
              <th className="text-right px-4 py-2.5 font-medium text-slate-600">Solde dû</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-4 py-2.5 font-medium text-slate-800">{c.name}</td>
                <td className="px-4 py-2.5 text-slate-500 flex items-center gap-1">
                  <Phone className="w-3.5 h-3.5" /> {c.phone || '—'}
                </td>
                <td className="px-4 py-2.5 text-right text-slate-600">{formatCurrency(c.credit_limit, currency, decimals)}</td>
                <td className="px-4 py-2.5 text-right">
                  {c.outstanding_balance > 0 ? (
                    <span className="font-medium text-error-600 flex items-center justify-end gap-1">
                      <Wallet className="w-3.5 h-3.5" /> {formatCurrency(c.outstanding_balance, currency, decimals)}
                    </span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="p-8 text-center text-slate-400 text-sm">
            <Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
            Aucun client
          </div>
        )}
      </div>

      {showAdd && (
        <AddCustomerModal
          onSaved={() => { setShowAdd(false); load(); }}
          onClose={() => setShowAdd(false)}
          currentUser={user}
          defaultCreditLimit={store.credit_limit_default}
        />
      )}
    </div>
  );
}

function AddCustomerModal({ onSaved, onClose, currentUser, defaultCreditLimit }: { onSaved: () => void; onClose: () => void; currentUser: import('../types').User; defaultCreditLimit: number }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [creditLimit, setCreditLimit] = useState(defaultCreditLimit.toString());

  const handleSave = async () => {
    if (!name) return;
    await execute(
      'INSERT INTO customers (id, name, phone, credit_limit, outstanding_balance, created_at) VALUES ($1, $2, $3, $4, 0, $5)',
      [generateId(), name, phone, parseFloat(creditLimit) || defaultCreditLimit, now()]
    );
    await addAuditLog(currentUser, 'customer', 'create', null, { name, phone });
    onSaved();
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">Nouveau client</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="label">Nom (requis)</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="Moussa Diallo" />
          </div>
          <div>
            <label className="label">Téléphone</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className="input" placeholder="+225 07 00 00 00" />
          </div>
          <div>
            <label className="label">Limite de crédit</label>
            <input type="number" value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} className="input" />
          </div>
          <button onClick={handleSave} disabled={!name} className="btn-primary w-full">Enregistrer</button>
        </div>
      </div>
    </div>
  );
}
