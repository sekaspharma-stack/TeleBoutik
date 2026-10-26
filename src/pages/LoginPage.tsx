import { useState, useEffect } from 'react';
import { Store, Delete } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const { login, store } = useAuth();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (pin.length >= 4) {
      handleSubmit();
    }
  }, [pin]);

  const handleSubmit = async () => {
    if (pin.length < 4) return;
    const success = await login(pin);
    if (!success) {
      setError('Code PIN incorrect');
      setPin('');
    }
  };

  const handleKey = (key: string) => {
    if (pin.length >= 6) return;
    setError('');
    setPin(pin + key);
  };

  const handleDelete = () => {
    setError('');
    setPin(pin.slice(0, -1));
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-700 to-primary-900 p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Store className="w-8 h-8 text-primary-700" />
          </div>
          <h1 className="text-2xl font-bold text-white">TeleBoutik POS</h1>
          <p className="text-primary-200 text-sm mt-1">{store?.name ?? 'Boutique'}</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6">
          <p className="text-center text-slate-600 text-sm mb-4">Entrez votre code PIN</p>

          <div className="flex justify-center gap-2 mb-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className={`w-3 h-3 rounded-full transition-all ${
                  i < pin.length ? 'bg-primary-600 scale-110' : 'bg-slate-200'
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
                className="aspect-square rounded-xl bg-slate-50 hover:bg-primary-50 active:bg-primary-100 text-xl font-semibold text-slate-700 transition-all active:scale-95"
              >
                {key}
              </button>
            ))}
            <div />
            <button
              onClick={() => handleKey('0')}
              className="aspect-square rounded-xl bg-slate-50 hover:bg-primary-50 active:bg-primary-100 text-xl font-semibold text-slate-700 transition-all active:scale-95"
            >
              0
            </button>
            <button
              onClick={handleDelete}
              className="aspect-square rounded-xl bg-slate-50 hover:bg-error-50 active:bg-error-100 flex items-center justify-center text-slate-500 transition-all active:scale-95"
            >
              <Delete className="w-5 h-5" />
            </button>
          </div>

          <div className="mt-4 pt-4 border-t border-slate-100 text-center">
            <p className="text-xs text-slate-400">
              Démo: 0000 (Propriétaire) · 1111 (Gérant) · 2222 (Vendeur)
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
