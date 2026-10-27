import { useState } from 'react';
import { Settings as SettingsIcon, Store, Users, Coins, Receipt, Save, Plus, X, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { query, execute, generateId, now } from '../db/localDb';
import { addAuditLog } from '../db/audit';
import { hashPin } from '../lib/pin';
import { roleLabel, canManageUsers } from '../lib/utils';
import type { User, UserRole, Store as StoreType } from '../types';

export default function SettingsPage() {
  const { user, store, updateStore } = useAuth();
  const [tab, setTab] = useState<'store' | 'users' | 'finance'>('store');
  const [users, setUsers] = useState<User[]>([]);
  const [showAddUser, setShowAddUser] = useState(false);

  if (!user || !store) return null;
  const canManage = canManageUsers(user.role);

  const loadUsers = async () => {
    setUsers(await query<User>('SELECT * FROM users ORDER BY created_at'));
  };

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
          <SettingsIcon className="w-6 h-6 text-primary-600" />
          Paramètres
        </h1>
      </div>

      <div className="flex gap-2 mb-4">
        <button onClick={() => setTab('store')} className={tab === 'store' ? 'btn-primary' : 'btn-secondary'}>
          <Store className="w-4 h-4" /> Boutique
        </button>
        {canManage && (
          <button onClick={() => { setTab('users'); loadUsers(); }} className={tab === 'users' ? 'btn-primary' : 'btn-secondary'}>
            <Users className="w-4 h-4" /> Utilisateurs
          </button>
        )}
        <button onClick={() => setTab('finance')} className={tab === 'finance' ? 'btn-primary' : 'btn-secondary'}>
          <Coins className="w-4 h-4" /> Finance
        </button>
      </div>

      {tab === 'store' && <StoreSettings store={store} onSave={updateStore} canEdit={canManage || user.role === 'manager'} />}
      {tab === 'users' && canManage && (
        <UsersSettings users={users} onReload={loadUsers} currentUser={user} onShowAdd={() => setShowAddUser(true)} showAdd={showAddUser} />
      )}
      {tab === 'finance' && <FinanceSettings store={store} canEdit={canManage} />}
    </div>
  );
}

function StoreSettings({ store, onSave, canEdit }: { store: StoreType; onSave: (s: StoreType) => void; canEdit: boolean }) {
  const [form, setForm] = useState(store);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    onSave(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="card p-4 space-y-3 max-w-2xl">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Nom de la boutique</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} disabled={!canEdit} className="input" />
        </div>
        <div>
          <label className="label">Téléphone</label>
          <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} disabled={!canEdit} className="input" />
        </div>
      </div>
      <div>
        <label className="label">Adresse</label>
        <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} disabled={!canEdit} className="input" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Devise</label>
          <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} disabled={!canEdit} className="input">
            <option value="XOF">XOF (FCFA)</option>
            <option value="XAF">XAF (FCFA CEMAC)</option>
            <option value="GNF">GNF (Franc guinéen)</option>
            <option value="MGA">MGA (Ariary)</option>
            <option value="USD">USD ($)</option>
            <option value="EUR">EUR (€)</option>
          </select>
        </div>
        <div>
          <label className="label">Décimales</label>
          <select value={form.currency_decimals} onChange={(e) => setForm({ ...form, currency_decimals: parseInt(e.target.value) })} disabled={!canEdit} className="input">
            <option value={0}>0 (entier)</option>
            <option value={2}>2 (centimes)</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Remise max vendeur (%)</label>
          <input type="number" value={form.max_seller_discount} onChange={(e) => setForm({ ...form, max_seller_discount: parseFloat(e.target.value) || 0 })} disabled={!canEdit} className="input" />
        </div>
        <div>
          <label className="label">Remise max gérant (%)</label>
          <input type="number" value={form.max_manager_discount} onChange={(e) => setForm({ ...form, max_manager_discount: parseFloat(e.target.value) || 0 })} disabled={!canEdit} className="input" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Limite crédit par défaut</label>
          <input type="number" value={form.credit_limit_default} onChange={(e) => setForm({ ...form, credit_limit_default: parseFloat(e.target.value) || 0 })} disabled={!canEdit} className="input" />
        </div>
        <div>
          <label className="label">Délai retour (jours)</label>
          <input type="number" value={form.return_window_days} onChange={(e) => setForm({ ...form, return_window_days: parseInt(e.target.value) || 7 })} disabled={!canEdit} className="input" />
        </div>
      </div>
      <div>
        <label className="label">Texte bas de ticket</label>
        <input value={form.footer_text} onChange={(e) => setForm({ ...form, footer_text: e.target.value })} disabled={!canEdit} className="input" />
      </div>
      <div>
        <label className="label">Largeur ticket</label>
        <select value={form.ticket_width} onChange={(e) => setForm({ ...form, ticket_width: e.target.value as '58' | '80' })} disabled={!canEdit} className="input">
          <option value="58">58 mm</option>
          <option value="80">80 mm</option>
        </select>
      </div>
      {canEdit && (
        <button onClick={handleSave} className="btn-primary">
          <Save className="w-4 h-4" /> {saved ? 'Enregistré!' : 'Enregistrer'}
        </button>
      )}
    </div>
  );
}

function UsersSettings({ users, onReload, currentUser, onShowAdd, showAdd }: { users: User[]; onReload: () => void; currentUser: User; onShowAdd: () => void; showAdd: boolean }) {
  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <p className="text-sm text-slate-500">{users.length} utilisateur(s)</p>
        <button onClick={onShowAdd} className="btn-primary">
          <Plus className="w-4 h-4" /> Ajouter
        </button>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[500px]">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-2 font-medium text-slate-600">Nom</th>
              <th className="text-left px-4 py-2 font-medium text-slate-600">Rôle</th>
              <th className="text-left px-4 py-2 font-medium text-slate-600">PIN</th>
              <th className="text-center px-4 py-2 font-medium text-slate-600">Statut</th>
              <th className="text-center px-4 py-2 font-medium text-slate-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-slate-50">
                <td className="px-4 py-2 font-medium text-slate-800">{u.name}</td>
                <td className="px-4 py-2"><span className="badge-primary">{roleLabel(u.role)}</span></td>
                <td className="px-4 py-2 font-mono text-slate-500">****</td>
                <td className="px-4 py-2 text-center">
                  <span className={u.active ? 'badge-success' : 'badge-slate'}>{u.active ? 'Actif' : 'Inactif'}</span>
                </td>
                <td className="px-4 py-2 text-center">
                  <button
                    onClick={async () => {
                      await execute('UPDATE users SET active = $1 WHERE id = $2', [!u.active, u.id]);
                      await addAuditLog(currentUser, 'user', 'toggle_active', u, { ...u, active: !u.active });
                      onReload();
                    }}
                    className="text-slate-400 hover:text-error-600 p-1"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showAdd && <AddUserModal onReload={onReload} onClose={onShowAdd} currentUser={currentUser} />}
    </div>
  );
}

function AddUserModal({ onReload, onClose, currentUser }: { onReload: () => void; onClose: () => void; currentUser: User }) {
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [role, setRole] = useState<UserRole>('seller');

  const handleSave = async () => {
    if (!name || pin.length < 4) return;
    await execute(
      'INSERT INTO users (id, name, pin, role, active, commission_rate, fixed_salary, created_at) VALUES ($1, $2, $3, $4, true, 0, 0, $5)',
      [generateId(), name, await hashPin(pin), role, now()]
    );
    await addAuditLog(currentUser, 'user', 'create', null, { name, role });
    onClose();
    onReload();
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">Nouvel utilisateur</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="label">Nom complet</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="Awa Traoré" />
          </div>
          <div>
            <label className="label">Code PIN (4-6 chiffres)</label>
            <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} maxLength={6} className="input font-mono" placeholder="1234" />
          </div>
          <div>
            <label className="label">Rôle</label>
            <select value={role} onChange={(e) => setRole(e.target.value as UserRole)} className="input">
              <option value="seller">Vendeur</option>
              <option value="manager">Gérant</option>
              <option value="owner">Propriétaire</option>
              <option value="accountant">Comptable</option>
            </select>
          </div>
          <button onClick={handleSave} disabled={!name || pin.length < 4} className="btn-primary w-full">Créer</button>
        </div>
      </div>
    </div>
  );
}

function FinanceSettings({ store, canEdit }: { store: StoreType; canEdit: boolean }) {
  const [taxEnabled, setTaxEnabled] = useState(store.tax_enabled);
  const [taxRate, setTaxRate] = useState(store.tax_rate);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    await execute('UPDATE stores SET tax_enabled = $1, tax_rate = $2 WHERE id = $3', [taxEnabled, taxRate, store.id]);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="card p-4 space-y-3 max-w-2xl">
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={taxEnabled} onChange={(e) => setTaxEnabled(e.target.checked)} disabled={!canEdit} className="w-5 h-5 rounded text-primary-600" />
          <span className="text-sm font-medium text-slate-700">Activer la TVA</span>
        </label>
      </div>
      {taxEnabled && (
        <div>
          <label className="label">Taux de TVA (%)</label>
          <input type="number" value={taxRate} onChange={(e) => setTaxRate(parseFloat(e.target.value) || 0)} disabled={!canEdit} className="input" />
        </div>
      )}
      <div className="pt-2 border-t border-slate-100">
        <p className="text-xs text-slate-400">
          Par défaut, la TVA est désactivée (régimes exonérés en Afrique francophone).
          Activez-la si votre boutique est assujettie à la TVA.
        </p>
      </div>
      {canEdit && (
        <button onClick={handleSave} className="btn-primary">
          <Save className="w-4 h-4" /> {saved ? 'Enregistré!' : 'Enregistrer'}
        </button>
      )}
    </div>
  );
}
