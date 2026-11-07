/**
 * Hachage des codes PIN.
 *
 * Format stocké : `pbkdf2-sha256$<itérations>$<sel hex>$<empreinte hex>`
 *  - un sel aléatoire de 16 octets par PIN : deux utilisateurs ayant le même PIN ont des empreintes différentes ;
 *  - PBKDF2-HMAC-SHA256 avec un grand nombre d'itérations : chaque essai coûte du temps de calcul.
 *
 * Anciens formats (lus uniquement pour migration, jamais produits) :
 *  - `sha256:<hex>`  : SHA-256 sans sel ;
 *  - `legacy:<hex>`  : empreinte FNV de secours ;
 *  - PIN en clair    : NON accepté ici. Il est converti au démarrage par `migratePlainPins()` (db/pinGuard.ts).
 */

export const PBKDF2_PREFIX = 'pbkdf2-sha256';
export const PBKDF2_ITERATIONS = 210_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

function subtle(): SubtleCrypto {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('Chiffrement indisponible : ouvrez TeleBoutik en HTTPS (ou sur localhost).');
  }
  return crypto.subtle;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) throw new Error('Empreinte PIN invalide.');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

/** Comparaison en temps constant (évite de révéler la position de la première différence). */
function safeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

async function pbkdf2(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await subtle().importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle().deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(salt).buffer, iterations },
    key,
    HASH_BYTES * 8
  );
  return new Uint8Array(bits);
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await subtle().digest('SHA-256', new TextEncoder().encode(text));
  return toHex(new Uint8Array(digest));
}

/** Produit l'empreinte salée d'un PIN, à enregistrer dans users.pin. */
export async function hashPin(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await pbkdf2(pin, salt, PBKDF2_ITERATIONS);
  return `${PBKDF2_PREFIX}$${PBKDF2_ITERATIONS}$${toHex(salt)}$${toHex(hash)}`;
}

/** Vrai si la valeur stockée est un PIN en clair (ni PBKDF2, ni ancien format haché). */
export function isPlainPin(stored: string): boolean {
  return !stored.startsWith(`${PBKDF2_PREFIX}$`) && !stored.startsWith('sha256:') && !stored.startsWith('legacy:');
}

/** Vrai si l'empreinte doit être recalculée au prochain PIN correct (ancien format ou moins d'itérations). */
export function needsPinRehash(stored: string): boolean {
  if (!stored.startsWith(`${PBKDF2_PREFIX}$`)) return true;
  const iterations = Number(stored.split('$')[1]);
  return !Number.isFinite(iterations) || iterations < PBKDF2_ITERATIONS;
}

/** Vérifie un PIN. Les PIN en clair sont volontairement refusés (voir migratePlainPins). */
export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  if (!stored) return false;

  if (stored.startsWith(`${PBKDF2_PREFIX}$`)) {
    const [, iterText, saltHex, hashHex] = stored.split('$');
    const iterations = Number(iterText);
    if (!Number.isInteger(iterations) || iterations < 1 || !saltHex || !hashHex) return false;
    try {
      const computed = await pbkdf2(pin, fromHex(saltHex), iterations);
      return safeEqual(toHex(computed), hashHex.toLowerCase());
    } catch {
      return false;
    }
  }

  if (stored.startsWith('sha256:')) {
    return safeEqual(`sha256:${await sha256Hex(pin)}`, stored);
  }

  if (stored.startsWith('legacy:')) {
    let hash = 2166136261;
    for (let i = 0; i < pin.length; i++) hash = Math.imul(hash ^ pin.charCodeAt(i), 16777619);
    return safeEqual(`legacy:${(hash >>> 0).toString(16)}`, stored);
  }

  return false;
}
