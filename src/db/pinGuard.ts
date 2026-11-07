import { query, queryOne, execute } from './localDb';
import { hashPin, isPlainPin, verifyPin } from '../lib/pin';

/**
 * Protection contre les essais de PIN en série + migration des PIN en clair.
 *
 * Les compteurs sont stockés dans app_meta (table locale, jamais synchronisée avec le cloud) :
 * ils survivent au rechargement de la page.
 */

export const MAX_PIN_ATTEMPTS = 5;
const LOCK_BASE_MS = 15 * 60 * 1000;        // 1er blocage : 15 minutes
const LOCK_MAX_MS = 24 * 60 * 60 * 1000;    // plafond : 24 heures (doublement à chaque blocage consécutif)

interface AttemptState { failed: number; lockCount: number; lockedUntil: number }

export interface LockStatus {
  locked: boolean;
  /** Durée de blocage restante en ms (0 si non bloqué). */
  retryAfterMs: number;
  attemptsLeft: number;
}

const metaKey = (key: string) => `pin_attempts:${key}`;

async function readState(key: string): Promise<AttemptState> {
  const row = await queryOne<{ value: string }>('SELECT value FROM app_meta WHERE key = $1', [metaKey(key)]);
  if (!row) return { failed: 0, lockCount: 0, lockedUntil: 0 };
  try {
    const parsed = JSON.parse(row.value) as Partial<AttemptState>;
    return { failed: Number(parsed.failed) || 0, lockCount: Number(parsed.lockCount) || 0, lockedUntil: Number(parsed.lockedUntil) || 0 };
  } catch {
    return { failed: 0, lockCount: 0, lockedUntil: 0 };
  }
}

async function writeState(key: string, state: AttemptState): Promise<void> {
  await execute(
    'INSERT INTO app_meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
    [metaKey(key), JSON.stringify(state)]
  );
}

function toStatus(state: AttemptState): LockStatus {
  const remaining = state.lockedUntil - Date.now();
  // Garde-fou : une horloge reculée ne peut pas prolonger un blocage au-delà du maximum.
  const retryAfterMs = remaining > 0 ? Math.min(remaining, LOCK_MAX_MS) : 0;
  return { locked: retryAfterMs > 0, retryAfterMs, attemptsLeft: Math.max(0, MAX_PIN_ATTEMPTS - state.failed) };
}

export async function getLockStatus(key: string): Promise<LockStatus> {
  return toStatus(await readState(key));
}

/** Enregistre un échec. Au 5e échec consécutif, bloque (15 min, puis 30 min, 1 h… jusqu'à 24 h). */
export async function recordPinFailure(key: string): Promise<LockStatus> {
  const state = await readState(key);
  state.failed += 1;
  if (state.failed >= MAX_PIN_ATTEMPTS) {
    state.lockCount += 1;
    state.failed = 0;
    state.lockedUntil = Date.now() + Math.min(LOCK_BASE_MS * 2 ** (state.lockCount - 1), LOCK_MAX_MS);
  }
  await writeState(key, state);
  return toStatus(state);
}

export async function recordPinSuccess(key: string): Promise<void> {
  await execute('DELETE FROM app_meta WHERE key = $1', [metaKey(key)]);
}

/** Déblocage manuel par un propriétaire/gérant (réglages). */
export async function clearPinLock(key: string): Promise<void> {
  await recordPinSuccess(key);
}

export const userLockKey = (userId: string) => `user:${userId}`;
/** Compteur commun à toutes les fenêtres « PIN du gérant/propriétaire » (validations sensibles). */
export const APPROVAL_LOCK_KEY = 'approval';

export function formatLockDelay(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/**
 * Remplace les PIN stockés en clair par une empreinte PBKDF2 salée.
 * Appelée au démarrage et avant chaque vérification : un compte récupéré du cloud avec un PIN en clair
 * est converti à son tour (et la version hachée est renvoyée vers le cloud par la file de synchronisation).
 */
export async function migratePlainPins(): Promise<number> {
  const rows = await query<{ id: string; pin: string }>('SELECT id, pin FROM users');
  let migrated = 0;
  for (const row of rows) {
    if (!row.pin || !isPlainPin(row.pin)) continue;
    await execute('UPDATE users SET pin = $1 WHERE id = $2 AND pin = $3', [await hashPin(row.pin), row.id, row.pin]);
    migrated += 1;
  }
  return migrated;
}

/**
 * Cherche, parmi des comptes candidats, ceux dont le PIN correspond — avec blocage après 5 échecs.
 * Sert aux validations « PIN du gérant/propriétaire » où l'on ne sait pas à l'avance quel compte saisit.
 * Retourne tous les comptes correspondants (deux gérants peuvent avoir le même PIN).
 */
export async function findUsersByPin<T extends { id: string; pin: string }>(
  candidates: T[],
  pin: string,
  lockKey: string = APPROVAL_LOCK_KEY
): Promise<T[]> {
  const lock = await getLockStatus(lockKey);
  if (lock.locked) {
    throw new Error(`Trop d'essais incorrects. Réessayez dans ${formatLockDelay(lock.retryAfterMs)}.`);
  }
  const matches: T[] = [];
  for (const candidate of candidates) {
    if (await verifyPin(pin, candidate.pin)) matches.push(candidate);
  }
  if (matches.length === 0) {
    const status = await recordPinFailure(lockKey);
    if (status.locked) throw new Error(`Trop d'essais incorrects. Réessayez dans ${formatLockDelay(status.retryAfterMs)}.`);
    return [];
  }
  await recordPinSuccess(lockKey);
  return matches;
}
