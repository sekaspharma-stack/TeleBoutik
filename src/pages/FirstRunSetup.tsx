import { useState, type FormEvent } from 'react';
import { Store, ShieldCheck } from 'lucide-react';
import { execute, generateId, now } from '../db/localDb';
import { hashPin } from '../lib/pin';
import { isFirebaseConfigured } from '../db/firebaseClient';

type Props = { onComplete: () => Promise<void> | void };

export default function FirstRunSetup({ onComplete }: Props) {
  const [storeName, setStoreName] = useState('Ma boutique');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [ownerName, setOwnerName] = useState('Administrateur');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!storeName.trim() || !ownerName.trim()) return setError('Renseignez le nom de la boutique et celui de l’administrateur.');
    if (!/^\d{4}$/.test(pin)) return setError('Le PIN doit contenir exactement 4 chiffres.');
    if (pin !== confirmPin) return setError('Les deux codes PIN ne correspondent pas.');

    setSaving(true);
    try {
      const storeId = generateId();
      const userId = generateId();
      const pinHash = await hashPin(pin);
      const timestamp = now();

      await execute(
        `INSERT INTO stores (id, name, address, phone, currency, currency_decimals, tax_rate, tax_enabled, max_seller_discount, max_manager_discount, credit_limit_default, return_window_days, ticket_width, footer_text)
         VALUES ($1, $2, $3, $4, 'CDF', 0, 0, false, 5, 10, 50000, 7, '58', 'Merci de votre visite!')`,
        [storeId, storeName.trim(), address.trim(), phone.trim()]
      );
      await execute(
        `INSERT INTO users (id, name, pin, role, active, commission_rate, fixed_salary, created_at)
         VALUES ($1, $2, $3, 'owner', true, 0, 0, $4)`,
        [userId, ownerName.trim(), pinHash, timestamp]
      );
      await onComplete();
    } catch (e) {
      console.error('Initial setup failed:', e);
      setError(e instanceof Error ? e.message : 'Impossible de créer la boutique. Réessayez.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4" style={{ background: 'radial-gradient(900px 480px at 50% -5%, #14565a 0%, #0a1f23 62%)' }}>
      <form onSubmit={handleSubmit} className="w-full max-w-lg bg-white rounded-2xl shadow-xl p-6 space-y-4">
        <div className="text-center mb-2">
          <div className="w-14 h-14 bg-primary-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <Store className="w-7 h-7 text-primary-700" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">Configurer TeleBoutik</h1>
          <p className="text-sm text-slate-500 mt-1">Aucune boutique n’a été trouvée. Créez votre boutique et son premier compte administrateur.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block sm:col-span-2"><span className="label">Nom de la boutique *</span><input required value={storeName} onChange={(e) => setStoreName(e.target.value)} className="input" placeholder="TeleBoutik" /></label>
          <label className="block"><span className="label">Adresse</span><input value={address} onChange={(e) => setAddress(e.target.value)} className="input" placeholder="Lubumbashi" /></label>
          <label className="block"><span className="label">Téléphone</span><input value={phone} onChange={(e) => setPhone(e.target.value)} className="input" placeholder="+243…" /></label>
          <label className="block sm:col-span-2"><span className="label">Nom de l’administrateur *</span><input required value={ownerName} onChange={(e) => setOwnerName(e.target.value)} className="input" /></label>
          <label className="block"><span className="label">PIN administrateur (4 chiffres) *</span><input required type="password" inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} className="input font-mono" autoComplete="new-password" /></label>
          <label className="block"><span className="label">Confirmer le PIN *</span><input required type="password" inputMode="numeric" maxLength={4} value={confirmPin} onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))} className="input font-mono" autoComplete="new-password" /></label>
        </div>

        {error && <p role="alert" className="text-sm text-error-600 bg-error-50 rounded-lg p-3">{error}</p>}
        <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 rounded-lg p-3">
          <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
          <p>{isFirebaseConfigured ? 'Firestore semble configuré. Le mode test autorise des accès trop larges : ne stockez pas encore de vraies données tant que les règles Firestore et l’authentification ne sont pas sécurisées.' : 'La configuration Firebase n’est pas détectée : cette installation fonctionne localement pour le moment. Ajoutez les variables VITE_FIREBASE_* dans Netlify pour activer la synchronisation cloud.'}</p>
        </div>
        <button disabled={saving} type="submit" className="btn-primary w-full justify-center disabled:opacity-60">{saving ? 'Création…' : 'Créer la boutique'}</button>
      </form>
    </div>
  );
}
