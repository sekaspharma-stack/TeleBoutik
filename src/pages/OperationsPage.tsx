import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, Wrench, CreditCard, PackageSearch, BarChart3, Building2, Barcode, Camera, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { query } from '../db/localDb';
import { getMarginByProduct, getConsolidatedSales } from '../db/operations';
import WarrantyTab from '../components/ops/WarrantyTab';
import RepairsTab from '../components/ops/RepairsTab';
import DebtsTab from '../components/ops/DebtsTab';
import RestockSection from '../components/ops/RestockSection';
import CameraScanner from '../components/CameraScanner';
import { printBarcodeLabel } from '../lib/labels';

type Tab = 'warranty'|'repairs'|'debts'|'stock'|'labels'|'stores';
type Customer = {id:string;name:string;phone:string};
type ProductRow = {variant_id:string;product_name?:string;brand?:string;model?:string;sku?:string;barcode?:string;quantity?:number;min_stock?:number;suggested_quantity?:number;revenue?:number;cost?:number;margin?:number};
type StoreSales = {store_id:string;store_name:string;sale_count:number;revenue:number;cost:number;margin:number};
const tabs: {id:Tab;label:string;icon:typeof ShieldCheck}[] = [
 {id:'warranty',label:'Garantie IMEI',icon:ShieldCheck},{id:'repairs',label:'SAV / réparations',icon:Wrench},{id:'debts',label:'Dettes clients',icon:CreditCard},{id:'stock',label:'Stock & marges',icon:PackageSearch},{id:'labels',label:'Étiquettes / scan',icon:Barcode},{id:'stores',label:'Multi-boutiques',icon:Building2}
];
const today = () => new Date().toLocaleDateString('en-CA');
const money = (v:number, c='CDF') => new Intl.NumberFormat('fr-CD',{style:'currency',currency:c,maximumFractionDigits:c==='CDF'?0:2}).format(Number(v||0));

export default function OperationsPage(){
 const {user,store}=useAuth();
 const [tab,setTab]=useState<Tab>('warranty');
 const [busy,setBusy]=useState(false); const [error,setError]=useState(''); const [notice,setNotice]=useState('');
 const [customers,setCustomers]=useState<Customer[]>([]); const [margins,setMargins]=useState<ProductRow[]>([]); const [storeSales,setStoreSales]=useState<StoreSales[]>([]); const [products,setProducts]=useState<ProductRow[]>([]);
 const [fromDate,setFromDate]=useState(today()); const [toDate,setToDate]=useState(today());
 const [labelForm,setLabelForm]=useState({variant_id:'',name:'',sku:'',barcode:'',imei:'',price:''}); const [scanOpen,setScanOpen]=useState(false);
 const canManage = user?.role==='owner'||user?.role==='manager';
 const load = useCallback(async()=>{
  if(!store) return; setBusy(true); setError('');
  try {
   const [cs,ms,ss,pr] = await Promise.all([
    query<Customer>('SELECT id,name,phone FROM customers ORDER BY name'),
    getMarginByProduct(store.id,fromDate,toDate) as Promise<ProductRow[]>,
    canManage ? getConsolidatedSales(fromDate,toDate) as Promise<StoreSales[]> : Promise.resolve([]),
    query<ProductRow>(`SELECT pv.id AS variant_id,p.brand || ' ' || p.model AS product_name,pv.sku,pv.barcode,pv.sale_price AS revenue FROM product_variants pv JOIN products p ON p.id=pv.product_id ORDER BY p.brand,p.model`)
   ]);
   setCustomers(cs);setMargins(ms);setStoreSales(ss);setProducts(pr);
  } catch(e){setError(e instanceof Error?e.message:'Impossible de charger les modules.');} finally {setBusy(false);}
 },[store,fromDate,toDate,canManage]);
 useEffect(()=>{void load();},[load]);
 const notify=(s:string)=>{setNotice(s);window.setTimeout(()=>setNotice(''),4000)};
 const onScan=useCallback((value:string)=>{setScanOpen(false);setLabelForm(f=>({...f,imei:value,barcode:value,sku:f.sku||value}));notify(`Code détecté : ${value}`);},[]);
 if(!user||!store)return null;
 return <div className="space-y-4">
  <header><h1 className="text-2xl font-bold text-slate-900">Gestion avancée</h1><p className="text-sm text-slate-500">Garantie, SAV, dettes, stock, étiquettes et consolidation des boutiques.</p></header>
  {error&&<div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}<button className="ml-3 underline" onClick={()=>setError('')}>Fermer</button></div>}{notice&&<div role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}
  <div className="flex flex-wrap gap-2">{tabs.map(t=><button key={t.id} onClick={()=>setTab(t.id)} className={tab===t.id?'btn-primary':'btn-secondary'}><t.icon className="h-4 w-4"/>{t.label}</button>)}<button onClick={()=>void load()} className="btn-secondary" aria-label="Actualiser"><RefreshCw className="h-4 w-4"/></button></div>
  {tab==='warranty'&&<WarrantyTab store={store} user={user} customers={customers} notify={notify} fail={setError}/>}
  {tab==='repairs'&&<RepairsTab store={store} user={user} customers={customers} notify={notify} fail={setError}/>}
  {tab==='debts'&&<DebtsTab store={store} user={user} customers={customers} notify={notify} fail={setError}/>}
  {tab==='stock'&&<section className="space-y-4"><RestockSection store={store} notify={notify} fail={setError}/><div className="card p-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="flex items-center gap-2 font-semibold"><BarChart3 className="h-5 w-5"/>Marge par produit</h2><div className="flex gap-2"><input type="date" className="input" value={fromDate} onChange={e=>setFromDate(e.target.value)}/><input type="date" className="input" value={toDate} onChange={e=>setToDate(e.target.value)}/></div></div><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead><tr className="text-left"><th className="p-2">Produit</th><th className="p-2">Qté</th><th className="p-2">Ventes</th><th className="p-2">Coût</th><th className="p-2">Marge</th></tr></thead><tbody>{margins.map((r,i)=><tr key={`${r.variant_id}-${i}`} className="border-t border-slate-200"><td className="p-2">{r.product_name||r.variant_id}</td><td className="p-2">{r.quantity}</td><td className="p-2">{money(Number(r.revenue),store.currency)}</td><td className="p-2">{money(Number(r.cost),store.currency)}</td><td className="p-2 font-semibold">{money(Number(r.margin),store.currency)}</td></tr>)}</tbody></table>{margins.length===0&&<p className="p-2 text-sm text-slate-500">Aucune vente pour cette période.</p>}</div></div></section>}
  {tab==='labels'&&<section className="grid gap-4 xl:grid-cols-2"><div className="card space-y-3 p-4"><h2 className="font-semibold">Étiquette imprimable</h2><label className="label">Produit</label><select className="input" value={labelForm.variant_id} onChange={e=>{const p=products.find(x=>x.variant_id===e.target.value);setLabelForm(f=>({...f,variant_id:e.target.value,name:p?.product_name||'',sku:p?.sku||'',barcode:p?.barcode||''}));}}><option value="">Saisie manuelle / IMEI seul</option>{products.map(p=><option key={p.variant_id} value={p.variant_id}>{p.product_name} — {p.sku}</option>)}</select><label className="label">Nom produit</label><input className="input" value={labelForm.name} onChange={e=>setLabelForm(f=>({...f,name:e.target.value}))}/><label className="label">SKU</label><input className="input" value={labelForm.sku} onChange={e=>setLabelForm(f=>({...f,sku:e.target.value}))}/><label className="label">Code-barres</label><input className="input" value={labelForm.barcode} onChange={e=>setLabelForm(f=>({...f,barcode:e.target.value}))}/><label className="label">IMEI (facultatif)</label><input className="input" value={labelForm.imei} onChange={e=>setLabelForm(f=>({...f,imei:e.target.value}))}/><label className="label">Prix affiché</label><input className="input" value={labelForm.price} onChange={e=>setLabelForm(f=>({...f,price:e.target.value}))}/><div className="flex flex-wrap gap-2"><button className="btn-secondary" onClick={()=>setScanOpen(true)}><Camera className="h-4 w-4"/>Scanner caméra</button><button className="btn-primary" onClick={()=>{try{printBarcodeLabel({name:labelForm.name||'TeleBoutik',sku:labelForm.sku||labelForm.barcode||labelForm.imei,barcode:labelForm.barcode,imei:labelForm.imei,price:labelForm.price});}catch(e){setError(e instanceof Error?e.message:'Impression impossible.');}}}><Barcode className="h-4 w-4"/>Imprimer étiquette</button></div><p className="text-xs text-slate-500">Le scan caméra requiert HTTPS, l’autorisation de caméra et la prise en charge BarcodeDetector. Un lecteur Bluetooth/USB reste compatible.</p></div><div className="card p-4"><h2 className="font-semibold">Conseils d’impression</h2><p className="mt-2 text-sm text-slate-600">Format thermique prévu : 50 × 30 mm. Dans la boîte d’impression, sélectionne l’imprimante d’étiquettes et vérifie l’échelle à 100 %.</p><p className="mt-2 text-sm text-slate-600">Le code est imprimé en caractères lisibles. Pour un véritable code-barres graphique scannable, une bibliothèque de génération de code-barres devra être ajoutée et validée sur le modèle d’imprimante utilisé.</p></div></section>}
  {tab==='stores'&&<section className="card p-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">Tableau consolidé des boutiques</h2><p className="text-xs text-slate-500">Visible aux gérants/propriétaires. Les données sont consolidées depuis la base locale synchronisée.</p></div><div className="flex gap-2"><input type="date" className="input" value={fromDate} onChange={e=>setFromDate(e.target.value)}/><input type="date" className="input" value={toDate} onChange={e=>setToDate(e.target.value)}/></div></div>{!canManage?<p className="text-sm text-red-700">Accès réservé au gérant ou propriétaire.</p>:<div className="overflow-x-auto"><table className="min-w-full text-sm"><thead><tr className="text-left"><th className="p-2">Boutique</th><th className="p-2">Nombre de ventes</th><th className="p-2">Chiffre d’affaires</th><th className="p-2">Coût</th><th className="p-2">Marge</th></tr></thead><tbody>{storeSales.map(s=><tr key={s.store_id} className="border-t border-slate-200"><td className="p-2">{s.store_name||s.store_id}</td><td className="p-2">{s.sale_count}</td><td className="p-2">{money(Number(s.revenue),store.currency)}</td><td className="p-2">{money(Number(s.cost),store.currency)}</td><td className="p-2 font-semibold">{money(Number(s.margin),store.currency)}</td></tr>)}</tbody></table></div>}</section>}
  {busy&&<p className="text-xs text-slate-500" role="status">Actualisation des données…</p>}{scanOpen&&<CameraScanner onDetected={onScan} onClose={()=>setScanOpen(false)}/>}
 </div>;
}
