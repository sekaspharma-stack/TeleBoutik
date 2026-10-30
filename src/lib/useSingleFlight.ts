import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Exécute une action asynchrone UNE seule fois à la fois.
 * Le verrou est un `ref` (effet immédiat, synchrone) : un deuxième clic dans la même
 * milliseconde — avant même que React ait re-rendu — est ignoré. L'état `pending`
 * sert à l'affichage (bouton désactivé + indicateur de chargement).
 */
export function useSingleFlight(cooldownMs = 500) {
  const lock = useRef(false);
  const mounted = useRef(true);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const run = useCallback(async <T,>(action: () => Promise<T> | T): Promise<T | undefined> => {
    if (lock.current) return undefined;
    lock.current = true;
    setPending(true);
    try {
      return await action();
    } finally {
      // Court délai de grâce : empêche un « re-clic réflexe » juste après le succès.
      window.setTimeout(() => {
        lock.current = false;
        if (mounted.current) setPending(false);
      }, cooldownMs);
    }
  }, [cooldownMs]);

  return { run, pending };
}
