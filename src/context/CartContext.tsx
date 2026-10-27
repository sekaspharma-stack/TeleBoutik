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

interface CartState {
  items: CartItem[];
  globalDiscount: number;
  customerId: string | null;
  customerName: string;
  clear: () => void;
  addItem: (product: Product, variant: ProductVariant, imeiUnitId?: string | null, imei1?: string | null) => boolean;
  removeItem: (key: string) => void;
  updateQuantity: (key: string, qty: number) => void;
  updatePrice: (key: string, price: number) => void;
  applyWholesalePrice: (key: string) => void;
  updateItemDiscount: (key: string, discount: number) => void;
  setGlobalDiscount: (discount: number) => void;
  setCustomer: (id: string | null, name: string) => void;
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

  clear: () => set({ items: [], globalDiscount: 0, customerId: null, customerName: '' }),

  addItem: (product, variant, imeiUnitId = null, imei1 = null) => {
    const state = get();
    const currency = variant.currency_code || 'USD';
    if (state.items.length > 0 && state.items.some((item) => (item.variant.currency_code || 'USD') !== currency)) return false;
    const existingKey = `${variant.id}-${imeiUnitId ?? 'bulk'}`;
    const existing = state.items.find((i) => i.key === existingKey);

    if (existing) {
      if (existing.isSerialized) return true;
      set({
        items: state.items.map((i) =>
          i.key === existingKey ? { ...i, quantity: i.quantity + 1 } : i
        ),
      });
      return true;
    } else {
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
            unitPrice: variant.sale_price,
            discount: 0,
            isSerialized: product.is_serialized,
          },
        ],
      });
      return true;
    }
  },

  removeItem: (key) => set((s) => ({ items: s.items.filter((i) => i.key !== key) })),

  updateQuantity: (key, qty) =>
    set((s) => ({
      items: s.items.map((i) => (i.key === key ? { ...i, quantity: Math.max(1, qty) } : i)),
    })),

  updatePrice: (key, price) =>
    set((s) => ({
      items: s.items.map((i) => (i.key === key ? { ...i, unitPrice: Math.max(0, price) } : i)),
    })),

  applyWholesalePrice: (key) => set((s) => ({
    items: s.items.map((i) => i.key === key && i.variant.wholesale_price > 0 ? { ...i, unitPrice: i.variant.wholesale_price } : i),
  })),

  updateItemDiscount: (key, discount) =>
    set((s) => ({
      items: s.items.map((i) => (i.key === key ? { ...i, discount: Math.max(0, discount) } : i)),
    })),

  setGlobalDiscount: (discount) => set({ globalDiscount: Math.max(0, discount) }),

  setCustomer: (id, name) => set({ customerId: id, customerName: name }),

  getSubtotal: () => {
    return get().items.reduce((sum, i) => {
      return sum + i.unitPrice * i.quantity - i.discount;
    }, 0);
  },

  getTotalDiscount: () => {
    return get().globalDiscount;
  },

  getTotal: () => {
    const sub = get().getSubtotal();
    return Math.max(0, sub - get().globalDiscount);
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
