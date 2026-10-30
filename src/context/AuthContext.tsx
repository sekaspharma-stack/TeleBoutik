import { create } from 'zustand';
import type { User, CashSession, Store } from '../types';
import { query, queryOne, execute } from '../db/localDb';
import { hashPin, needsPinRehash, verifyPin } from '../lib/pin';
import { addAuditLog } from '../db/audit';
import { getLockStatus, migratePlainPins, recordPinFailure, recordPinSuccess, userLockKey } from '../db/pinGuard';

/** Compte affiché sur l'écran de connexion (jamais le PIN). */
export interface LoginUser { id: string; name: string; role: User['role'] }

export type LoginResult =
  | { ok: true }
  | { ok: false; reason: 'invalid'; attemptsLeft: number }
  | { ok: false; reason: 'locked'; retryAfterMs: number }
  | { ok: false; reason: 'unknown_user' };

/** Liste des comptes actifs proposés à la connexion. */
export async function listLoginUsers(): Promise<LoginUser[]> {
  return query<LoginUser>('SELECT id, name, role FROM users WHERE active = true ORDER BY name');
}

interface AuthState {
  user: User | null;
  store: Store | null;
  cashSession: CashSession | null;
  loginTime: number | null;
  isInitialized: boolean;
  init: () => Promise<void>;
  login: (userId: string, pin: string) => Promise<LoginResult>;
  logout: () => void;
  checkSessionExpiry: () => boolean;
  touchSession: () => void;
  setCashSession: (session: CashSession | null) => void;
  updateStore: (store: Store) => Promise<void>;
}

// La session expire après 8 heures sans activité, pas après 15 minutes de travail.
const SESSION_TIMEOUT_MS = 8 * 60 * 60 * 1000;

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  store: null,
  cashSession: null,
  loginTime: null,
  isInitialized: false,

  init: async () => {
    try { await migratePlainPins(); } catch (e) { console.warn('Migration des PIN impossible :', e); }
    const store = await queryOne<Store>('SELECT * FROM stores LIMIT 1');
    set({ store: store ?? null, isInitialized: true });
  },

  login: async (userId: string, pin: string): Promise<LoginResult> => {
    // Un compte récupéré du cloud avec un PIN en clair est converti avant toute vérification.
    await migratePlainPins();
    const found = await queryOne<User>('SELECT * FROM users WHERE id = $1 AND active = true', [userId]);
    if (!found) return { ok: false, reason: 'unknown_user' };

    const lockKey = userLockKey(found.id);
    const lock = await getLockStatus(lockKey);
    if (lock.locked) return { ok: false, reason: 'locked', retryAfterMs: lock.retryAfterMs };

    if (!(await verifyPin(pin, found.pin))) {
      const status = await recordPinFailure(lockKey);
      try { await addAuditLog(found, 'auth', status.locked ? 'login_locked' : 'login_failed'); } catch (e) { console.warn('Audit de l’échec de connexion impossible :', e); }
      return status.locked
        ? { ok: false, reason: 'locked', retryAfterMs: status.retryAfterMs }
        : { ok: false, reason: 'invalid', attemptsLeft: status.attemptsLeft };
    }

    await recordPinSuccess(lockKey);
    // Ancien format (SHA-256 sans sel…) : on le remplace par PBKDF2 salé maintenant que le PIN est connu.
    if (needsPinRehash(found.pin)) {
      await execute('UPDATE users SET pin = $1 WHERE id = $2', [await hashPin(pin), found.id]);
    }
    // L'empreinte du PIN n'a aucune raison de rester en mémoire pendant la session.
    set({ user: { ...found, pin: '' }, loginTime: Date.now() });
    await addAuditLog(found, 'auth', 'login');
    return { ok: true };
  },

  logout: () => {
    const { user } = get();
    if (user) {
      addAuditLog(user, 'auth', 'logout').catch((e) => console.warn('Audit de déconnexion impossible :', e));
    }
    set({ user: null, cashSession: null, loginTime: null });
  },

  touchSession: () => {
    if (get().user) set({ loginTime: Date.now() });
  },

  checkSessionExpiry: () => {
    const { loginTime, user } = get();
    if (!user) return false;
    if (!loginTime) return false;
    if (Date.now() - loginTime > SESSION_TIMEOUT_MS) {
      get().logout();
      return true;
    }
    return false;
  },

  setCashSession: (session) => set({ cashSession: session }),

  updateStore: async (store) => {
    await execute(
      `UPDATE stores SET name=$1, address=$2, phone=$3, currency=$4, currency_decimals=$5, tax_rate=$6, tax_enabled=$7, max_seller_discount=$8, max_manager_discount=$9, credit_limit_default=$10, return_window_days=$11, ticket_width=$12, footer_text=$13 WHERE id=$14`,
      [store.name, store.address, store.phone, store.currency, store.currency_decimals, store.tax_rate, store.tax_enabled, store.max_seller_discount, store.max_manager_discount, store.credit_limit_default, store.return_window_days, store.ticket_width, store.footer_text, store.id]
    );
    set({ store });
  },
}));
