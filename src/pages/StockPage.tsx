import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { Search, Package, Smartphone, Plus, X, Edit2, Tag, AlertTriangle, Archive, Camera } from 'lucide-react';
import { query, queryOne, execute, generateId, now, withLocalTransaction } from '../db/localDb';
import { addAuditLog } from '../db/audit';
import { useAuth } from '../context/AuthContext';
import { formatCurrency, lifecycleLabel, canSeeMargin, generateBarcode, generateSku } from '../lib/utils';
import type { Product, ProductVariant, ImeiUnit } from '../types';
import LoadingButton from '../components/LoadingButton';
import SoldImeiArchive from '../components/SoldImeiArchive';
import CameraScanner from '../components/CameraScanner';

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
  const location = useLocation();
  const [items, setItems] = useState<StockItem[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'phones' | 'accessories' | 'low'>('all');
  const [showAdd, setShowAdd] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [initialBarcode, setInitialBarcode] = useState('');
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
  useEffect(() => {
    const state = location.state as { scannedBarcode?: string; openCreateProduct?: boolean } | null;
    if (state?.openCreateProduct && state.scannedBarcode) { setInitialBarcode(state.scannedBarcode); setShowAdd(true); window.history.replaceState({}, document.title); }
  }, [location.state]);

  if (!user || !store) return null;
  const showMargin = canSeeMargin(user.role);
  const currency = store.currency;
  const decimals = store.currency_decimals;

  const filtered = items.filter((item) => {
    const q = search.toLowerCase();
    const matches = !q ||
      item.product.brand.toLowerCase().includes(q) ||
      item.product.model.toLowerCase().includes(q) ||
      item.variant.sku.toLowerCase().includes(q) || item.variant.barcode.toLowerCase().includes(q);
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
        <div className="flex flex-wrap gap-2"><button onClick={() => { setInitialBarcode(''); setShowAdd(true); }} className="btn-primary"><Plus className="w-4 h-4" /> Nouveau produit</button><button onClick={() => setScanOpen(true)} className="btn-secondary"><Package className="w-4 h-4" /> Scanner un produit</button></div>
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
                      <button title="Modifier les prix, le code commercial ou ajouter un IMEI" onClick={() => setEditingItem(item)} className="text-slate-400 hover:text-primary-600 p-1">
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
          initialBarcode={initialBarcode}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); setInitialBarcode(''); loadStock(); }}
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
      {scanOpen && <CameraScanner onDetected={async (code) => { setScanOpen(false); const found = await queryOne<{ id: string }>('SELECT id FROM product_variants WHERE barcode = $1 OR sku = $1', [code]); if (found) { setSearch(code); window.alert('Produit trouvé dans le catalogue. Utilisez la recherche pour le retrouver.'); } else { setInitialBarcode(code); setShowAdd(true); } }} onClose={() => setScanOpen(false)} />}
    </div>
  );
}

function AddProductModal({ onClose, onSaved, initialBarcode = '' }: { onClose: () => void; onSaved: () => void; initialBarcode?: string }) {
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
  const [barcode, setBarcode] = useState(initialBarcode);
  const [scanField, setScanField] = useState<'barcode' | 'imei' | 'imei2' | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setBarcode(initialBarcode); }, [initialBarcode]);

  if (!user || !store) return null;

  const handleSave = async () => {
    if (!brand.trim() || !model.trim()) { window.alert('La marque et le modèle sont obligatoires.'); return; }
    if (saving) return;
    setSaving(true);
    try {
    if (barcode.trim()) { const duplicate = await queryOne<{ id: string }>('SELECT id FROM product_variants WHERE barcode = $1 LIMIT 1', [barcode.trim()]); if (duplicate) { window.alert('Ce code-barres est déjà associé à un produit.'); setSaving(false); return; } }
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
    const productBarcode = barcode.trim() || generateBarcode();

    await withLocalTransaction(async (tx) => {
      await tx.execute(
        `INSERT INTO products (id, brand, family, model, category, is_serialized, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [productId, brand, category, model, category, isSerialized, now(), now()]
      );

      await tx.execute(
        `INSERT INTO product_variants (id, product_id, sku, barcode, attributes, purchase_price, sale_price, wholesale_price, currency_code, min_stock, max_stock, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 5, 100, $10, $11)`,
        [variantId, productId, sku, productBarcode, JSON.stringify(attrs),
         parseFloat(purchasePrice) || 0, parseFloat(salePrice) || 0, parseFloat(wholesalePrice) || 0, priceCurrency, now(), now()]
      );

      if (isSerialized && imei) {
        const imeiId = generateId();
        await tx.execute(
          `INSERT INTO imei_units (id, variant_id, imei1, imei2, lifecycle_status, cost, grade, received_at)
           VALUES ($1, $2, $3, $4, 'in_stock', $5, 'new', $6)`,
          [imeiId, variantId, imei, imei2 || null, parseFloat(purchasePrice) || 0, now()]
        );
        await tx.execute(
          `INSERT INTO stock_movements (id, variant_id, imei_unit_id, movement_type, direction, quantity, unit_cost, reference_type, user_id, reason, created_at)
           VALUES ($1, $2, $3, 'purchase', 'in', 1, $4, 'manual_entry', $5, 'Entrée manuelle', $6)`,
          [generateId(), variantId, imeiId, parseFloat(purchasePrice) || 0, user.id, now()]
        );
      } else if (!isSerialized) {
        await tx.execute(
          `INSERT INTO stock_movements (id, variant_id, movement_type, direction, quantity, unit_cost, reference_type, user_id, reason, created_at)
           VALUES ($1, $2, 'purchase', 'in', $3, $4, 'manual_entry', $5, 'Stock initial', $6)`,
          [generateId(), variantId, Math.max(0, Math.floor(Number(initialQuantity) || 0)), parseFloat(purchasePrice) || 0, user.id, now()]
        );
      }

      await addAuditLog(user, 'product', 'create', null, { brand, model, sku, barcode: productBarcode }, tx);
    });
    onSaved();
    } catch (error) {
      console.error('Échec création produit', error);
      window.alert('Impossible d’enregistrer le produit. Aucune modification partielle ne doit être conservée. Vérifiez les données et réessayez.');
    } finally { setSaving(false); }
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
          <div>
            <label className="label">Code commercial (code-barres)</label>
            <div className="flex gap-2"><input value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="Scanner ou saisir le code commercial" className="input min-w-0 flex-1" /><button type="button" className="btn-secondary shrink-0" onClick={() => setScanField('barcode')} aria-label="Scanner le code commercial"><Camera className="h-4 w-4" /> Scanner</button></div>
          </div>
          {isSerialized && (
            <>
              <div>
                <label className="label">IMEI 1</label>
                <div className="flex gap-2"><input inputMode="numeric" value={imei} onChange={(e) => setImei(e.target.value.replace(/\D/g, '').slice(0, 15))} placeholder="Scanner l’IMEI (15 chiffres)" className="input min-w-0 flex-1 font-mono" maxLength={15} /><button type="button" className="btn-secondary shrink-0" onClick={() => setScanField('imei')} aria-label="Scanner IMEI 1"><Camera className="h-4 w-4" /> Scanner</button></div>
              </div>
              <div>
                <label className="label">IMEI 2 (optionnel)</label>
                <div className="flex gap-2"><input inputMode="numeric" value={imei2} onChange={(e) => setImei2(e.target.value.replace(/\D/g, '').slice(0, 15))} placeholder="IMEI 2" className="input min-w-0 flex-1 font-mono" maxLength={15} /><button type="button" className="btn-secondary shrink-0" onClick={() => setScanField('imei2')} aria-label="Scanner IMEI 2"><Camera className="h-4 w-4" /> Scanner</button></div>
              </div>
            </>
          )}
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
          <LoadingButton onClick={handleSave} disabled={!brand || !model} loadingText="Enregistrement…" className="btn-primary w-full">
            Enregistrer
          </LoadingButton>
        </div>
      </div>
      {scanField && <CameraScanner onDetected={(value) => { if (scanField === 'barcode') setBarcode(value); else if (scanField === 'imei') setImei(value.replace(/\D/g, '').slice(0, 15)); else setImei2(value.replace(/\D/g, '').slice(0, 15)); setScanField(null); }} onClose={() => setScanField(null)} />}
    </div>
  );
}


function EditProductPricesModal({ item, onClose, onSaved }: { item: StockItem; onClose: () => void; onSaved: () => void }) {
  const { user, store } = useAuth();
  const [salePrice, setSalePrice] = useState(String(item.variant.sale_price));
  const [purchasePrice, setPurchasePrice] = useState(String(item.variant.purchase_price));
  const [wholesalePrice, setWholesalePrice] = useState(String(item.variant.wholesale_price));
  const [barcode, setBarcode] = useState(item.variant.barcode || '');
  const [newImei, setNewImei] = useState('');
  const [newImei2, setNewImei2] = useState('');
  const [scanField, setScanField] = useState<'barcode' | 'imei' | 'imei2' | null>(null);
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
    const cleanBarcode = barcode.trim();
    if (cleanBarcode) {
      const duplicateBarcode = await queryOne<{ id: string }>('SELECT id FROM product_variants WHERE barcode = $1 AND id <> $2 LIMIT 1', [cleanBarcode, item.variant.id]);
      if (duplicateBarcode) { window.alert('Ce code commercial est déjà associé à un autre produit.'); return; }
    }
    const cleanImei = newImei.trim();
    const cleanImei2 = newImei2.trim();
    if (cleanImei && !/^\d{15}$/.test(cleanImei)) { window.alert('L’IMEI doit contenir exactement 15 chiffres.'); return; }
    if (cleanImei2 && !/^\d{15}$/.test(cleanImei2)) { window.alert('L’IMEI 2 doit contenir exactement 15 chiffres.'); return; }
    if (cleanImei2 && !cleanImei) { window.alert('Pour enregistrer un IMEI 2, renseigne aussi l’IMEI 1.'); return; }
    if (cleanImei && cleanImei === cleanImei2) { window.alert('IMEI 1 et IMEI 2 doivent être différents.'); return; }
    if (cleanImei || cleanImei2) {
      const duplicateImei = await queryOne<{ id: string }>('SELECT id FROM imei_units WHERE imei1 IN ($1, $2) OR imei2 IN ($1, $2) LIMIT 1', [cleanImei || '__none__', cleanImei2 || '__none__']);
      if (duplicateImei) { window.alert('Cet IMEI existe déjà en stock ou dans l’archive des ventes.'); return; }
    }
    setSaving(true);
    try {
      await withLocalTransaction(async (tx) => {
        await tx.execute('UPDATE product_variants SET sale_price = $1, purchase_price = $2, wholesale_price = $3, currency_code = $4, barcode = $5, updated_at = $6 WHERE id = $7', [sale, purchase, wholesale, priceCurrency, cleanBarcode, now(), item.variant.id]);
        if (cleanImei) {
          const imeiId = generateId();
          await tx.execute(`INSERT INTO imei_units (id, variant_id, imei1, imei2, lifecycle_status, cost, grade, received_at) VALUES ($1, $2, $3, $4, 'in_stock', $5, 'new', $6)`, [imeiId, item.variant.id, cleanImei, cleanImei2 || null, purchase, now()]);
          await tx.execute(`INSERT INTO stock_movements (id, variant_id, imei_unit_id, movement_type, direction, quantity, unit_cost, reference_type, user_id, reason, created_at) VALUES ($1, $2, $3, 'purchase', 'in', 1, $4, 'manual_entry', $5, 'Ajout IMEI depuis modification produit', $6)`, [generateId(), item.variant.id, imeiId, purchase, user.id, now()]);
        }
        await addAuditLog(user, 'product_variant', 'update_product_identifiers', { barcode: item.variant.barcode }, { barcode: cleanBarcode, imei_added: cleanImei || null, product: `${item.product.brand} ${item.product.model}` }, tx);
      });
      onSaved();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Impossible de modifier le produit.');
    } finally { setSaving(false); }
  };
  return <div className="fixed inset-0 bg-black/40 z-50 overflow-y-auto p-3 sm:p-4" onClick={onClose}>
    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-auto my-0 sm:my-2 max-h-[calc(100dvh-1.5rem)] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
      <div className="p-4 border-b flex items-center justify-between shrink-0"><div><h2 className="font-semibold text-slate-800">Modifier le produit</h2><p className="text-sm text-slate-500">{item.product.brand} {item.product.model}</p></div><button onClick={onClose}><X className="w-5 h-5" /></button></div>
      <div className="p-4 space-y-3 overflow-y-auto overscroll-contain flex-1 min-h-0">
        <div className="rounded-lg bg-blue-50 text-blue-800 p-3 text-sm">Tu peux mettre à jour le code commercial et ajouter une unité IMEI. Un nouvel IMEI valide sera ajouté au stock avec son mouvement d’entrée ; les IMEI existants et vendus ne sont pas modifiés.</div>
        <div><label className="label">Code commercial (code-barres)</label><div className="flex gap-2"><input className="input min-w-0 flex-1" value={barcode} onChange={e => setBarcode(e.target.value)} placeholder="Code commercial"/><button type="button" className="btn-secondary shrink-0" onClick={() => setScanField('barcode')}><Camera className="h-4 w-4"/> Scanner</button></div></div>
        {item.product.is_serialized && <><div><label className="label">Nouvel IMEI 1 (15 chiffres)</label><div className="flex gap-2"><input inputMode="numeric" className="input min-w-0 flex-1 font-mono" maxLength={15} value={newImei} onChange={e => setNewImei(e.target.value.replace(/\D/g, '').slice(0,15))} placeholder="Scanner l’IMEI"/><button type="button" className="btn-secondary shrink-0" onClick={() => setScanField('imei')}><Camera className="h-4 w-4"/> Scanner</button></div></div><div><label className="label">IMEI 2 (facultatif)</label><div className="flex gap-2"><input inputMode="numeric" className="input min-w-0 flex-1 font-mono" maxLength={15} value={newImei2} onChange={e => setNewImei2(e.target.value.replace(/\D/g, '').slice(0,15))} placeholder="IMEI 2"/><button type="button" className="btn-secondary shrink-0" onClick={() => setScanField('imei2')}><Camera className="h-4 w-4"/> Scanner</button></div></div></>}
        <div><label className="label">Devise des prix</label><select value={priceCurrency} onChange={(e) => setPriceCurrency(e.target.value as 'USD' | 'CDF')} className="input"><option value="USD">USD — Dollar</option><option value="CDF">CDF — Franc congolais</option></select></div>
        <div><label className="label">Prix de vente ({priceCurrency})</label><input type="number" min="0" step={priceCurrency === 'CDF' ? '1' : '0.01'} className="input" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} /></div>
        <div><label className="label">Prix d’achat</label><input type="number" min="0" step="0.01" className="input" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} /></div>
        <div><label className="label">Prix de gros</label><input type="number" min="0" step="0.01" className="input" value={wholesalePrice} onChange={(e) => setWholesalePrice(e.target.value)} /></div>
        <div className="sticky bottom-0 flex gap-2 border-t bg-white p-3 -mx-4 -mb-4 mt-2 shrink-0"><button onClick={onClose} className="btn-secondary flex-1">Annuler</button><LoadingButton onClick={save} loading={saving} loadingText="Enregistrement…" className="btn-primary flex-1">Enregistrer les modifications</LoadingButton></div>
      </div>
      {scanField && <CameraScanner onDetected={(value) => { if (scanField === 'barcode') setBarcode(value); else if (scanField === 'imei') setNewImei(value.replace(/\D/g, '').slice(0,15)); else setNewImei2(value.replace(/\D/g, '').slice(0,15)); setScanField(null); }} onClose={() => setScanField(null)} />}
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
