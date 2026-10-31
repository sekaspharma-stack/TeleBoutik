import { format } from 'date-fns';

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

export function formatDate(date: string | Date, formatStr: string = 'dd/MM/yyyy'): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return format(d, formatStr);
}

export function formatDateTime(date: string | Date): string {
  return formatDate(date, 'dd/MM/yyyy HH:mm');
}

export function todayStr(): string {
  return new Date().toISOString().split('T')[0];
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
