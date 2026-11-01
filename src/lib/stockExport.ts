/** Valorisation et export de l'inventaire. Les montants ne sont JAMAIS additionnés entre devises différentes. */
export interface ValuableItem {
  product: { brand: string; model: string; category: string; is_serialized: boolean };
  variant: { sku: string; barcode: string; currency_code?: string; purchase_price: number; sale_price: number; min_stock: number };
  stock_qty: number;
  imei_in_stock: number;
  imei_cost_in_stock: number;
}

export interface CurrencyTotals { qty: number; cost: number; sale: number }

export const stockQty = (i: ValuableItem): number =>
  Math.max(0, i.product.is_serialized ? i.imei_in_stock : i.stock_qty);

/** Valeur d'achat : coût réel des IMEI en stock pour les téléphones, quantité × prix d'achat pour le reste. */
export const purchaseValue = (i: ValuableItem): number =>
  i.product.is_serialized ? i.imei_cost_in_stock : stockQty(i) * i.variant.purchase_price;

export const saleValue = (i: ValuableItem): number => stockQty(i) * i.variant.sale_price;

export function totalsByCurrency(items: ValuableItem[], fallbackCurrency: string): Record<string, CurrencyTotals> {
  const out: Record<string, CurrencyTotals> = {};
  for (const i of items) {
    const cur = i.variant.currency_code || fallbackCurrency;
    const t = (out[cur] ??= { qty: 0, cost: 0, sale: 0 });
    t.qty += stockQty(i);
    t.cost += purchaseValue(i);
    t.sale += saleValue(i);
  }
  return out;
}

const cell = (v: unknown) => `"${(v == null ? '' : String(v)).replace(/"/g, '""')}"`;
const num = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');

/** Télécharge l'inventaire valorisé en CSV (séparateur « ; », ouverture directe dans Excel). */
export function exportStockCsv(items: ValuableItem[], opts: { fallbackCurrency: string; includeCosts: boolean }): void {
  const head = ['Marque', 'Modèle', 'Catégorie', 'SKU', 'Code-barres', 'Type', 'Devise', 'Quantité en stock', 'Stock minimum', 'Prix de vente', 'Valeur de vente'];
  if (opts.includeCosts) head.push('Prix d’achat', 'Valeur d’achat', 'Marge potentielle');
  const rows = items.map((i) => {
    const row: unknown[] = [i.product.brand, i.product.model, i.product.category, i.variant.sku, i.variant.barcode,
      i.product.is_serialized ? 'Téléphone (IMEI)' : 'Accessoire', i.variant.currency_code || opts.fallbackCurrency,
      stockQty(i), i.variant.min_stock, num(i.variant.sale_price), num(saleValue(i))];
    if (opts.includeCosts) row.push(num(i.variant.purchase_price), num(purchaseValue(i)), num(saleValue(i) - purchaseValue(i)));
    return row;
  });
  const totals = Object.entries(totalsByCurrency(items, opts.fallbackCurrency)).map(([cur, t]) => {
    const row: unknown[] = ['TOTAL', '', '', '', '', '', cur, t.qty, '', '', num(t.sale)];
    if (opts.includeCosts) row.push('', num(t.cost), num(t.sale - t.cost));
    return row;
  });
  const csv = [head, ...rows, [], ...totals].map((r) => r.map(cell).join(';')).join('\r\n');
  const date = new Date().toLocaleDateString('en-CA');
  const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = `teleboutik-inventaire-${date}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
