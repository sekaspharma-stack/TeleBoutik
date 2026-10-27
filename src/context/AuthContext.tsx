import { create } from 'zustand';
import type { User, CashSession, Store } from '../types';
import { query, queryOne, execute, generateId, now } from '../db/localDb';

interface AuthState {
  user: User | null;
  store: Store | null;
  cashSession: CashSession | null;
  loginTime: number | null;
  isInitialized: boolean;
  init: () => Promise<void>;
  login: (pin: string) => Promise<boolean>;
  logout: () => void;
  checkSessionExpiry: () => boolean;
  setCashSession: (session: CashSession | null) => void;
  updateStore: (store: Store) => Promise<void>;
}

const SESSION_TIMEOUT_MS = 15 * 60 * 1000;

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  store: null,
  cashSession: null,
  loginTime: null,
  isInitialized: false,

  init: async () => {
    const store = await queryOne<Store>('SELECT * FROM stores LIMIT 1');
    set({ store: store ?? null, isInitialized: true });
  },

  login: async (pin: string) => {
    const user = await queryOne<User>(
      'SELECT * FROM users WHERE pin = $1 AND active = true LIMIT 1',
      [pin]
    );
    if (!user) return false;
    set({ user, loginTime: Date.now() });
    await execute(
      "INSERT INTO audit_log (id, user_id, user_role, entity, action, prev_hash, hash, created_at) VALUES ($1, $2, $3, 'auth', 'login', '', $4, $5)",
      [generateId(), user.id, user.role, hashString(`${user.id}-${Date.now()}`), now()]
    );
    return true;
  },

  logout: () => {
    const { user } = get();
    if (user) {
      execute(
        "INSERT INTO audit_log (id, user_id, user_role, entity, action, prev_hash, hash, created_at) VALUES ($1, $2, $3, 'auth', 'logout', '', $4, $5)",
        [generateId(), user.id, user.role, hashString(`${user.id}-${Date.now()}-out`), now()]
      );
    }
    set({ user: null, cashSession: null, loginTime: null });
  },

  checkSessionExpiry: () => {
    const { loginTime } = get();
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

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}
