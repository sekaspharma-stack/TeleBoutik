import { useState, useEffect, useRef, type CSSProperties } from 'react';
import { X, Printer, Check, ShieldCheck, ShieldAlert, ShieldQuestion, Receipt as ReceiptIcon, MessageCircle } from 'lucide-react';
import { getSaleById, getSaleLines, getSalePayments } from '../db/saleService';
import { query, queryOne } from '../db/localDb';
import { useAuth } from '../context/AuthContext';
import { formatCurrency, formatDateTime, paymentLabel } from '../lib/utils';
import { verifySaleRecord } from '../lib/receipt';
import type { Sale, SaleLine, SalePayment } from '../types';
import { shareReceiptOnWhatsApp } from '../lib/secureBackup';
import { canShareReceiptNative, printReceiptHtml, printThermalReceipt, shareReceiptNative, type ReceiptData } from '../lib/receiptPrinter';

type Integrity = 'checking' | 'authentic' | 'tampered' | 'legacy';

/**
 * Reçu détaillé d'une vente.
 *  - mode "success" : affiché juste après l'encaissement ;
 *  - mode "view"    : consultation d'un reçu passé (module Ventes) avec contrôle d'authenticité.
 */
export default function TicketModal({ saleId, onClose, mode = 'success' }: { saleId: string; onClose: () => void; mode?: 'success' | 'view' }) {
  const { store } = useAuth();
  const [sale, setSale] = useState<Sale | null>(null);
  const [lines, setLines] = useState<Array<SaleLine & { imei1?: string | null }>>([]);
  const [payments, setPayments] = useState<SalePayment[]>([]);
  const [customerName, setCustomerName] = useState('Client comptoir');
  const [sellerName, setSellerName] = useState('');
  const [storeLogo, setStoreLogo] = useState('');
  const [rccm, setRccm] = useState('');
  const [integrity, setIntegrity] = useState<Integrity>('checking');
  const [printing, setPrinting] = useState(false);
  const [printMessage, setPrintMessage] = useState('');
  const printingRef = useRef(false);
  // Le ticket n'est « prêt » (imprimable) qu'une fois TOUTES les données chargées.
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let alive = true;
    // Réinitialisation complète à chaque changement de vente : aucune donnée de la vente précédente ne subsiste.
    setReady(false);
    setLoadError('');
    setSale(null);
    setLines([]);
    setPayments([]);
    setCustomerName('Client comptoir');
    setSellerName('');
    setStoreLogo('');
    setRccm('');
    setIntegrity('checking');
    setPrintMessage('');

    (async () => {
      try {
        const loaded = await getSaleById(saleId);
        if (!alive) return;
        if (!loaded) { setLoadError('Vente introuvable.'); return; }

        const [logoRow, rccmRow, loadedLines, loadedPayments, seller, customer, check] = await Promise.all([
          queryOne<{ value: string }>("SELECT value FROM settings WHERE key = 'store_logo_data_url' LIMIT 1").catch(() => null),
          queryOne<{ value: string }>("SELECT value FROM settings WHERE key = 'store_rccm' LIMIT 1").catch(() => null),
          // IMEI réel (et non l'identifiant interne) pour chaque ligne sérialisée
          query<SaleLine & { imei1: string | null }>(
            `SELECT sl.*, iu.imei1 FROM sale_lines sl LEFT JOIN imei_units iu ON iu.id = sl.imei_unit_id WHERE sl.sale_id = $1`, [saleId]),
          getSalePayments(saleId),
          queryOne<{ name: string }>('SELECT name FROM users WHERE id = $1', [loaded.user_id]),
          loaded.customer_id
            ? queryOne<{ name: string }>('SELECT name FROM customers WHERE id = $1', [loaded.customer_id])
            : Promise.resolve(null),
          verifySaleRecord(loaded),
        ]);
        if (!alive) return;

        // Toutes les données sont appliquées dans le même passage, puis seulement alors le ticket devient imprimable.
        setStoreLogo(logoRow?.value || '');
        setRccm((rccmRow?.value || '').trim());
        setLines(loadedLines);
        setPayments(loadedPayments);
        setSellerName(seller?.name ?? '');
        setCustomerName(loaded.customer_id ? (customer?.name ?? 'Client enregistré') : 'Client comptoir');
        setIntegrity(check.status);
        setSale(loaded);
        setReady(true);
      } catch (error) {
        if (alive) setLoadError(error instanceof Error ? error.message : 'Impossible de charger le reçu.');
      }
    })();
    return () => { alive = false; };
  }, [saleId]);

  if (loadError) {
    return (
      <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
        <div className="bg-white rounded-2xl shadow-2xl p-5 max-w-sm w-full space-y-3" onClick={(e) => e.stopPropagation()} role="alert">
          <p className="text-sm font-semibold text-error-700">{loadError}</p>
          <button onClick={onClose} className="btn-secondary w-full">Fermer</button>
        </div>
      </div>
    );
  }

  if (!sale || !store || !ready) return null;

  const currency = sale.currency_code || store.currency;
  const decimals = currency === 'CDF' ? 0 : store.currency_decimals;
  const ref = sale.receipt_ref || '';
  // Message de fin : « ETS SEKAS vous remercie ! ». Un texte personnalisé saisi dans les
  // Paramètres est conservé ; l'ancien texte par défaut est remplacé.
  const customFooter = (store.footer_text || '').trim();
  const footerText = !customFooter || /^merci de votre visite\s*!?$/i.test(customFooter) ? `${store.name} vous remercie !` : customFooter;

  // Formats du modèle : « 175$ » pour les prix des lignes, « 175 USD » pour les totaux.
  const num = (n: number, cur: string) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: cur === 'CDF' ? 0 : (n % 1 === 0 ? 0 : 2), maximumFractionDigits: cur === 'CDF' ? 0 : 2 }).format(n).replace(/[\u00a0\u202f]/g, ' ');
  const short = (n: number, cur: string) => `${num(n, cur)}${cur === 'USD' ? '$' : cur === 'EUR' ? '€' : ' ' + cur}`;
  const full = (n: number, cur: string) => `${num(n, cur)} ${cur}`;
  const changeCur = sale.change_currency || currency;
  const receiptData: ReceiptData = {
    storeName: store.name,
    rccm,
    phone: store.phone || '',
    ticket: sale.ticket_number,
    ref,
    date: formatDateTime(sale.sale_date),
    seller: sellerName,
    customer: customerName,
    lines: lines.map((l) => ({ name: l.product_name, imei: l.imei1 || undefined, qty: String(l.quantity), unit: short(l.unit_price, currency), total: short(l.line_total, currency) })),
    subtotal: full(sale.subtotal, currency),
    total: full(sale.total, currency),
    payments: payments.map((p) => { const c = p.currency_code || currency; return { label: `${paymentLabel(p.payment_method)} (${c})`, amount: full(p.original_amount ?? p.amount, c) }; }),
    change: full(sale.change_amount ?? 0, changeCur),
    warning: 'Vérifier le reçu car la marchandise vendue n’est ni échangée ni remboursée',
    footer: footerText,
  };

  const handlePrint = async (method: 'thermal' | 'system' | 'share') => {
    if (!ready) return; // jamais d'impression d'un ticket partiellement chargé
    if (printingRef.current) return; // verrou synchrone contre le double-clic
    printingRef.current = true;
    setPrinting(true);
    setPrintMessage('');
    try {
      const printContent = document.getElementById('ticket-print');
      if (!printContent) throw new Error('Le contenu du reçu est introuvable.');
      if (method === 'thermal') {
        const result = await printThermalReceipt(printContent, Number(store.ticket_width) || 58, receiptData);
        setPrintMessage(`Commande envoyée${result.deviceName ? ` à « ${result.deviceName} »` : ' à l’imprimante'}. Vérifie la sortie papier; le navigateur ne peut pas confirmer physiquement l’impression.`);
      } else if (method === 'share') {
        const shareResult = await shareReceiptNative(printContent, sale.ticket_number, receiptData);
        setPrintMessage(shareResult === 'cancelled' ? 'Partage annulé. Aucune modification n’a été apportée à la vente.' : shareResult === 'unsupported' ? 'Le partage natif n’est pas pris en charge ici. Utilise Impression système / PDF.' : 'Feuille de partage native ouverte. Choisis une application ou une imprimante compatible.');
      } else {
        await printReceiptHtml(printContent, sale.ticket_number, Number(store.ticket_width) || 58);
        setPrintMessage('Boîte d’impression ouverte. Vérifie l’imprimante et le format avant de confirmer. La vente reste enregistrée.');
      }
    } catch (error) {
      setPrintMessage(error instanceof Error ? error.message : 'Échec de l’impression. La vente reste enregistrée.');
    } finally {
      printingRef.current = false;
      setPrinting(false);
    }
  };

  const badge = {
    checking: { icon: ShieldQuestion, text: 'Vérification en cours…', cls: 'bg-slate-100 text-slate-600' },
    authentic: { icon: ShieldCheck, text: 'Reçu authentique : contenu conforme à l’enregistrement', cls: 'bg-success-50 text-success-700' },
    tampered: { icon: ShieldAlert, text: 'ATTENTION : ce reçu a été modifié après son émission', cls: 'bg-error-50 text-error-700' },
    legacy: { icon: ShieldQuestion, text: 'Reçu ancien (avant le sceau v2) : non certifiable', cls: 'bg-amber-50 text-amber-800' },
  }[integrity];
  const BadgeIcon = badge.icon;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full animate-scale-in max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} style={{ maxWidth: store.ticket_width === '58' ? '340px' : '420px' }}>
        <div className="p-4 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white z-10">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-success-100 rounded-full flex items-center justify-center">
              {mode === 'success' ? <Check className="w-5 h-5 text-success-600" /> : <ReceiptIcon className="w-4 h-4 text-success-600" />}
            </div>
            <h2 className="text-lg font-semibold text-slate-800">{mode === 'success' ? 'Vente réussie' : 'Reçu de vente'}</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Fermer"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-4 space-y-3">
          {(mode === 'view' || integrity === 'tampered') && (
            <div className={`flex items-start gap-2 rounded-lg p-2.5 text-xs font-semibold ${badge.cls}`} role="status">
              <BadgeIcon className="mt-0.5 h-4 w-4 shrink-0" />{badge.text}
            </div>
          )}
          {sale.status === 'cancelled' && <div className="rounded-lg bg-error-50 p-2.5 text-xs font-bold text-error-700">VENTE ANNULÉE — ce reçu n’a plus de valeur comptable.</div>}

          <div id="ticket-print" style={{ background: '#fff', color: '#000', fontFamily: "'Courier New', Courier, monospace", fontSize: 12, lineHeight: 1.35, padding: '12px 10px', border: '1px solid #e2e8f0', borderRadius: 8 }}>
            <div style={{ textAlign: 'center' }}>
              {storeLogo
                ? <img src={storeLogo} alt={`Logo ${store.name}`} style={{ display: 'block', margin: '0 auto 6px', maxHeight: 64, maxWidth: '80%', objectFit: 'contain' }} />
                : <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 4 }}>{store.name}</div>}
              {rccm && <div style={{ fontWeight: 700, fontSize: 13, letterSpacing: 0.5 }}>RCCM : {rccm}</div>}
              {store.phone && <div style={{ color: '#444' }}>Tél: {store.phone}</div>}
            </div>
            <div style={{ borderTop: '2px solid #000', margin: '8px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span style={{ color: '#444' }}>Ticket :</span><b>{sale.ticket_number}</b></div>
            {ref && <div style={{ overflowWrap: 'anywhere' }}><span style={{ color: '#444' }}>Réf. : </span><b>{ref}</b></div>}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span style={{ color: '#444' }}>Date :</span><span style={{ color: '#444' }}>{formatDateTime(sale.sale_date)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span style={{ color: '#444' }}>Vendeur :</span><span style={{ color: '#444' }}>{sellerName || '—'}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span style={{ color: '#444' }}>Client :</span><b>{customerName}</b></div>
            <div style={{ borderTop: '1px dashed #000', margin: '8px 0' }} />
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #000' }}>
                  <th style={{ textAlign: 'left', padding: '2px 0', fontWeight: 400 }}>LIBELLÉ</th>
                  <th style={{ textAlign: 'center', padding: '2px 0', fontWeight: 400 }}>QTÉ</th>
                  <th style={{ textAlign: 'right', padding: '2px 0', fontWeight: 400 }}>P.U.</th>
                  <th style={{ textAlign: 'right', padding: '2px 0', fontWeight: 400 }}>TOTAL</th>
                </tr>
              </thead>
              <tbody>
                {receiptData.lines.map((line, i) => (
                  <tr key={lines[i].id} style={{ verticalAlign: 'top' }}>
                    <td style={{ padding: '6px 4px 6px 0' }}>
                      <b>{line.name}</b>
                      {line.imei && <div style={{ color: '#444', overflowWrap: 'anywhere' }}>IMEI:<br />{line.imei}</div>}
                    </td>
                    <td style={{ textAlign: 'center', padding: '6px 0' }}>{line.qty}</td>
                    <td style={{ textAlign: 'right', padding: '6px 0 6px 4px', color: '#444', whiteSpace: 'nowrap' }}>{line.unit}</td>
                    <td style={{ textAlign: 'right', padding: '6px 0 6px 4px', fontWeight: 700, whiteSpace: 'nowrap' }}>{line.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '2px 0' }}><span>Sous-total :</span><b>{receiptData.subtotal}</b></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, background: '#000', color: '#fff', fontWeight: 700, fontSize: 15, padding: '5px 8px', margin: '6px 0', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' } as CSSProperties}><span>TOTAL :</span><span>{receiptData.total}</span></div>
            <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
            {receiptData.payments.map((p, i) => (
              <div key={payments[i].id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, color: '#444' }}><span>{p.label} :</span><span>{p.amount}</span></div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontWeight: 700 }}><span>Rendu :</span><span>= {receiptData.change}</span></div>
            <div style={{ border: '2px solid #000', textAlign: 'center', fontSize: 11, padding: '6px 8px', margin: '10px 0', textTransform: 'uppercase' }}>{receiptData.warning}</div>
            <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 13, padding: '4px 0' }}>{footerText}</div>
          </div>
        </div>

        {printMessage && <div className="mx-4 mb-2 rounded-lg bg-slate-100 p-2 text-xs text-slate-700" role="status">{printMessage}</div>}
        <div className="p-4 border-t border-slate-200 flex flex-wrap gap-2 sticky bottom-0 bg-white">
          <button type="button" onClick={() => void handlePrint('thermal')} disabled={printing || !ready} className="btn-primary flex-1 disabled:opacity-60" title="Imprimer sur une imprimante thermique Bluetooth compatible"><Printer className="w-4 h-4" />{printing ? 'Envoi…' : 'Thermique Bluetooth'}</button>
          <button type="button" onClick={() => void handlePrint('system')} disabled={printing || !ready} className="btn-secondary flex-1 disabled:opacity-60"><Printer className="w-4 h-4" />Impression système / PDF</button>
          {canShareReceiptNative() && <button type="button" onClick={() => void handlePrint('share')} disabled={printing || !ready} className="btn-secondary flex-1 disabled:opacity-60" title="Partager le texte du reçu via la feuille de partage native"><ReceiptIcon className="w-4 h-4" />Partager le reçu</button>}
          <button disabled={!ready} onClick={() => shareReceiptOnWhatsApp({ store: store.name, ticket: sale.ticket_number, reference: ref, date: formatDateTime(sale.sale_date), total: formatCurrency(sale.total, currency, decimals) })} className="btn-secondary disabled:opacity-60" title="Partager la référence du reçu via WhatsApp"><MessageCircle className="w-4 h-4" /> WhatsApp</button>
          <button onClick={onClose} className="btn-secondary">Fermer</button>
        </div>
      </div>
    </div>
  );
}
