import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Search, Scan, Trash2, ShoppingCart, User, X, Plus, Minus, Printer, Check, Tag } from 'lucide-react';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { query, queryOne } from '../db/localDb';
import { completeSale, cancelSale } from '../db/saleService';
import { approveSensitiveAction } from '../db/operations';
import { addAuditLog, addSyncOp } from '../db/audit';
import { generateId, now, execute } from '../db/localDb';
import { formatCurrency, paymentLabel, maxDiscount } from '../lib/utils';
import type { Product, ProductVariant, ImeiUnit, Customer, SalePayment } from '../types';
import TicketModal from '../components/TicketModal';
import LoadingButton from '../components/LoadingButton';

interface SearchResult {
  product: Product;
  variant: ProductVariant;
  stock_qty: number;
  imei_available: number;
}

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Espèces' },
  { value: 'airtel_money', label: 'Airtel Money' },
] as const;

export default function POSPage() {
  const { user, store, cashSession, setCashSession } = useAuth();
  const cart = useCart();
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [showPayment, setShowPayment] = useState(false);
  const [showTicket, setShowTicket] = useState<string | null>(null);
  const [scanMode, setScanMode] = useState(false);
  const [loading, setLoading] = useState(false);
  // Verrou synchrone : empêche d'envoyer deux fois la même vente (double clic / double tap).
  const saleInFlight = useRef(false);
  const [error, setError] = useState('');
  const [showCustomerPicker, setShowCustomerPicker] = useState(false);
  const [saleRate, setSaleRate] = useState(0);
  const [exchangeRate, setExchangeRate] = useState(0);

  useEffect(() => {
    (async () => {
      const rows = await query<{ key: string; value: string }>("SELECT key, value FROM settings WHERE key IN ('usd_cdf_sale_rate','usd_cdf_exchange_rate')");
      const rates = Object.fromEntries(rows.map((r) => [r.key, Number(r.value)]));
      setSaleRate(Number.isFinite(rates.usd_cdf_sale_rate) ? rates.usd_cdf_sale_rate : 0);
      setExchangeRate(Number.isFinite(rates.usd_cdf_exchange_rate) ? rates.usd_cdf_exchange_rate : 0);
    })().catch((e) => console.warn('Taux de change indisponibles', e));
  }, []);

  const currency = cart.items[0]?.variant.currency_code || store?.currency || 'CDF';
  const decimals = store?.currency_decimals ?? 0;
  const maxDisc = user ? maxDiscount(user.role, store?.max_seller_discount ?? 5, store?.max_manager_discount ?? 10) : 0;

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const pattern = `%${q.toLowerCase()}%`;
    // Keep product and variant columns separate. Selecting p.* and pv.* together
    // creates a flat row with duplicate column names (notably id), while the POS
    // renderer expects { product, variant, ... }. That mismatch caused the blank
    // screen when it tried to read r.product.brand.
    type SearchRow = {
      p_id: string; p_brand: string; p_family: string; p_model: string;
      p_category: string; p_image_url: string | null; p_is_serialized: boolean;
      p_created_at: string; p_updated_at: string;
      v_id: string; v_product_id: string; v_sku: string; v_barcode: string;
      v_attributes: Record<string, string> | string; v_purchase_price: number;
      v_sale_price: number; v_wholesale_price: number; v_currency_code: string; v_min_stock: number;
      v_max_stock: number; v_created_at: string; v_updated_at: string;
      stock_qty: number; imei_available: number;
    };
    const rows = await query<SearchRow>(
      `SELECT
         p.id AS p_id, p.brand AS p_brand, p.family AS p_family,
         p.model AS p_model, p.category AS p_category, p.image_url AS p_image_url,
         p.is_serialized AS p_is_serialized, p.created_at AS p_created_at,
         p.updated_at AS p_updated_at,
         pv.id AS v_id, pv.product_id AS v_product_id, pv.sku AS v_sku,
         pv.barcode AS v_barcode, pv.attributes AS v_attributes,
         pv.purchase_price AS v_purchase_price, pv.sale_price AS v_sale_price,
         pv.wholesale_price AS v_wholesale_price, pv.currency_code AS v_currency_code, pv.min_stock AS v_min_stock,
         pv.max_stock AS v_max_stock, pv.created_at AS v_created_at,
         pv.updated_at AS v_updated_at,
         COALESCE(
           (SELECT SUM(CASE WHEN sm.direction = 'in' THEN sm.quantity ELSE -sm.quantity END)
            FROM stock_movements sm
            WHERE sm.variant_id = pv.id),
           0
         ) AS stock_qty,
         (SELECT COUNT(*) FROM imei_units
          WHERE variant_id = pv.id AND lifecycle_status = 'in_stock') AS imei_available
       FROM products p
       JOIN product_variants pv ON pv.product_id = p.id
       WHERE LOWER(p.brand) LIKE $1 OR LOWER(p.model) LIKE $1
          OR LOWER(pv.sku) LIKE $1 OR LOWER(pv.barcode) LIKE $1
       ORDER BY p.brand, p.model
       LIMIT 30`,
      [pattern]
    );
    setResults(rows.map((row) => {
      let attributes: Record<string, string> = {};
      if (typeof row.v_attributes === 'string') {
        try { attributes = JSON.parse(row.v_attributes || '{}'); } catch { attributes = {}; }
      } else if (row.v_attributes && typeof row.v_attributes === 'object') {
        attributes = row.v_attributes;
      }
      return {
        product: {
          id: row.p_id, brand: row.p_brand ?? '', family: row.p_family ?? '',
          model: row.p_model ?? '', category: row.p_category ?? '',
          image_url: row.p_image_url ?? null, is_serialized: Boolean(row.p_is_serialized),
          created_at: row.p_created_at, updated_at: row.p_updated_at,
        },
        variant: {
          id: row.v_id, product_id: row.v_product_id, sku: row.v_sku ?? '',
          barcode: row.v_barcode ?? '', attributes,
          purchase_price: Number(row.v_purchase_price ?? 0),
          sale_price: Number(row.v_sale_price ?? 0),
          wholesale_price: Number(row.v_wholesale_price ?? 0),
          currency_code: row.v_currency_code || 'USD',
          min_stock: Number(row.v_min_stock ?? 0), max_stock: Number(row.v_max_stock ?? 0),
          created_at: row.v_created_at, updated_at: row.v_updated_at,
        },
        stock_qty: Number(row.stock_qty ?? 0),
        imei_available: Number(row.imei_available ?? 0),
      };
    }));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => doSearch(searchQuery), 200);
    return () => clearTimeout(timer);
  }, [searchQuery, doSearch]);

  const handleBarcodeSearch = async () => {
    if (!searchQuery.trim()) return;
    const imeiMatch = await queryOne<{ pv_id: string; iu_id: string; imei1: string; p_id: string }>(
      `SELECT pv.id as pv_id, iu.id as iu_id, iu.imei1, pv.product_id as p_id
       FROM imei_units iu
       JOIN product_variants pv ON pv.id = iu.variant_id
       WHERE iu.imei1 = $1 AND iu.lifecycle_status = 'in_stock'`,
      [searchQuery.trim()]
    );
    if (imeiMatch) {
      const product = await queryOne<Product>('SELECT * FROM products WHERE id = $1', [imeiMatch.p_id]);
      const variant = await queryOne<ProductVariant>('SELECT * FROM product_variants WHERE id = $1', [imeiMatch.pv_id]);
      if (product && variant) {
        const added = cart.addItem(product, variant, imeiMatch.iu_id, imeiMatch.imei1);
        if (!added) setError('Un même ticket ne peut pas mélanger des produits en USD et en CDF. Termine ce ticket ou vide le panier avant de changer de devise.');
        setSearchQuery('');
        setScanMode(false);
        return;
      }
    }
    const barcodeMatch = await queryOne<{ p_id: string; pv_id: string }>(
      `SELECT pv.product_id as p_id, pv.id as pv_id FROM product_variants pv WHERE pv.barcode = $1 OR pv.sku = $1`,
      [searchQuery.trim()]
    );
    if (barcodeMatch) {
      const product = await queryOne<Product>('SELECT * FROM products WHERE id = $1', [barcodeMatch.p_id]);
      const variant = await queryOne<ProductVariant>('SELECT * FROM product_variants WHERE id = $1', [barcodeMatch.pv_id]);
      if (product && variant) {
        if (product.is_serialized) {
          const imei = await queryOne<ImeiUnit>(
            `SELECT * FROM imei_units WHERE variant_id = $1 AND lifecycle_status = 'in_stock' LIMIT 1`,
            [variant.id]
          );
          if (imei) {
            const added = cart.addItem(product, variant, imei.id, imei.imei1);
            if (!added) setError('Un même ticket ne peut pas mélanger des produits en USD et en CDF. Termine ce ticket ou vide le panier avant de changer de devise.');
          } else {
            setError('Aucun IMEI en stock pour ce modèle');
          }
        } else {
          const added = cart.addItem(product, variant);
          if (!added) setError('Un même ticket ne peut pas mélanger des produits en USD et en CDF. Termine ce ticket ou vide le panier avant de changer de devise.');
        }
        setSearchQuery('');
        setScanMode(false);
      }
    }
  };

  const handleAddProduct = async (result: SearchResult) => {
    setError('');
    if (result.product.is_serialized) {
      const imei = await queryOne<ImeiUnit>(
        `SELECT * FROM imei_units WHERE variant_id = $1 AND lifecycle_status = 'in_stock' LIMIT 1`,
        [result.variant.id]
      );
      if (!imei) {
        setError(`Aucun IMEI en stock pour ${result.product.brand} ${result.product.model}`);
        return;
      }
      const added = cart.addItem(result.product, result.variant, imei.id, imei.imei1);
      if (!added) setError('Un même ticket ne peut pas mélanger des produits en USD et en CDF. Termine ce ticket ou vide le panier avant de changer de devise.');
    } else {
      const added = cart.addItem(result.product, result.variant);
      if (!added) setError('Un même ticket ne peut pas mélanger des produits en USD et en CDF. Termine ce ticket ou vide le panier avant de changer de devise.');
    }
  };

  const handleCheckout = async () => {
    if (!user || !store) return;
    if (!cashSession) {
      setError('Veuillez ouvrir une session de caisse d\'abord');
      return;
    }
    if (cart.items.length === 0) return;
    setShowPayment(true);
  };

  if (!user || !store) return null;

  return (
    <div className="flex flex-col lg:flex-row gap-4 lg:h-[calc(100vh-60px)]">
      <div className="flex-1 flex flex-col min-h-[50vh] lg:min-h-0">
        <div className="mb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleBarcodeSearch()}
              placeholder="Rechercher par nom, SKU, code-barres ou scanner IMEI..."
              className="input pl-10 pr-12 text-base"
              autoFocus
            />
            <button
              onClick={() => { setScanMode(!scanMode); if (!scanMode) setSearchQuery(''); }}
              className={`absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg transition-colors ${scanMode ? 'bg-primary-100 text-primary-600' : 'text-slate-400 hover:bg-slate-100'}`}
            >
              <Scan className="w-5 h-5" />
            </button>
          </div>
          {error && (
            <p className="text-error-600 text-sm mt-2 animate-fade-in">{error}</p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {results.length > 0 ? (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
              {results.map((r) => (
                <button
                  key={r.variant.id}
                  onClick={() => handleAddProduct(r)}
                  className="card p-3 text-left hover:border-primary-300 hover:shadow-md transition-all active:scale-95"
                >
                  <div className="flex items-start justify-between mb-1">
                    <span className="text-xs font-medium text-primary-600">{r.product.brand}</span>
                    {r.product.is_serialized ? (
                      r.imei_available > 0 ? (
                        <span className="badge-success">{r.imei_available} en stock</span>
                      ) : (
                        <span className="badge-error">Rupture</span>
                      )
                    ) : (
                      <span className={r.stock_qty > 0 ? 'badge-success' : 'badge-error'}>
                        {r.stock_qty > 0 ? `${r.stock_qty} en stock` : 'Rupture'}
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-medium text-slate-800 truncate">
                    {r.product.model}
                  </p>
                  <p className="text-xs text-slate-400 truncate">
                    {r.variant.attributes && typeof r.variant.attributes === 'object'
                      ? Object.entries(r.variant.attributes as Record<string, string>).map(([k, v]) => v).join(' · ')
                      : ''}
                  </p>
                  <p className="text-base font-bold text-slate-900 mt-1">
                    {formatCurrency(r.variant.sale_price, currency, decimals)}
                  </p>
                </button>
              ))}
            </div>
          ) : (
            !searchQuery && (
              <div className="flex flex-col items-center justify-center h-full text-slate-400">
                <ShoppingCart className="w-16 h-16 mb-3 opacity-30" />
                <p className="text-sm">Recherchez un produit ou scannez un code-barres</p>
                <p className="text-xs mt-1">{cart.items.length} article(s) dans le panier</p>
              </div>
            )
          )}
        </div>
      </div>

      <div className="w-full lg:w-96 flex flex-col bg-white rounded-xl border border-slate-200 shadow-sm lg:max-h-full max-h-[40vh] lg:max-h-none shrink-0">
        <div className="p-3 border-b border-slate-200">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold text-slate-800 flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-primary-600" />
              Panier ({cart.items.length})
            </h2>
            {cart.items.length > 0 && (
              <button onClick={() => cart.clear()} className="text-xs text-slate-400 hover:text-error-600">
                Vider
              </button>
            )}
          </div>
          <button
            onClick={() => setShowCustomerPicker(true)}
            className="w-full flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-lg text-sm text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <User className="w-4 h-4" />
            {cart.customerName || 'Client de passage'}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {cart.items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-300">
              <Tag className="w-10 h-10 mb-2" />
              <p className="text-sm">Panier vide</p>
            </div>
          ) : (
            cart.items.map((item) => (
              <div key={item.key} className="bg-slate-50 rounded-lg p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">
                      {item.product.brand} {item.product.model}
                    </p>
                    <p className="text-xs text-slate-400">
                      {item.imei1 ? `IMEI: ${item.imei1}` : item.variant.sku}
                    </p>
                  </div>
                  <button
                    onClick={() => cart.removeItem(item.key)}
                    className="text-slate-300 hover:text-error-600 p-1"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  {!item.isSerialized && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => cart.updateQuantity(item.key, item.quantity - 1)}
                        className="w-7 h-7 rounded bg-white border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-100"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="w-8 text-center text-sm font-medium">{item.quantity}</span>
                      <button
                        onClick={() => cart.updateQuantity(item.key, item.quantity + 1)}
                        className="w-7 h-7 rounded bg-white border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-100"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                  {item.isSerialized && (
                    <span className="badge-primary text-[10px]">Unité unique</span>
                  )}
                  <div className="flex-1 text-right">
                    {item.variant.wholesale_price > 0 && <button type="button" onClick={() => cart.applyWholesalePrice(item.key)} className="text-[11px] text-primary-600 hover:underline block ml-auto mb-1">Prix de gros: {formatCurrency(item.variant.wholesale_price, currency, decimals)}</button>}
                    <input
                      type="number"
                      value={item.unitPrice}
                      onChange={(e) => cart.updatePrice(item.key, parseFloat(e.target.value) || 0)}
                      className="w-20 text-right text-sm border border-slate-200 rounded px-1 py-0.5"
                    />
                    <span className="text-xs text-slate-400 ml-1">{currency}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-sm font-semibold text-slate-800">
                    {formatCurrency(item.unitPrice * item.quantity - item.discount, currency, decimals)}
                  </span>
                  <input
                    type="number"
                    placeholder="Remise"
                    value={item.discount || ''}
                    onChange={(e) => cart.updateItemDiscount(item.key, parseFloat(e.target.value) || 0)}
                    className="w-20 text-right text-xs border border-slate-200 rounded px-1 py-0.5"
                  />
                </div>
              </div>
            ))
          )}
        </div>

        <div className="p-3 border-t border-slate-200 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500">Sous-total</span>
            <span className="font-medium">{formatCurrency(cart.getSubtotal(), currency, decimals)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500">Remise globale</span>
            <input
              type="number"
              value={cart.globalDiscount || ''}
              onChange={(e) => cart.setGlobalDiscount(parseFloat(e.target.value) || 0)}
              placeholder="0"
              className="w-24 text-right text-sm border border-slate-200 rounded px-2 py-1"
            />
          </div>
          {store.tax_enabled && store.tax_rate > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">TVA ({store.tax_rate}%)</span>
              <span className="font-medium">
                {formatCurrency(cart.getTotal() * store.tax_rate / 100, currency, decimals)}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between text-lg font-bold pt-2 border-t border-slate-100">
            <span className="text-slate-800">Total</span>
            <span className="text-primary-700">
              {formatCurrency(
                store.tax_enabled ? cart.getTotal() * (1 + store.tax_rate / 100) : cart.getTotal(),
                currency,
                decimals
              )}
            </span>
          </div>
          <button
            onClick={handleCheckout}
            disabled={cart.items.length === 0}
            className="btn-primary w-full text-base py-3"
          >
            <Check className="w-5 h-5" />
            Encaisser
          </button>
        </div>
      </div>

      {showPayment && (
        <PaymentModal
          onClose={() => setShowPayment(false)}
          saleRate={saleRate}
          exchangeRate={exchangeRate}
          onComplete={async ({ payments, changeCurrency, changeAmount }) => {
            if (saleInFlight.current) return;
            saleInFlight.current = true;
            setLoading(true);
            setError('');
            try {
              const discountAmount = cart.globalDiscount + cart.items.reduce((sum, item) => sum + item.discount, 0);
              const discountPercent = cart.getSubtotal() > 0 ? (discountAmount / cart.getSubtotal()) * 100 : 0;
              if (discountPercent > maxDisc + 0.0001) {
                const managerPin = window.prompt(`Remise de ${discountPercent.toFixed(1)} % supérieure à votre limite de ${maxDisc} %. Saisis le PIN d’un autre gérant/propriétaire pour autoriser cette remise :`);
                if (!managerPin) throw new Error('Remise annulée : validation du gérant requise.');
                await approveSensitiveAction({ storeId: store.id, action: 'sale_discount', requesterId: user.id, managerPin, reason: `Remise ${discountPercent.toFixed(2)} % sur panier de ${cart.getSubtotal()}` });
              }
              const taxAmount = store.tax_enabled
                ? cart.getTotal() * store.tax_rate / 100
                : 0;
              const sale = await completeSale(
                {
                  items: cart.items.map((i) => ({
                    variant_id: i.variant.id,
                    imei_unit_id: i.imeiUnitId,
                    product_name: `${i.product.brand} ${i.product.model}`,
                    quantity: i.quantity,
                    unit_price: i.unitPrice,
                    unit_cost: i.variant.purchase_price,
                    discount: i.discount,
                  })),
                  payments,
                  subtotal: cart.getSubtotal(),
                  discount: cart.globalDiscount,
                  tax_amount: taxAmount,
                  total: cart.getTotal() + taxAmount,
                  customer_id: cart.customerId,
                  customer_name: cart.customerName,
                  currency_code: currency,
                  exchange_rate: saleRate || 1,
                  exchange_rate_buy: exchangeRate || 1,
                  change_currency: changeCurrency,
                  change_amount: changeAmount,
                },
                user,
                store,
                cashSession!.id
              );
              cart.clear();
              setShowPayment(false);
              setShowTicket(sale.id);
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Erreur lors de la vente');
            } finally {
              setLoading(false);
              saleInFlight.current = false;
            }
          }}
          total={store.tax_enabled ? cart.getTotal() * (1 + store.tax_rate / 100) : cart.getTotal()}
          currency={currency}
          decimals={decimals}
          loading={loading}
          dualCurrency={currency === 'USD'}
        />
      )}

      {showTicket && (
        <TicketModal saleId={showTicket} onClose={() => setShowTicket(null)} />
      )}

      {showCustomerPicker && (
        <CustomerPickerModal
          onSelect={(c) => {
            cart.setCustomer(c?.id ?? null, c?.name ?? '');
            setShowCustomerPicker(false);
          }}
          onClose={() => setShowCustomerPicker(false)}
        />
      )}
    </div>
  );
}

function PaymentModal({
  onClose,
  onComplete,
  total,
  currency,
  decimals,
  loading,
  saleRate,
  exchangeRate,
  dualCurrency,
}: {
  onClose: () => void;
  onComplete: (result: { payments: Array<{ payment_method: SalePayment['payment_method']; amount: number; reference: string | null; currency_code: string; original_amount: number; applied_rate: number }>; changeCurrency: string; changeAmount: number }) => void | Promise<void>;
  total: number;
  currency: string;
  decimals: number;
  loading: boolean;
  saleRate: number;
  exchangeRate: number;
  dualCurrency: boolean;
}) {
  const [methods, setMethods] = useState<Array<{ payment_method: string; amount: string; reference: string; currency_code: string }>>([
    { payment_method: 'cash', amount: total.toFixed(decimals), reference: '', currency_code: currency },
  ]);
  const [changeCurrency, setChangeCurrency] = useState<'USD' | 'CDF'>('USD');
  const validRates = saleRate > 0 && exchangeRate > 0 && exchangeRate < saleRate;
  const paidTotal = methods.reduce((sum, m) => { const amount = parseFloat(m.amount) || 0; return sum + (dualCurrency && m.currency_code === 'CDF' && validRates ? amount / saleRate : amount); }, 0);
  const remaining = total - paidTotal;
  const rawOverpayment = Math.max(0, -remaining);
  const cashChange = methods.length === 1 && methods[0].payment_method === 'cash' ? (() => {
    const m = methods[0]; const amount = parseFloat(m.amount) || 0;
    if (dualCurrency && m.currency_code === 'CDF' && validRates) {
      const excessCdf = Math.max(0, amount - total * saleRate);
      return changeCurrency === 'USD' ? excessCdf / exchangeRate : excessCdf;
    }
    return changeCurrency === 'CDF' && validRates ? rawOverpayment * exchangeRate : rawOverpayment;
  })() : 0;

  const addMethod = () => {
    if (methods.length >= 4) return;
    setMethods([...methods, { payment_method: 'cash', amount: Math.max(0, remaining).toFixed(decimals), reference: '', currency_code: currency }]);
  };

  const updateMethod = (idx: number, field: 'payment_method' | 'amount' | 'reference' | 'currency_code', value: string) => {
    setMethods(methods.map((m, i) => {
      if (i !== idx) return m;
      if (field === 'currency_code' && dualCurrency && validRates) {
        const current = parseFloat(m.amount) || 0;
        const base = m.currency_code === 'CDF' ? current / saleRate : current;
        return { ...m, currency_code: value, amount: (value === 'CDF' ? base * saleRate : base).toFixed(value === 'CDF' ? 0 : decimals) };
      }
      return { ...m, [field]: value };
    }));
  };

  const removeMethod = (idx: number) => {
    setMethods(methods.filter((_, i) => i !== idx));
  };

  const handleConfirm = async () => {
    const payments = methods
      .filter((m) => parseFloat(m.amount) > 0)
      .map((m) => ({
        payment_method: m.payment_method as SalePayment['payment_method'],
        amount: dualCurrency && m.currency_code === 'CDF' && validRates ? (parseFloat(m.amount) || 0) / saleRate : (parseFloat(m.amount) || 0),
        reference: m.reference || null,
        currency_code: m.currency_code,
        original_amount: parseFloat(m.amount) || 0,
        applied_rate: dualCurrency && m.currency_code === 'CDF' && validRates ? saleRate : 1,
      }));
    if (payments.length === 0) return;
    return onComplete({ payments, changeCurrency, changeAmount: cashChange });
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 animate-fade-in" onClick={() => { if (!loading) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">Encaissement</h2>
          <button onClick={onClose} disabled={loading} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="bg-primary-50 rounded-lg p-3 text-center">
            <p className="text-sm text-primary-600">Total à payer</p>
            <p className="text-2xl font-bold text-primary-700">{formatCurrency(total, currency, decimals)}</p>
          </div>

          {methods.map((m, idx) => (
            <div key={idx} className="border border-slate-200 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">Paiement {idx + 1}</span>
                {methods.length > 1 && (
                  <button onClick={() => removeMethod(idx)} className="text-slate-300 hover:text-error-600">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              <select
                value={m.payment_method}
                onChange={(e) => updateMethod(idx, 'payment_method', e.target.value)}
                className="input"
              >
                {PAYMENT_METHODS.map((pm) => (
                  <option key={pm.value} value={pm.value}>{pm.label}</option>
                ))}
              </select>
              <div className="flex gap-2">
                {dualCurrency && (
                  <select value={m.currency_code} onChange={(e) => updateMethod(idx, 'currency_code', e.target.value)} className="input w-24" disabled={!validRates}>
                    <option value="USD">USD</option><option value="CDF">CDF</option>
                  </select>
                )}
                <input
                  type="number"
                  value={m.amount}
                  onChange={(e) => updateMethod(idx, 'amount', e.target.value)}
                  placeholder={`Montant ${m.currency_code}`}
                  className="input flex-1"
                />
                {m.payment_method === 'airtel_money' && (
                  <input
                    type="text"
                    value={m.reference}
                    onChange={(e) => updateMethod(idx, 'reference', e.target.value)}
                    placeholder="ID transaction"
                    className="input flex-1"
                  />
                )}
              </div>
            </div>
          ))}

          {dualCurrency && !validRates && <p className="text-sm text-error-600">Configure d’abord les deux taux USD/CDF dans Paramètres → Finance. Les taux doivent être positifs et le taux d’échange inférieur au taux de vente.</p>}
          {dualCurrency && <div className="rounded-lg bg-slate-50 p-3 space-y-2"><label className="label">Monnaie à rendre (si trop-perçu)</label><select value={changeCurrency} onChange={(e) => setChangeCurrency(e.target.value as 'USD' | 'CDF')} className="input"><option value="USD">USD (dollars)</option><option value="CDF">CDF (francs congolais)</option></select><p className="text-sm text-slate-600">Monnaie à rendre estimée : {cashChange.toLocaleString('fr-FR', { maximumFractionDigits: changeCurrency === 'CDF' ? 0 : 2 })} {changeCurrency}{changeCurrency === 'USD' && methods.some((m) => m.currency_code === 'CDF') ? ` — taux d’échange ${exchangeRate.toLocaleString('fr-FR')} CDF/USD` : ''}</p></div>}
          {remaining > 0 && methods.length < 4 && (
            <button onClick={addMethod} className="btn-secondary w-full">
              <Plus className="w-4 h-4" /> Ajouter un mode de paiement
            </button>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-slate-100">
            <div>
              <p className="text-sm text-slate-500">
                {remaining > 0
                  ? `Reste: ${formatCurrency(remaining, currency, decimals)}`
                  : remaining < 0
                  ? `Monnaie: ${formatCurrency(-remaining, currency, decimals)}`
                  : 'Tout payé'}
              </p>
            </div>
            <LoadingButton
              onClick={handleConfirm}
              loading={loading}
              loadingText="Traitement…"
              disabled={remaining > 0.01 || (remaining < -0.01 && (methods.length !== 1 || methods[0].payment_method !== 'cash')) || (dualCurrency && !validRates)}
              className="btn-primary"
            >
              Valider la vente
            </LoadingButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function CustomerPickerModal({
  onSelect,
  onClose,
}: {
  onSelect: (customer: Customer | null) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Customer[]>([]);

  useEffect(() => {
    if (!search.trim()) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      const pattern = `%${search.toLowerCase()}%`;
      setResults(await query<Customer>(
        'SELECT * FROM customers WHERE LOWER(name) LIKE $1 OR phone LIKE $1 LIMIT 20',
        [pattern]
      ));
    }, 200);
    return () => clearTimeout(timer);
  }, [search]);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">Sélectionner un client</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Nom ou téléphone..."
            className="input mb-3"
            autoFocus
          />
          <button
            onClick={() => onSelect(null)}
            className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-slate-50 text-sm text-slate-600 mb-2"
          >
            <User className="w-4 h-4 inline mr-2" />
            Client de passage (sans compte)
          </button>
          {results.map((c) => (
            <button
              key={c.id}
              onClick={() => onSelect(c)}
              className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-primary-50 text-sm"
            >
              <p className="font-medium text-slate-800">{c.name}</p>
              <p className="text-xs text-slate-400">{c.phone}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
