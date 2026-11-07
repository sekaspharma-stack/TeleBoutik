export function formatCurrency(
  amount: number,
  currency: string = 'XOF',
  decimals: number = 0
): string {
  const formatted = new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);
  return `${formatted} ${currency}`;
}

export function formatNumber(n: number, decimals: number = 0): string {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

/**
 * Fuseau horaire de la boutique : Lubumbashi (UTC+2, sans changement d'heure).
 * Les dates sont STOCKÉES en UTC ('AAAA-MM-JJ HH:MM:SS', voir now() dans localDb) afin que tous les appareils
 * restent cohérents ; elles sont CONVERTIES en heure de Lubumbashi à l'affichage et pour les calculs de « jour ».
 */
export const APP_TIME_ZONE = 'Africa/Lubumbashi';
const APP_UTC_OFFSET_HOURS = 2;
/** Fragment SQL : jour (AAAA-MM-JJ) de Lubumbashi d'une colonne texte stockée en UTC. */
export const sqlLocalDate = (column: string): string => `substr((${column}::timestamp + INTERVAL '${APP_UTC_OFFSET_HOURS} hours')::text, 1, 10)`;

const NAIVE_DATETIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/;

/** Interprète une date stockée : sans fuseau explicite, elle est en UTC (et non dans le fuseau de l'appareil). */
export function parseStoredDate(value: string | Date): Date {
  if (value instanceof Date) return value;
  const m = NAIVE_DATETIME.exec(value.trim());
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)));
  return new Date(value);
}

function zonedParts(d: Date): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: APP_TIME_ZONE, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(d);
  const out: Record<string, string> = {};
  for (const part of parts) out[part.type] = part.value;
  return out;
}

export function formatDate(date: string | Date, formatStr: string = 'dd/MM/yyyy'): string {
  const d = parseStoredDate(date);
  if (Number.isNaN(d.getTime())) return '—';
  const p = zonedParts(d);
  return formatStr
    .replace('yyyy', p.year).replace('dd', p.day).replace('MM', p.month)
    .replace('HH', p.hour).replace('mm', p.minute).replace('ss', p.second);
}

export function formatDateTime(date: string | Date): string {
  return formatDate(date, 'dd/MM/yyyy HH:mm');
}

/** Jour (AAAA-MM-JJ) à Lubumbashi, pour l'instant donné (maintenant par défaut). */
export function lubumbashiDate(at: Date = new Date()): string {
  const p = zonedParts(at);
  return `${p.year}-${p.month}-${p.day}`;
}

export function todayStr(): string {
  return lubumbashiDate();
}

/** Ajoute (ou retire) des jours à une date AAAA-MM-JJ. */
export function addDaysStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const toStoredUtc = (ms: number) => new Date(ms).toISOString().replace('T', ' ').substring(0, 19);

/** Début du jour de Lubumbashi (00:00:00) exprimé en UTC stocké. */
export function dayStartUtc(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return toStoredUtc(Date.UTC(y, m - 1, d, 0, 0, 0) - APP_UTC_OFFSET_HOURS * 3600000);
}

/** Fin du jour de Lubumbashi (23:59:59) exprimée en UTC stocké. */
export function dayEndUtc(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return toStoredUtc(Date.UTC(y, m - 1, d, 23, 59, 59) - APP_UTC_OFFSET_HOURS * 3600000);
}

// Les numéros de ticket sont attribués par db/ticketNumber.ts (séquentiel par jour et par appareil).

export function generateBarcode(): string {
  const prefix = '20';
  let code = prefix;
  for (let i = 0; i < 11; i++) {
    code += Math.floor(Math.random() * 10).toString();
  }
  const checksum = computeEAN13Check(code);
  return code + checksum;
}

function computeEAN13Check(code12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = parseInt(code12[i], 10);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  const remainder = sum % 10;
  return remainder === 0 ? '0' : (10 - remainder).toString();
}

export function generateSku(brand: string, model: string, attrs: string): string {
  const brandCode = brand.substring(0, 3).toUpperCase();
  const modelCode = model.substring(0, 4).toUpperCase().replace(/\s/g, '');
  const attrCode = attrs.substring(0, 6).toUpperCase().replace(/\s/g, '');
  const random = Math.floor(Math.random() * 9999).toString().padStart(4, '0');
  return `${brandCode}-${modelCode}-${attrCode}-${random}`;
}

export function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Propriétaire',
  manager: 'Gérant',
  seller: 'Vendeur',
  accountant: 'Comptable',
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Espèces',
  orange_money: 'Orange Money (historique)',
  airtel_money: 'Airtel Money',
  mtn_momo: 'MTN MoMo',
  wave: 'Wave',
  card: 'Carte bancaire',
  transfer: 'Virement',
  credit: 'Crédit',
  voucher: "Bon d'achat",
};

export function paymentLabel(method: string): string {
  return PAYMENT_LABELS[method] ?? method;
}

const LIFECYCLE_LABELS: Record<string, string> = {
  ordered: 'Commandé',
  received: 'Reçu',
  in_stock: 'En stock',
  sold: 'Vendu',
  returned: 'Retourné',
  repair: 'SAV',
  traded_in: 'Repris',
  retired: 'Réformé',
};

export function lifecycleLabel(status: string): string {
  return LIFECYCLE_LABELS[status] ?? status;
}

export function canSeeMargin(role: string): boolean {
  return role === 'owner' || role === 'accountant';
}

export function canSeeExpenses(role: string): boolean {
  return role === 'owner' || role === 'manager' || role === 'accountant';
}

export function canSeeSalaries(role: string): boolean {
  return role === 'owner';
}

export function maxDiscount(role: string, storeMaxSeller: number, storeMaxManager: number): number {
  if (role === 'owner') return 100;
  if (role === 'manager') return storeMaxManager;
  return storeMaxSeller;
}

export function canEditPurchases(role: string): boolean {
  return role === 'owner' || role === 'manager';
}

export function canCancelSale(role: string): boolean {
  return role === 'owner' || role === 'manager';
}

export function canManageUsers(role: string): boolean {
  return role === 'owner';
}
