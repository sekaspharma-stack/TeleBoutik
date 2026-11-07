import { create } from 'zustand';

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'teleboutik:theme';
const META_COLORS: Record<ThemeMode, string> = { light: '#0b6b68', dark: '#121212' };

function readStored(): ThemeMode | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'dark' || value === 'light' ? value : null;
  } catch {
    return null; // stockage indisponible (navigation privée, etc.)
  }
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  root.classList.toggle('dark', mode === 'dark');
  root.style.colorScheme = mode;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', META_COLORS[mode]);
}

interface ThemeState {
  mode: ThemeMode;
  /** true tant que l'utilisateur n'a jamais choisi : on suit alors le réglage du système. */
  followsSystem: boolean;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
}

const stored = readStored();
const initialMode: ThemeMode = stored ?? (systemPrefersDark() ? 'dark' : 'light');
if (typeof document !== 'undefined') applyTheme(initialMode);

export const useTheme = create<ThemeState>((set, get) => ({
  mode: initialMode,
  followsSystem: stored === null,
  setMode: (mode) => {
    try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* ignoré */ }
    applyTheme(mode);
    set({ mode, followsSystem: false });
  },
  toggle: () => get().setMode(get().mode === 'dark' ? 'light' : 'dark'),
}));

// Tant que la personne n'a pas choisi, on suit le thème de l'appareil en direct.
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', (event) => {
    if (!useTheme.getState().followsSystem) return;
    const mode: ThemeMode = event.matches ? 'dark' : 'light';
    applyTheme(mode);
    useTheme.setState({ mode });
  });
}
