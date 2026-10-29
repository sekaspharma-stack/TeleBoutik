import { useState, useEffect } from 'react';
import { Store, Delete } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const PIN_LENGTH = 4;

export default function LoginPage({ booting = false }: { booting?: boolean }) {
  const { login, store } = useAuth();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  let cachedStoreName = '';
  try { cachedStoreName = localStorage.getItem('teleboutik:store-name') ?? ''; } catch { /* ignore */ }

  useEffect(() => {
    if (pin.length === PIN_LENGTH) {
      handleSubmit();
    }
  }, [pin]);

  const handleSubmit = async () => {
    if (pin.length !== PIN_LENGTH) return;
    setChecking(true);
    try {
      const success = await login(pin); // attend l'ouverture de la base locale si elle n'est pas encore prête
      if (!success) {
        setError('Code PIN incorrect');
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
          <p className="mb-4 text-center text-sm font-semibold text-slate-600">Entrez votre code PIN</p>

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

          <div className="mt-4 pt-4 border-t border-slate-100 text-center">
            <p className="text-xs text-slate-400" role="status">
              {checking ? 'Vérification…' : booting ? 'Préparation des données en cours…' : 'Utilisez le code PIN attribué à votre compte.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
