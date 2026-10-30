import { useState, useEffect } from 'react';
import { Store, Delete, ChevronLeft, UserRound } from 'lucide-react';
import { useAuth, listLoginUsers, type LoginUser } from '../context/AuthContext';
import { getLockStatus, formatLockDelay, userLockKey } from '../db/pinGuard';
import { roleLabel } from '../lib/utils';

const PIN_LENGTH = 4;

export default function LoginPage({ booting = false }: { booting?: boolean }) {
  const { login, store } = useAuth();
  const [users, setUsers] = useState<LoginUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [selected, setSelected] = useState<LoginUser | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  let cachedStoreName = '';
  try { cachedStoreName = localStorage.getItem('teleboutik:store-name') ?? ''; } catch { /* ignore */ }

  useEffect(() => {
    let cancelled = false;
    setLoadingUsers(true);
    listLoginUsers()
      .then((list) => { if (!cancelled) setUsers(list); })
      .catch(() => { if (!cancelled) setError('Base locale indisponible, réessayez dans un instant'); })
      .finally(() => { if (!cancelled) setLoadingUsers(false); });
    return () => { cancelled = true; };
  }, [booting]);

  const chooseUser = async (user: LoginUser) => {
    setSelected(user);
    setPin('');
    setError('');
    try {
      const lock = await getLockStatus(userLockKey(user.id));
      if (lock.locked) setError(`Compte bloqué après trop d'essais. Réessayez dans ${formatLockDelay(lock.retryAfterMs)}.`);
    } catch { /* l'état sera revérifié à la connexion */ }
  };

  // Un seul compte actif : inutile de demander de le choisir.
  useEffect(() => {
    if (!selected && users.length === 1) void chooseUser(users[0]);
  }, [users]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selected && pin.length === PIN_LENGTH) {
      handleSubmit();
    }
  }, [pin]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async () => {
    if (!selected || pin.length !== PIN_LENGTH) return;
    setChecking(true);
    try {
      const result = await login(selected.id, pin); // attend l'ouverture de la base locale si elle n'est pas encore prête
      if (!result.ok) {
        if (result.reason === 'locked') setError(`Compte bloqué après 5 essais incorrects. Réessayez dans ${formatLockDelay(result.retryAfterMs)}.`);
        else if (result.reason === 'invalid') setError(`Code PIN incorrect. ${result.attemptsLeft} essai${result.attemptsLeft > 1 ? 's' : ''} restant${result.attemptsLeft > 1 ? 's' : ''} avant blocage.`);
        else { setError('Ce compte n’est plus disponible.'); setSelected(null); }
        setPin('');
      }
    } catch {
      setError('Base locale indisponible, réessayez dans un instant');
      setPin('');
    } finally {
      setChecking(false);
    }
  };

  const handleKey = (key: string) => {
    if (checking || pin.length >= PIN_LENGTH) return;
    setError('');
    setPin(pin + key);
  };

  const handleDelete = () => {
    setError('');
    setPin(pin.slice(0, -1));
  };

  const backToUsers = () => {
    setSelected(null);
    setPin('');
    setError('');
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4" style={{ background: 'radial-gradient(900px 480px at 50% -5%, #14565a 0%, #0a1f23 62%)' }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-primary-600 shadow-xl shadow-black/30 ring-1 ring-white/10">
            <Store className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-white">TeleBoutik</h1>
          <p className="mt-1 text-sm text-primary-200">{store?.name ?? (cachedStoreName || 'Boutique')}</p>
        </div>

        <div className="rounded-3xl bg-white p-6 shadow-2xl">
          {!selected ? (
            <>
          <p className="mb-4 text-center text-sm font-semibold text-slate-600">Qui se connecte ?</p>
          {error && <p className="text-center text-error-600 text-sm mb-3 animate-fade-in" role="alert">{error}</p>}
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {users.map((u) => (
              <button
                key={u.id}
                onClick={() => void chooseUser(u)}
                className="flex w-full items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-3 text-left hover:border-primary-200 hover:bg-primary-50 active:bg-primary-100"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary-100 text-primary-700"><UserRound className="h-5 w-5" /></span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold text-slate-800">{u.name}</span>
                  <span className="block text-xs text-slate-500">{roleLabel(u.role)}</span>
                </span>
              </button>
            ))}
            {!loadingUsers && users.length === 0 && !error && (
              <p className="text-center text-sm text-slate-500">Aucun compte actif trouvé.</p>
            )}
          </div>
            </>
          ) : (
            <>
          <button onClick={backToUsers} disabled={checking} className="mb-3 flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700 disabled:opacity-50">
            <ChevronLeft className="h-4 w-4" /> Changer de compte
          </button>
          <div className="mb-4 text-center">
            <p className="text-sm font-bold text-slate-800">{selected.name}</p>
            <p className="text-xs text-slate-500">{roleLabel(selected.role)} · Entrez votre code PIN</p>
          </div>

          <div className="flex justify-center gap-2 mb-4">
            {Array.from({ length: PIN_LENGTH }).map((_, i) => (
              <div
                key={i}
                className={`w-3 h-3 rounded-full transition-all ${
                  i < pin.length ? 'bg-primary-600 scale-125' : 'bg-slate-200'
                }`}
              />
            ))}
          </div>

          {error && (
            <p className="text-center text-error-600 text-sm mb-3 animate-fade-in">{error}</p>
          )}

          <div className="grid grid-cols-3 gap-2">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((key) => (
              <button
                key={key}
                onClick={() => handleKey(key)}
                className="aspect-square rounded-2xl border border-slate-100 bg-slate-50 text-xl font-bold text-slate-700 hover:border-primary-200 hover:bg-primary-50 hover:text-primary-800 active:bg-primary-100"
              >
                {key}
              </button>
            ))}
            <div />
            <button
              onClick={() => handleKey('0')}
              className="aspect-square rounded-2xl border border-slate-100 bg-slate-50 text-xl font-bold text-slate-700 hover:border-primary-200 hover:bg-primary-50 hover:text-primary-800 active:bg-primary-100"
            >
              0
            </button>
            <button
              onClick={handleDelete}
              className="flex aspect-square items-center justify-center rounded-2xl border border-slate-100 bg-slate-50 text-slate-500 hover:border-error-100 hover:bg-error-50 hover:text-error-600 active:bg-error-100"
            >
              <Delete className="w-5 h-5" />
            </button>
          </div>

            </>
          )}

          <div className="mt-4 pt-4 border-t border-slate-100 text-center">
            <p className="text-xs text-slate-400" role="status">
              {checking ? 'Vérification…' : booting ? 'Préparation des données en cours…' : selected ? 'Utilisez le code PIN attribué à votre compte.' : loadingUsers ? 'Chargement des comptes…' : 'Choisissez votre compte pour continuer.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
