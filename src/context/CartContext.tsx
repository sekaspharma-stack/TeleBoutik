import { create } from 'zustand';
import type { SaleLine, SalePayment, Product, ProductVariant } from '../types';
import { generateId } from '../db/localDb';

export interface CartItem {
  key: string;
  variant: ProductVariant;
  product: Product;
  imeiUnitId: string | null;
  imei1: string | null;
  quantity: number;
  unitPrice: number;
  discount: number;
  isSerialized: boolean;
}

export interface AddItemResult {
  ok: boolean;
  /** Message à afficher à l'utilisateur lorsque l'ajout est refusé. */
  message?: string;
}

/** Nombre fini et >= 0, sinon 0 (NaN, Infinity, négatif, texte). */
const safeAmount = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const lineGross = (item: CartItem) => item.unitPrice * item.quantity;
const itemsSubtotal = (items: CartItem[]) => items.reduce((sum, i) => sum + lineGross(i) - i.discount, 0);

/**
 * Ré-applique les plafonds après toute modification du panier :
 *  - remise de ligne  <= montant brut de la ligne (prix x quantité) ;
 *  - remise globale   <= sous-total (après remises de lignes).
 */
function clampCart(items: CartItem[], globalDiscount: number): { items: CartItem[]; globalDiscount: number } {
  const clampedItems = items.map((i) => {
    const maxDiscount = lineGross(i);
    return i.discount > maxDiscount ? { ...i, discount: maxDiscount } : i;
  });
  const subtotal = Math.max(0, itemsSubtotal(clampedItems));
  return { items: clampedItems, globalDiscount: Math.min(safeAmount(globalDiscount), subtotal) };
}

interface CartState {
  items: CartItem[];
  globalDiscount: number;
  customerId: string | null;
  customerName: string;
  /** Détails du client sélectionné, pour l'aperçu dans le panier. */
  customerPhone: string;
  customerBalance: number;
  customerCreditLimit: number;
  clear: () => void;
  addItem: (product: Product, variant: ProductVariant, imeiUnitId?: string | null, imei1?: string | null) => AddItemResult;
  removeItem: (key: string) => void;
  updateQuantity: (key: string, qty: number) => void;
  updatePrice: (key: string, price: number) => void;
  applyWholesalePrice: (key: string) => void;
  updateItemDiscount: (key: string, discount: number) => void;
  setGlobalDiscount: (discount: number) => void;
  setCustomer: (id: string | null, name: string, details?: { phone?: string; balance?: number; creditLimit?: number }) => void;
  getSubtotal: () => number;
  getTotalDiscount: () => number;
  getTotal: () => number;
  toSaleLines: (saleId: string) => SaleLine[];
}

export const useCart = create<CartState>((set, get) => ({
  items: [],
  globalDiscount: 0,
  customerId: null,
  customerName: '',
  customerPhone: '',
  customerBalance: 0,
  customerCreditLimit: 0,

  clear: () => set({ items: [], globalDiscount: 0, customerId: null, customerName: '', customerPhone: '', customerBalance: 0, customerCreditLimit: 0 }),

  addItem: (product, variant, imeiUnitId = null, imei1 = null) => {
    const state = get();
    const currency = variant.currency_code || 'USD';
    if (state.items.length > 0 && state.items.some((item) => (item.variant.currency_code || 'USD') !== currency)) {
      return { ok: false, message: 'Un même ticket ne peut pas mélanger des produits en USD et en CDF. Termine ce ticket ou vide le panier avant de changer de devise.' };
    }
    const existingKey = `${variant.id}-${imeiUnitId ?? 'bulk'}`;
    const existing = state.items.find((i) => i.key === existingKey);

    if (existing) {
      if (existing.isSerialized) {
        return { ok: false, message: `Cet article est déjà dans le panier${imei1 ? ` (IMEI ${imei1})` : ''}. Un article sérialisé ne peut être vendu qu'une seule fois.` };
      }
      set(clampCart(
        state.items.map((i) => (i.key === existingKey ? { ...i, quantity: i.quantity + 1 } : i)),
        state.globalDiscount,
      ));
      return { ok: true };
    }
    set({
      items: [
        ...state.items,
        {
          key: existingKey,
          variant,
          product,
          imeiUnitId,
          imei1,
          quantity: 1,
          unitPrice: safeAmount(variant.sale_price),
          discount: 0,
          isSerialized: product.is_serialized,
        },
      ],
    });
    return { ok: true };
  },

  removeItem: (key) => set((s) => clampCart(s.items.filter((i) => i.key !== key), s.globalDiscount)),

  updateQuantity: (key, qty) =>
    set((s) => {
      const n = Number(qty);
      // Valeur invalide (NaN, Infinity) : on ignore la modification au lieu de corrompre le panier.
      if (!Number.isFinite(n)) return s;
      const quantity = Math.max(1, Math.floor(n));
      return clampCart(s.items.map((i) => (i.key === key ? { ...i, quantity: i.isSerialized ? 1 : quantity } : i)), s.globalDiscount);
    }),

  updatePrice: (key, price) =>
    set((s) => {
      const n = Number(price);
      if (!Number.isFinite(n)) return s;
      return clampCart(s.items.map((i) => (i.key === key ? { ...i, unitPrice: Math.max(0, n) } : i)), s.globalDiscount);
    }),

  applyWholesalePrice: (key) => set((s) => clampCart(
    s.items.map((i) => i.key === key && i.variant.wholesale_price > 0 ? { ...i, unitPrice: i.variant.wholesale_price } : i),
    s.globalDiscount,
  )),

  updateItemDiscount: (key, discount) =>
    set((s) => {
      const n = Number(discount);
      if (!Number.isFinite(n)) return s;
      return clampCart(
        s.items.map((i) => (i.key === key ? { ...i, discount: Math.min(Math.max(0, n), lineGross(i)) } : i)),
        s.globalDiscount,
      );
    }),

  setGlobalDiscount: (discount) =>
    set((s) => {
      const n = Number(discount);
      if (!Number.isFinite(n)) return s;
      return { globalDiscount: Math.min(Math.max(0, n), Math.max(0, itemsSubtotal(s.items))) };
    }),

  setCustomer: (id, name, details) => set({
    customerId: id,
    customerName: name,
    customerPhone: details?.phone ?? '',
    customerBalance: Number(details?.balance ?? 0) || 0,
    customerCreditLimit: Number(details?.creditLimit ?? 0) || 0,
  }),

  getSubtotal: () => {
    return get().items.reduce((sum, i) => {
      return sum + i.unitPrice * i.quantity - i.discount;
    }, 0);
  },

  getTotalDiscount: () => Math.min(get().globalDiscount, Math.max(0, get().getSubtotal())),

  getTotal: () => {
    const sub = get().getSubtotal();
    return Math.max(0, sub - get().getTotalDiscount());
  },

  toSaleLines: (saleId) => {
    return get().items.map((item) => ({
      id: generateId(),
      sale_id: saleId,
      variant_id: item.variant.id,
      imei_unit_id: item.imeiUnitId,
      product_name: `${item.product.brand} ${item.product.model}`,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      unit_cost: item.variant.purchase_price,
      discount: item.discount,
      line_total: item.unitPrice * item.quantity - item.discount,
    }));
  },
}));
