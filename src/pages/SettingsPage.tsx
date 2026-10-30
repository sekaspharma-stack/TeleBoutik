import { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Store, Users, Coins, Receipt, Save, Plus, X, Trash2, Database, AlertTriangle, Download, ShieldCheck, ImagePlus, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { query, execute, generateId, now, queryOne } from '../db/localDb';
import { saveSetting, deleteSettings } from '../db/settings';
import { addAuditLog } from '../db/audit';
import { resetCloudBusinessData } from '../db/cloudReset';
import { hashPin } from '../lib/pin';
import { clearPinLock, getLockStatus, formatLockDelay, userLockKey } from '../db/pinGuard';
import { roleLabel, canManageUsers } from '../lib/utils';
import type { User, UserRole, Store as StoreType } from '../types';
import { exportEncryptedBackup, exportAuditCsv, exportDailyBusinessCsv } from '../lib/secureBackup';

export default function SettingsPage() {
  const { user, store, updateStore } = useAuth();
  const [tab, setTab] = useState<'store' | 'users' | 'finance' | 'backup'>('store');
  const [backupBusy, setBackupBusy] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [showAddUser, setShowAddUser] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);

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
        {canManage && <button onClick={() => setTab('backup')} className={tab === 'backup' ? 'btn-primary' : 'btn-secondary'}><ShieldCheck className="w-4 h-4" /> Sauvegardes</button>}
      </div>

      {tab === 'store' && <StoreSettings store={store} onSave={updateStore} canEdit={canManage || user.role === 'manager'} />}
      {tab === 'users' && canManage && (
        <UsersSettings users={users} onReload={loadUsers} currentUser={user} onShowAdd={() => setShowAddUser(true)} onCloseAdd={() => setShowAddUser(false)} showAdd={showAddUser} />
      )}
      {tab === 'finance' && <FinanceSettings store={store} canEdit={canManage} />}
      {tab === 'backup' && canManage && <div className="card p-4 max-w-2xl space-y-4"><div><h2 className="font-semibold text-slate-800">Sauvegarde chiffrée</h2><p className="text-sm text-slate-500 mt-1">Export complet des tables locales, chiffré AES‑256‑GCM avec une phrase secrète. Garde cette phrase séparément : elle ne peut pas être récupérée si tu la perds.</p></div><button className="btn-primary" disabled={backupBusy} onClick={async () => { const pass = window.prompt('Phrase secrète (12 caractères minimum). Ne la partage pas.'); if (!pass) return; setBackupBusy(true); try { await exportEncryptedBackup(pass); window.alert('Sauvegarde chiffrée téléchargée. Conserve-la hors de cet appareil.'); } catch (e) { window.alert(e instanceof Error ? e.message : 'Échec de la sauvegarde.'); } finally { setBackupBusy(false); } }}><Download className="w-4 h-4" /> {backupBusy ? 'Chiffrement…' : 'Créer une sauvegarde chiffrée'}</button><div className="border-t border-slate-200 pt-4"><h3 className="font-medium text-slate-800">Exports opérationnels</h3><p className="text-sm text-slate-500 mb-3">L’export quotidien est à déclencher/télécharger depuis cet écran. Une application navigateur hors ligne ne peut pas garantir un téléchargement automatique si elle est fermée.</p><div className="flex gap-2 flex-wrap"><button className="btn-secondary" onClick={() => void exportDailyBusinessCsv()}><Download className="w-4 h-4" /> Export ventes du jour (CSV)</button><button className="btn-secondary" onClick={() => void exportAuditCsv()}><Download className="w-4 h-4" /> Export journal d’audit (CSV)</button></div></div></div>}
      {user.role === 'owner' && <div className="card p-4 mt-5 max-w-2xl border border-red-200 space-y-3"><div className="flex items-center gap-2 text-red-700 font-semibold"><Database className="w-5 h-5" /> Réinitialisation des données cloud</div><p className="text-sm text-slate-600">Supprime les données opérationnelles hébergées dans Firestore : ventes et lignes, paiements, produits, variantes, IMEI, mouvements et suggestions de stock, clients, fournisseurs, caisse, mobile money/télécom, achats, dépenses, écritures comptables, dettes et relances, garanties, réparations, validations du gérant et métadonnées de sauvegarde. La configuration des boutiques, les comptes utilisateurs, les paramètres (dont le logo) et le journal Audit sont conservés. Les données locales de cet appareil ne sont pas effacées. Les collections nouvelles ou non encore synchronisées sont aussi vérifiées dans le cloud.</p><p className="text-xs text-amber-700 flex gap-2 items-start"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> Action irréversible dans le cloud. Vérifie ta sauvegarde avant de continuer.</p><button disabled={resetBusy} className="btn-secondary text-red-700 border-red-300 disabled:opacity-50" onClick={async () => { const answer = window.prompt('Pour confirmer, tape exactement REINITIALISER CLOUD'); if (answer !== 'REINITIALISER CLOUD') return; setResetBusy(true); try { const result = await resetCloudBusinessData(user); await addAuditLog(user, 'cloud_database', 'reset_cloud_business_data', { scope: 'cloud_business_data_only' }, { documents_deleted: result.deleted }); window.alert(`Réinitialisation cloud terminée. ${result.deleted} document(s) supprimé(s) dans ${result.collectionsChecked} collections vérifiées. Les boutiques, comptes, paramètres et le journal Audit ont été conservés. Les données locales de cet appareil restent intactes.`); } catch (error) { window.alert(error instanceof Error ? error.message : 'Échec de la réinitialisation cloud.'); } finally { setResetBusy(false); } }}>{resetBusy ? 'Réinitialisation…' : 'Réinitialiser les données cloud'}</button></div>}
    </div>
  );
}

function StoreSettings({ store, onSave, canEdit }: { store: StoreType; onSave: (s: StoreType) => Promise<void>; canEdit: boolean }) {
  const [form, setForm] = useState(store);
  const [saved, setSaved] = useState(false);
  const [logo, setLogo] = useState('');
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoMessage, setLogoMessage] = useState('');
  const [rccm, setRccm] = useState('');

  useEffect(() => {
    let active = true;
    queryOne<{ value: string }>("SELECT value FROM settings WHERE key = 'store_rccm' LIMIT 1")
      .then((row) => { if (active) setRccm(row?.value || ''); })
      .catch(() => { /* le RCCM reste vide si la lecture échoue */ });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    queryOne<{ value: string }>("SELECT value FROM settings WHERE key = 'store_logo_data_url' LIMIT 1")
      .then((row) => { if (active) setLogo(row?.value || ''); })
      .catch(() => { if (active) setLogoMessage('Impossible de charger le logo enregistré.'); });
    return () => { active = false; };
  }, []);

  const handleLogoFile = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setLogoMessage('Choisis un fichier image.'); return; }
    if (file.size > 8 * 1024 * 1024) { setLogoMessage('Image trop lourde (maximum 8 Mo).'); return; }
    const reader = new FileReader();
    reader.onerror = () => setLogoMessage('Lecture de l’image impossible.');
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => setLogoMessage('Cette image ne peut pas être décodée.');
      image.onload = () => {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, 512 / Math.max(image.width, image.height));
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext('2d');
        if (!context) { setLogoMessage('Conversion de l’image impossible.'); return; }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        setLogo(canvas.toDataURL('image/png'));
        setLogoMessage('Logo prêt. Appuie sur Enregistrer le logo.');
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const saveLogo = async () => {
    setLogoBusy(true);
    try {
      // Identifiant fixe « setting:store_logo_data_url » : le même sur tous les appareils (pas de doublon cloud).
      await saveSetting('store_logo_data_url', logo);
      window.dispatchEvent(new CustomEvent('teleboutik:store-logo-updated', { detail: logo }));
      setLogoMessage(logo ? 'Logo enregistré sur cet appareil. Synchronisation cloud mise en file ; laisse la connexion active quelques instants.' : 'Logo retiré sur cet appareil. Suppression synchronisée avec le cloud en attente.');
    } catch (error) { setLogoMessage(error instanceof Error ? error.message : 'Enregistrement du logo impossible.'); }
    finally { setLogoBusy(false); }
  };

  const handleSave = async () => {
    try {
      await onSave(form);
      // RCCM : stocké dans la table settings (clé store_rccm), synchronisé comme le logo.
      const value = rccm.trim();
      await saveSetting('store_rccm', value);
      setSaved(true); window.setTimeout(() => setSaved(false), 2000);
    }
    catch (error) { window.alert(error instanceof Error ? error.message : 'Enregistrement impossible.'); }
  };

  return (
    <div className="card p-4 space-y-4 max-w-2xl">
      <section className="rounded-xl border border-slate-200 p-4 space-y-3">
        <div><h2 className="font-semibold text-slate-800 flex items-center gap-2"><ImagePlus className="w-5 h-5 text-primary-600" /> Logo de la boutique</h2><p className="mt-1 text-sm text-slate-500">Ce logo remplace l’icône de boutique à côté du nom TeleBoutik dans le menu et l’en-tête mobile. Image optimisée à 512 px maximum.</p></div>
        <div className="flex items-center gap-4">
          <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">{logo ? <img src={logo} alt="Aperçu du logo" className="h-full w-full object-contain" /> : <Store className="h-8 w-8 text-slate-400" />}</div>
          <div className="space-y-2"><label className={`btn-secondary inline-flex cursor-pointer items-center gap-2 ${!canEdit ? 'pointer-events-none opacity-50' : ''}`}><ImagePlus className="h-4 w-4" /> Choisir une image<input type="file" accept="image/*" className="sr-only" disabled={!canEdit} onChange={(e) => handleLogoFile(e.target.files?.[0])} /></label><div className="text-xs text-slate-500">PNG, JPG ou WebP · 8 Mo max avant optimisation</div></div>
        </div>
        {logoMessage && <p className="text-sm text-slate-600" role="status">{logoMessage}</p>}
        {canEdit && <div className="flex flex-wrap gap-2"><button type="button" onClick={() => void saveLogo()} disabled={logoBusy} className="btn-primary"><Save className="h-4 w-4" /> {logoBusy ? 'Enregistrement…' : 'Enregistrer le logo'}</button>{logo && <button type="button" onClick={() => { setLogo(''); setLogoMessage('Logo retiré de l’aperçu. Enregistre pour confirmer.'); }} className="btn-secondary"><Trash2 className="h-4 w-4" /> Retirer</button>}</div>}
      </section>
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
      <div>
        <label className="label">RCCM (Registre du Commerce)</label>
        <input value={rccm} onChange={(e) => setRccm(e.target.value)} disabled={!canEdit} className="input" placeholder="CD/LBI/RCCM/XX-B-XXXX" autoCapitalize="characters" />
        <p className="mt-1 text-xs text-slate-500">Affiché sous le logo sur le ticket de caisse. Laisse vide pour ne rien afficher. Pense à cliquer sur « Enregistrer » en bas.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Devise</label>
          <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} disabled={!canEdit} className="input">
            <option value="CDF">CDF (Franc congolais)</option>
            <option value="USD">USD (Dollar américain)</option>
            <option value="XOF">XOF (FCFA)</option>
            <option value="XAF">XAF (FCFA CEMAC)</option>
            <option value="GNF">GNF (Franc guinéen)</option>
            <option value="MGA">MGA (Ariary)</option>
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

function UsersSettings({ users, onReload, currentUser, onShowAdd, onCloseAdd, showAdd }: { users: User[]; onReload: () => void; currentUser: User; onShowAdd: () => void; onCloseAdd: () => void; showAdd: boolean }) {
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
                      const { pin: _pin, ...auditUser } = u; // l'empreinte du PIN ne doit jamais entrer dans le journal (synchronisé vers le cloud)
                      await addAuditLog(currentUser, 'user', 'toggle_active', auditUser, { ...auditUser, active: !u.active });
                      onReload();
                    }}
                    className="text-slate-400 hover:text-error-600 p-1"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={async () => {
                      const lock = await getLockStatus(userLockKey(u.id));
                      if (!lock.locked) { window.alert(`${u.name} n’est pas bloqué.`); return; }
                      if (!window.confirm(`${u.name} est bloqué pour encore ${formatLockDelay(lock.retryAfterMs)}. Débloquer maintenant ?`)) return;
                      await clearPinLock(userLockKey(u.id));
                      await addAuditLog(currentUser, 'user', 'unlock', { id: u.id, name: u.name }, null);
                      onReload();
                    }}
                    className="ml-1 text-xs text-slate-400 hover:text-primary-700 p-1"
                    title="Débloquer ce compte après trop d’essais de PIN"
                  >
                    Débloquer
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showAdd && <AddUserModal onReload={onReload} onClose={onCloseAdd} currentUser={currentUser} />}
    </div>
  );
}

function AddUserModal({ onReload, onClose, currentUser }: { onReload: () => void; onClose: () => void; currentUser: User }) {
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [role, setRole] = useState<UserRole>('seller');

  const handleSave = async () => {
    if (!name || pin.length !== 4) return;
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
            <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} maxLength={4} className="input font-mono" placeholder="4 chiffres" />
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
          <button onClick={handleSave} disabled={!name || pin.length !== 4} className="btn-primary w-full">Créer</button>
        </div>
      </div>
    </div>
  );
}

function FinanceSettings({ store, canEdit }: { store: StoreType; canEdit: boolean }) {
  const [saleRate, setSaleRate] = useState('');
  const [exchangeRate, setExchangeRate] = useState('');
  const [ratesLoaded, setRatesLoaded] = useState(false);
  const [taxEnabled, setTaxEnabled] = useState(store.tax_enabled);
  const [taxRate, setTaxRate] = useState(store.tax_rate);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      const rows = await query<{ key: string; value: string }>("SELECT key, value FROM settings WHERE key IN ('usd_cdf_sale_rate','usd_cdf_exchange_rate')");
      const values = Object.fromEntries(rows.map((r) => [r.key, r.value]));
      setSaleRate(values.usd_cdf_sale_rate ?? '');
      setExchangeRate(values.usd_cdf_exchange_rate ?? '');
      setRatesLoaded(true);
    })().catch((e) => console.warn('Chargement des taux impossible', e));
  }, []);

  const handleSave = async () => {
    const high = Number(saleRate);
    const low = Number(exchangeRate);
    const hasSale = saleRate.trim() !== '';
    const hasExchange = exchangeRate.trim() !== '';
    if (hasSale !== hasExchange || (hasSale && (!Number.isFinite(high) || !Number.isFinite(low) || high <= 0 || low <= 0 || low >= high))) {
      window.alert('Saisis les deux taux positifs, avec un taux de vente supérieur au taux d’échange, ou laisse les deux champs vides.');
      return;
    }
    await execute('UPDATE stores SET tax_enabled = $1, tax_rate = $2 WHERE id = $3', [taxEnabled, taxRate, store.id]);
    if (hasSale && hasExchange) {
      await saveSetting('usd_cdf_sale_rate', String(high));
      await saveSetting('usd_cdf_exchange_rate', String(low));
    } else {
      await deleteSettings(['usd_cdf_sale_rate', 'usd_cdf_exchange_rate']);
    }
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
      <div className="pt-3 mt-3 border-t border-slate-200 space-y-3">
        <h3 className="font-semibold text-slate-800">Double devise USD / CDF</h3>
        <p className="text-sm text-slate-500">Chaque produit peut être tarifé en USD ou en CDF. Les taux servent uniquement lorsqu’une opération convertit réellement une devise vers l’autre. Configure ici tes taux réels. Le taux de vente doit être plus élevé que le taux d’échange. Aucun taux d’exemple n’est prérempli.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Taux de change pour les ventes (CDF pour 1 USD)</label>
            <input type="number" min="0" step="1" value={saleRate} onChange={(e) => setSaleRate(e.target.value)} disabled={!canEdit || !ratesLoaded} className="input" placeholder="Ex. taux de vente" />
          </div>
          <div>
            <label className="label">Taux d’échange / rendu USD (CDF pour 1 USD)</label>
            <input type="number" min="0" step="1" value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} disabled={!canEdit || !ratesLoaded} className="input" placeholder="Ex. taux d’échange plus bas" />
          </div>
        </div>
        {Number(saleRate) > 0 && Number(exchangeRate) > 0 && Number(exchangeRate) >= Number(saleRate) && <p className="text-sm text-error-600">Le taux d’échange doit être inférieur au taux de vente.</p>}
      </div>
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
