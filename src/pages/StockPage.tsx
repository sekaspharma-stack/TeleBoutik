import { useState, useEffect, useCallback } from 'react';
import { Search, Package, Smartphone, Plus, X, Edit2, Tag, AlertTriangle, Archive } from 'lucide-react';
import { query, queryOne, execute, generateId, now } from '../db/localDb';
import { addAuditLog } from '../db/audit';
import { useAuth } from '../context/AuthContext';
import { formatCurrency, lifecycleLabel, canSeeMargin, generateBarcode, generateSku } from '../lib/utils';
import type { Product, ProductVariant, ImeiUnit } from '../types';
import LoadingButton from '../components/LoadingButton';
import SoldImeiArchive from '../components/SoldImeiArchive';

interface StockItem {
  product: Product;
  variant: ProductVariant;
  stock_qty: number;
  imei_count: number;
  imei_in_stock: number;
  imei_sold: number;
}

export default function StockPage() {
  const { user, store } = useAuth();
  const [items, setItems] = useState<StockItem[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'phones' | 'accessories' | 'low'>('all');
  const [showAdd, setShowAdd] = useState(false);
  const [showImeis, setShowImeis] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<StockItem | null>(null);
  const [tab, setTab] = useState<'active' | 'archive'>('active');
  const [archiveSearch, setArchiveSearch] = useState('');

  const loadStock = useCallback(async () => {
    const rows = await query<{
      p_id: string; p_brand: string; p_family: string; p_model: string; p_category: string;
      p_image_url: string | null; p_is_serialized: boolean; p_created_at: string; p_updated_at: string;
      pv_id: string; pv_sku: string; pv_barcode: string; pv_attributes: string;
      pv_purchase_price: number; pv_sale_price: number; pv_wholesale_price: number; pv_currency_code: string;
      pv_min_stock: number; pv_max_stock: number; pv_created_at: string; pv_updated_at: string;
      stock_qty: number; imei_count: number; imei_in_stock: number; imei_sold: number;
    }>(`
      SELECT p.id as p_id, p.brand as p_brand, p.family as p_family, p.model as p_model,
             p.category as p_category, p.image_url as p_image_url, p.is_serialized as p_is_serialized,
             p.created_at as p_created_at, p.updated_at as p_updated_at,
             pv.id as pv_id, pv.sku as pv_sku, pv.barcode as pv_barcode, pv.attributes as pv_attributes,
             pv.purchase_price as pv_purchase_price, pv.sale_price as pv_sale_price,
             pv.wholesale_price as pv_wholesale_price, pv.currency_code as pv_currency_code, pv.min_stock as pv_min_stock,
             pv.max_stock as pv_max_stock, pv.created_at as pv_created_at, pv.updated_at as pv_updated_at,
             COALESCE(
               (SELECT SUM(CASE WHEN direction='in' THEN quantity ELSE -quantity END)
                FROM stock_movements WHERE variant_id = pv.id), 0
             ) as stock_qty,
             (SELECT COUNT(*) FROM imei_units WHERE variant_id = pv.id) as imei_count,
             (SELECT COUNT(*) FROM imei_units WHERE variant_id = pv.id AND lifecycle_status = 'in_stock') as imei_in_stock,
             (SELECT COUNT(*) FROM imei_units WHERE variant_id = pv.id AND lifecycle_status <> 'in_stock') as imei_sold
      FROM products p
      JOIN product_variants pv ON pv.product_id = p.id
      ORDER BY p.brand, p.model
    `);

    const mapped: StockItem[] = rows.map((r) => ({
      product: {
        id: r.p_id, brand: r.p_brand, family: r.p_family, model: r.p_model,
        category: r.p_category, image_url: r.p_image_url, is_serialized: r.p_is_serialized,
        created_at: r.p_created_at, updated_at: r.p_updated_at,
      },
      variant: {
        id: r.pv_id, product_id: r.p_id, sku: r.pv_sku, barcode: r.pv_barcode,
        attributes: typeof r.pv_attributes === 'string' ? JSON.parse(r.pv_attributes) : r.pv_attributes,
        purchase_price: r.pv_purchase_price, sale_price: r.pv_sale_price,
        wholesale_price: r.pv_wholesale_price, currency_code: r.pv_currency_code || 'USD', min_stock: r.pv_min_stock, max_stock: r.pv_max_stock,
        created_at: r.pv_created_at, updated_at: r.pv_updated_at,
      },
      stock_qty: r.stock_qty,
      imei_count: r.imei_count,
      imei_in_stock: Number(r.imei_in_stock),
      imei_sold: Number(r.imei_sold),
    }));

    setItems(mapped);
  }, []);

  useEffect(() => { loadStock(); }, [loadStock]);

  if (!user || !store) return null;
  const showMargin = canSeeMargin(user.role);
  const currency = store.currency;
  const decimals = store.currency_decimals;

  const filtered = items.filter((item) => {
    const q = search.toLowerCase();
    const matches = !q ||
      item.product.brand.toLowerCase().includes(q) ||
      item.product.model.toLowerCase().includes(q) ||
      item.variant.sku.toLowerCase().includes(q);
    if (!matches) return false;
    if (filter === 'phones') return item.product.is_serialized;
    if (filter === 'accessories') return !item.product.is_serialized;
    if (filter === 'low') {
      const qty = item.product.is_serialized ? item.imei_in_stock : item.stock_qty;
      return qty <= item.variant.min_stock;
    }
    return true;
  });

  const totalStockValue = items.reduce((sum, i) => {
    const qty = i.product.is_serialized ? i.imei_in_stock : Math.max(0, i.stock_qty);
    return sum + qty * i.variant.purchase_price;
  }, 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Stock & Inventaire</h1>
          <p className="text-sm text-slate-500">
            {items.length} références · Valeur stock: {showMargin ? formatCurrency(totalStockValue, currency, decimals) : '—'}
          </p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary">
          <Plus className="w-4 h-4" /> Nouveau produit
        </button>
      </div>

      <div className="mb-4 inline-flex rounded-xl border border-slate-200 bg-white p-1" role="tablist" aria-label="Sections du stock">
        <button role="tab" aria-selected={tab === 'active'} onClick={() => setTab('active')} className={`rounded-lg px-4 py-1.5 text-sm font-semibold ${tab === 'active' ? 'bg-primary-600 text-white' : 'text-slate-600'}`}>Stock actif</button>
        <button role="tab" aria-selected={tab === 'archive'} onClick={() => setTab('archive')} className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-semibold ${tab === 'archive' ? 'bg-primary-600 text-white' : 'text-slate-600'}`}><Archive className="h-4 w-4" />Archive vendus (IMEI)</button>
      </div>

      {tab === 'archive' ? <SoldImeiArchive key={archiveSearch} initialSearch={archiveSearch} /> : (<>
      <div className="mb-4 flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher..."
            className="input pl-9"
          />
        </div>
        <button
          onClick={() => setFilter('all')}
          className={filter === 'all' ? 'btn-primary' : 'btn-secondary'}
        >Tous</button>
        <button
          onClick={() => setFilter('phones')}
          className={filter === 'phones' ? 'btn-primary' : 'btn-secondary'}
        >Téléphones</button>
        <button
          onClick={() => setFilter('accessories')}
          className={filter === 'accessories' ? 'btn-primary' : 'btn-secondary'}
        >Accessoires</button>
        <button
          onClick={() => setFilter('low')}
          className={filter === 'low' ? 'btn-danger' : 'btn-secondary'}
        >
          <AlertTriangle className="w-4 h-4" /> Stock bas
        </button>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[600px]">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium text-slate-600">Produit</th>
              <th className="text-left px-4 py-2.5 font-medium text-slate-600">SKU</th>
              <th className="text-right px-4 py-2.5 font-medium text-slate-600">Stock</th>
              {showMargin && <th className="text-right px-4 py-2.5 font-medium text-slate-600">PA</th>}
              <th className="text-right px-4 py-2.5 font-medium text-slate-600">PV</th>
              <th className="text-center px-4 py-2.5 font-medium text-slate-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((item) => {
              const qty = item.product.is_serialized ? item.imei_in_stock : item.stock_qty;
              const isLow = qty <= item.variant.min_stock;
              return (
                <tr key={item.variant.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      {item.product.is_serialized ? (
                        <Smartphone className="w-4 h-4 text-slate-400" />
                      ) : (
                        <Package className="w-4 h-4 text-slate-400" />
                      )}
                      <div>
                        <p className="font-medium text-slate-800">{item.product.brand} {item.product.model}</p>
                        <p className="text-xs text-slate-400">
                          {item.variant.attributes && typeof item.variant.attributes === 'object'
                            ? Object.entries(item.variant.attributes as Record<string, string>).map(([k, v]) => v).join(' · ')
                            : item.product.category}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-500 font-mono">{item.variant.sku}</td>
                  <td className="px-4 py-2.5 text-right">
                    <span className={isLow ? 'text-error-600 font-bold' : 'text-slate-700'}>
                      {qty}
                    </span>
                    {item.product.is_serialized && item.imei_in_stock === 0 && item.imei_sold > 0 && (
                      <button
                        onClick={() => { setArchiveSearch(`${item.product.brand} ${item.product.model}`); setTab('archive'); }}
                        className="ml-2 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600"
                        title="Épuisé : les unités vendues restent tracées dans l'archive"
                      >
                        <Archive className="h-3 w-3" /> Épuisé · {item.imei_sold} archivé(s)
                      </button>
                    )}
                    {item.product.is_serialized && item.imei_in_stock > 0 && (
                      <button
                        onClick={() => setShowImeis(item.variant.id)}
                        className="ml-2 text-xs text-primary-600 hover:underline"
                      >
                        Voir IMEI
                      </button>
                    )}
                  </td>
                  {showMargin && (
                    <td className="px-4 py-2.5 text-right text-slate-600">
                      {formatCurrency(item.variant.purchase_price, item.variant.currency_code || currency, (item.variant.currency_code || currency) === 'CDF' ? 0 : 2)}
                    </td>
                  )}
                  <td className="px-4 py-2.5 text-right font-medium text-slate-800">
                    {formatCurrency(item.variant.sale_price, item.variant.currency_code || currency, (item.variant.currency_code || currency) === 'CDF' ? 0 : 2)}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <div className="flex justify-center gap-1">
                      <button title="Modifier les prix sans modifier le stock" onClick={() => setEditingItem(item)} className="text-slate-400 hover:text-primary-600 p-1">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button title="Voir les IMEI / unités" onClick={() => setShowImeis(item.variant.id)} className="text-slate-400 hover:text-primary-600 p-1">
                        <Tag className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="p-8 text-center text-slate-400 text-sm">Aucun produit trouvé</div>
        )}
      </div>
      </>)}

      {showAdd && (
        <AddProductModal
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); loadStock(); }}
        />
      )}

      {editingItem && (
        <EditProductPricesModal item={editingItem} onClose={() => setEditingItem(null)} onSaved={() => { setEditingItem(null); loadStock(); }} />
      )}

      {showImeis && (
        <ImeiListModal
          variantId={showImeis}
          onClose={() => setShowImeis(null)}
        />
      )}
    </div>
  );
}

function AddProductModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { user, store } = useAuth();
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [category, setCategory] = useState('telephone');
  const [isSerialized, setIsSerialized] = useState(true);
  const [color, setColor] = useState('');
  const [capacity, setCapacity] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [salePrice, setSalePrice] = useState('');
  const [wholesalePrice, setWholesalePrice] = useState('');
  const [initialQuantity, setInitialQuantity] = useState('1');
  const [priceCurrency, setPriceCurrency] = useState<'USD' | 'CDF'>((store?.currency === 'CDF' ? 'CDF' : 'USD'));
  const [imei, setImei] = useState('');
  const [imei2, setImei2] = useState('');

  if (!user || !store) return null;

  const handleSave = async () => {
    if (!brand || !model) return;
    if (isSerialized && imei) {
      if (!/^\d{15}$/.test(imei.trim())) { window.alert('L’IMEI doit contenir exactement 15 chiffres.'); return; }
      // Traçabilité : un même IMEI ne peut exister qu'une fois, qu'il soit en stock ou déjà vendu.
      const clash = await queryOne<{ id: string }>('SELECT id FROM imei_units WHERE imei1 = $1 OR imei2 = $1 OR imei1 = $2 OR imei2 = $2 LIMIT 1', [imei.trim(), imei2.trim() || '__none__']);
      if (clash) { window.alert('Cet IMEI existe déjà (en stock ou archivé parmi les articles vendus). Vérifie le numéro.'); return; }
    }
    const productId = generateId();
    const attrs: Record<string, string> = {};
    if (color) attrs['Couleur'] = color;
    if (capacity) attrs['Capacité'] = capacity;
    if (isSerialized) attrs['État'] = 'Neuf';
    else attrs['Qualité'] = 'Original';

    const variantId = generateId();
    const sku = generateSku(brand, model, Object.values(attrs).join('-'));
    const barcode = generateBarcode();

    await execute(
      `INSERT INTO products (id, brand, family, model, category, is_serialized, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [productId, brand, category, model, category, isSerialized, now(), now()]
    );

    await execute(
      `INSERT INTO product_variants (id, product_id, sku, barcode, attributes, purchase_price, sale_price, wholesale_price, currency_code, min_stock, max_stock, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 5, 100, $10, $11)`,
      [variantId, productId, sku, barcode, JSON.stringify(attrs),
       parseFloat(purchasePrice) || 0, parseFloat(salePrice) || 0, parseFloat(wholesalePrice) || 0, priceCurrency, now(), now()]
    );

    if (isSerialized && imei) {
      const imeiId = generateId();
      await execute(
        `INSERT INTO imei_units (id, variant_id, imei1, imei2, lifecycle_status, cost, grade, received_at)
         VALUES ($1, $2, $3, $4, 'in_stock', $5, 'new', $6)`,
        [imeiId, variantId, imei, imei2 || null, parseFloat(purchasePrice) || 0, now()]
      );
      await execute(
        `INSERT INTO stock_movements (id, variant_id, imei_unit_id, movement_type, direction, quantity, unit_cost, reference_type, user_id, reason, created_at)
         VALUES ($1, $2, $3, 'purchase', 'in', 1, $4, 'manual_entry', $5, 'Entrée manuelle', $6)`,
        [generateId(), variantId, imeiId, parseFloat(purchasePrice) || 0, user.id, now()]
      );
    } else if (!isSerialized) {
      await execute(
        `INSERT INTO stock_movements (id, variant_id, movement_type, direction, quantity, unit_cost, reference_type, user_id, reason, created_at)
         VALUES ($1, $2, 'purchase', 'in', $3, $4, 'manual_entry', $5, 'Stock initial', $6)`,
        [generateId(), variantId, Math.max(0, Math.floor(Number(initialQuantity) || 0)), parseFloat(purchasePrice) || 0, user.id, now()]
      );
    }

    await addAuditLog(user, 'product', 'create', null, { brand, model, sku });
    onSaved();
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md animate-scale-in max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white">
          <h2 className="text-lg font-semibold text-slate-800">Nouveau produit</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex gap-2">
            <button
              onClick={() => { setIsSerialized(true); setCategory('telephone'); }}
              className={`flex-1 p-3 rounded-lg border-2 transition-all ${isSerialized ? 'border-primary-500 bg-primary-50' : 'border-slate-200'}`}
            >
              <Smartphone className="w-5 h-5 mx-auto mb-1" />
              <span className="text-xs">Téléphone (IMEI)</span>
            </button>
            <button
              onClick={() => { setIsSerialized(false); setCategory('accessoire'); }}
              className={`flex-1 p-3 rounded-lg border-2 transition-all ${!isSerialized ? 'border-primary-500 bg-primary-50' : 'border-slate-200'}`}
            >
              <Package className="w-5 h-5 mx-auto mb-1" />
              <span className="text-xs">Accessoire</span>
            </button>
          </div>
          <div>
            <label className="label">Marque</label>
            <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Samsung, Tecno, iPhone..." className="input" />
          </div>
          <div>
            <label className="label">Modèle</label>
            <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Galaxy A15, iPhone 13..." className="input" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Couleur</label>
              <input value={color} onChange={(e) => setColor(e.target.value)} placeholder="Noir" className="input" />
            </div>
            <div>
              <label className="label">Capacité</label>
              <input value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="128 Go" className="input" />
            </div>
          </div>
          <div>
            <label className="label">Devise du produit</label>
            <select value={priceCurrency} onChange={(e) => setPriceCurrency(e.target.value as 'USD' | 'CDF')} className="input">
              <option value="USD">USD — Dollar américain</option>
              <option value="CDF">CDF — Franc congolais</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Prix d'achat ({priceCurrency})</label>
              <input type="number" step={priceCurrency === 'CDF' ? '1' : '0.01'} value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} placeholder="50000" className="input" />
            </div>
            <div>
              <label className="label">Prix de vente ({priceCurrency})</label>
              <input type="number" step={priceCurrency === 'CDF' ? '1' : '0.01'} value={salePrice} onChange={(e) => setSalePrice(e.target.value)} placeholder="65000" className="input" />
            </div>
          </div>
          {!isSerialized && <div><label className="label">Quantité initiale en stock</label><input type="number" min="0" step="1" value={initialQuantity} onChange={(e) => setInitialQuantity(e.target.value)} className="input" placeholder="Ex. 25 écouteurs" /></div>}
          <div><label className="label">Prix de gros ({priceCurrency})</label><input type="number" min="0" step={priceCurrency === 'CDF' ? '1' : '0.01'} value={wholesalePrice} onChange={(e) => setWholesalePrice(e.target.value)} className="input" placeholder="Prix appliqué aux ventes en gros" /></div>
          {isSerialized && (
            <>
              <div>
                <label className="label">IMEI 1</label>
                <input value={imei} onChange={(e) => setImei(e.target.value)} placeholder="15 chiffres" className="input font-mono" maxLength={15} />
              </div>
              <div>
                <label className="label">IMEI 2 (optionnel)</label>
                <input value={imei2} onChange={(e) => setImei2(e.target.value)} placeholder="15 chiffres" className="input font-mono" maxLength={15} />
              </div>
            </>
          )}
          <LoadingButton onClick={handleSave} disabled={!brand || !model} loadingText="Enregistrement…" className="btn-primary w-full">
            Enregistrer
          </LoadingButton>
        </div>
      </div>
    </div>
  );
}


function EditProductPricesModal({ item, onClose, onSaved }: { item: StockItem; onClose: () => void; onSaved: () => void }) {
  const { user, store } = useAuth();
  const [salePrice, setSalePrice] = useState(String(item.variant.sale_price));
  const [purchasePrice, setPurchasePrice] = useState(String(item.variant.purchase_price));
  const [wholesalePrice, setWholesalePrice] = useState(String(item.variant.wholesale_price));
  const [priceCurrency, setPriceCurrency] = useState<'USD' | 'CDF'>((item.variant.currency_code === 'CDF' ? 'CDF' : 'USD'));
  const [saving, setSaving] = useState(false);
  if (!user || !store) return null;

  const save = async () => {
    const sale = Number(salePrice);
    const purchase = Number(purchasePrice);
    const wholesale = Number(wholesalePrice || 0);
    if (![sale, purchase, wholesale].every(Number.isFinite) || sale < 0 || purchase < 0 || wholesale < 0) {
      window.alert('Les prix doivent être des nombres positifs ou nuls.');
      return;
    }
    setSaving(true);
    try {
      await execute('UPDATE product_variants SET sale_price = $1, purchase_price = $2, wholesale_price = $3, currency_code = $4, updated_at = $5 WHERE id = $6', [sale, purchase, wholesale, priceCurrency, now(), item.variant.id]);
      await addAuditLog(user, 'product_variant', 'update_prices', { sale_price: item.variant.sale_price, purchase_price: item.variant.purchase_price, wholesale_price: item.variant.wholesale_price }, { sale_price: sale, purchase_price: purchase, wholesale_price: wholesale, product: `${item.product.brand} ${item.product.model}` });
      onSaved();
    } finally { setSaving(false); }
  };
  return <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
      <div className="p-4 border-b flex items-center justify-between"><div><h2 className="font-semibold text-slate-800">Modifier les prix</h2><p className="text-sm text-slate-500">{item.product.brand} {item.product.model}</p></div><button onClick={onClose}><X className="w-5 h-5" /></button></div>
      <div className="p-4 space-y-3">
        <div className="rounded-lg bg-emerald-50 text-emerald-800 p-3 text-sm">Cette opération ne modifie ni le stock ni les IMEI. Changer de devise ne convertit pas automatiquement les prix : saisis les montants corrects dans la devise choisie.</div>
        <div><label className="label">Devise des prix</label><select value={priceCurrency} onChange={(e) => setPriceCurrency(e.target.value as 'USD' | 'CDF')} className="input"><option value="USD">USD — Dollar</option><option value="CDF">CDF — Franc congolais</option></select></div>
        <div><label className="label">Prix de vente ({priceCurrency})</label><input type="number" min="0" step={priceCurrency === 'CDF' ? '1' : '0.01'} className="input" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} /></div>
        <div><label className="label">Prix d’achat</label><input type="number" min="0" step="0.01" className="input" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} /></div>
        <div><label className="label">Prix de gros</label><input type="number" min="0" step="0.01" className="input" value={wholesalePrice} onChange={(e) => setWholesalePrice(e.target.value)} /></div>
        <div className="flex gap-2"><button onClick={onClose} className="btn-secondary flex-1">Annuler</button><LoadingButton onClick={save} loading={saving} loadingText="Enregistrement…" className="btn-primary flex-1">Enregistrer les prix</LoadingButton></div>
      </div>
    </div>
  </div>;
}

function ImeiListModal({ variantId, onClose }: { variantId: string; onClose: () => void }) {
  const [imeis, setImeis] = useState<ImeiUnit[]>([]);
  const { store } = useAuth();

  useEffect(() => {
    (async () => {
      setImeis(await query<ImeiUnit>(
        'SELECT * FROM imei_units WHERE variant_id = $1 ORDER BY lifecycle_status, received_at DESC',
        [variantId]
      ));
    })();
  }, [variantId]);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md animate-scale-in max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white">
          <h2 className="text-lg font-semibold text-slate-800">IMEI / Unités</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 space-y-2">
          {imeis.map((iu) => (
            <div key={iu.id} className="flex items-center justify-between p-2.5 bg-slate-50 rounded-lg">
              <div>
                <p className="font-mono text-sm text-slate-800">{iu.imei1}</p>
                {iu.imei2 && <p className="font-mono text-xs text-slate-400">IMEI2: {iu.imei2}</p>}
              </div>
              <span className={
                iu.lifecycle_status === 'in_stock' ? 'badge-success' :
                iu.lifecycle_status === 'sold' ? 'badge-slate' :
                'badge-warning'
              }>
                {lifecycleLabel(iu.lifecycle_status)}
              </span>
            </div>
          ))}
          {imeis.length === 0 && (
            <p className="text-center text-slate-400 text-sm py-4">Aucune unité enregistrée</p>
          )}
        </div>
      </div>
    </div>
  );
}
