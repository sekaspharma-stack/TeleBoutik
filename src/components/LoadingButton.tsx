import { ButtonHTMLAttributes, MouseEvent, ReactNode } from 'react';
import { useSingleFlight } from '../lib/useSingleFlight';

interface LoadingButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  /** Peut être asynchrone : le bouton reste verrouillé jusqu'à la fin de l'opération. */
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void | Promise<unknown>;
  /** Forcer l'état de chargement (ex. soumission de formulaire gérée ailleurs). */
  loading?: boolean;
  loadingText?: string;
  children: ReactNode;
}

/**
 * Bouton d'action critique : désactivé immédiatement après le premier clic,
 * avec indicateur de chargement, jusqu'à la fin de l'opération (anti double-soumission).
 */
export default function LoadingButton({ onClick, loading = false, loadingText, children, disabled, className = 'btn-primary', type = 'button', ...rest }: LoadingButtonProps) {
  const { run, pending } = useSingleFlight();
  const busy = loading || pending;

  return (
    <button
      {...rest}
      type={type}
      className={`${className} ${busy ? 'btn-loading' : ''}`}
      disabled={disabled || busy}
      aria-busy={busy}
      onClick={(event) => {
        if (busy) { event.preventDefault(); return; }
        if (type === 'submit' && !onClick) return; // le formulaire gère son propre verrou
        void run(() => onClick?.(event));
      }}
    >
      {busy && <span className="spinner" aria-hidden="true" />}
      <span>{busy && loadingText ? loadingText : children}</span>
    </button>
  );
}
