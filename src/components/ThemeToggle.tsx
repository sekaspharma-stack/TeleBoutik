import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../lib/theme';

/**
 * Interrupteur clair / sombre accessible : <button role="switch">, utilisable au clavier
 * (Espace / Entrée), annoncé par les lecteurs d'écran, animation fluide (désactivée si
 * l'utilisateur préfère un mouvement réduit).
 */
export default function ThemeToggle({ showLabel = false, className = '' }: { showLabel?: boolean; className?: string }) {
  const mode = useTheme((state) => state.mode);
  const toggle = useTheme((state) => state.toggle);
  const isDark = mode === 'dark';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={isDark ? 'Désactiver le mode sombre' : 'Activer le mode sombre'}
      title={isDark ? 'Passer au mode clair' : 'Passer au mode sombre'}
      onClick={toggle}
      className={`theme-toggle ${className}`}
    >
      {showLabel && <span className="theme-toggle-label">{isDark ? 'Mode sombre' : 'Mode clair'}</span>}
      <span className="theme-toggle-track" aria-hidden="true">
        <Sun className="theme-toggle-icon theme-toggle-sun" />
        <Moon className="theme-toggle-icon theme-toggle-moon" />
        <span className="theme-toggle-thumb">{isDark ? <Moon className="h-3 w-3" /> : <Sun className="h-3 w-3" />}</span>
      </span>
    </button>
  );
}
