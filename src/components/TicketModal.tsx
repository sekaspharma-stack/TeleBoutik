import { useState, useEffect, useRef } from 'react';
import { X, Printer, Check, ShieldCheck, ShieldAlert, ShieldQuestion, Receipt as ReceiptIcon, MessageCircle } from 'lucide-react';
import { getSaleById, getSaleLines, getSalePayments } from '../db/saleService';
import { query, queryOne } from '../db/localDb';
import { useAuth } from '../context/AuthContext';
import { formatCurrency, formatDateTime, paymentLabel } from '../lib/utils';
import { verifyReceipt } from '../lib/receipt';
import type { Sale, SaleLine, SalePayment } from '../types';
import { shareReceiptOnWhatsApp } from '../lib/secureBackup';
import { canShareReceiptNative, printReceiptHtml, printThermalReceipt, shareReceiptNative } from '../lib/receiptPrinter';

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
  const [integrity, setIntegrity] = useState<Integrity>('checking');
  const [printing, setPrinting] = useState(false);
  const [printMessage, setPrintMessage] = useState('');
  const printingRef = useRef(false);

  useEffect(() => {
    let alive = true;
    queryOne<{ value: string }>("SELECT value FROM settings WHERE key = 'store_logo_data_url' LIMIT 1")
      .then((row) => { if (alive) setStoreLogo(row?.value || ''); })
      .catch(() => { if (alive) setStoreLogo(''); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const loaded = await getSaleById(saleId);
      if (!alive || !loaded) return;
      setSale(loaded);
      // IMEI réel (et non l'identifiant interne) pour chaque ligne sérialisée
      setLines(await query<SaleLine & { imei1: string | null }>(
        `SELECT sl.*, iu.imei1 FROM sale_lines sl LEFT JOIN imei_units iu ON iu.id = sl.imei_unit_id WHERE sl.sale_id = $1`, [saleId]));
      setPayments(await getSalePayments(saleId));
      const seller = await queryOne<{ name: string }>('SELECT name FROM users WHERE id = $1', [loaded.user_id]);
      setSellerName(seller?.name ?? '');
      if (loaded.customer_id) {
        const customer = await queryOne<{ name: string }>('SELECT name FROM customers WHERE id = $1', [loaded.customer_id]);
        setCustomerName(customer?.name ?? 'Client enregistré');
      }
      const check = await verifyReceipt(loaded.receipt_ref || loaded.ticket_number);
      if (alive) setIntegrity(check.status === 'authentic' || check.status === 'tampered' || check.status === 'legacy' ? check.status : 'legacy');
    })();
    return () => { alive = false; };
  }, [saleId]);

  if (!sale || !store) return null;

  const currency = sale.currency_code || store.currency;
  const decimals = currency === 'CDF' ? 0 : store.currency_decimals;
  const ref = sale.receipt_ref || '';
  // Message de fin : « ETS SEKAS vous remercie ! ». Un texte personnalisé saisi dans les
  // Paramètres est conservé ; l'ancien texte par défaut est remplacé.
  const customFooter = (store.footer_text || '').trim();
  const footerText = !customFooter || /^merci de votre visite\s*!?$/i.test(customFooter) ? `${store.name} vous remercie !` : customFooter;

  const handlePrint = async (method: 'thermal' | 'system' | 'share') => {
    if (printingRef.current) return; // verrou synchrone contre le double-clic
    printingRef.current = true;
    setPrinting(true);
    setPrintMessage('');
    try {
      const printContent = document.getElementById('ticket-print');
      if (!printContent) throw new Error('Le contenu du reçu est introuvable.');
      if (method === 'thermal') {
        const result = await printThermalReceipt(printContent, Number(store.ticket_width) || 58);
        setPrintMessage(`Commande envoyée${result.deviceName ? ` à « ${result.deviceName} »` : ' à l’imprimante'}. Vérifie la sortie papier; le navigateur ne peut pas confirmer physiquement l’impression.`);
      } else if (method === 'share') {
        const shareResult = await shareReceiptNative(printContent, sale.ticket_number);
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
    legacy: { icon: ShieldQuestion, text: 'Reçu antérieur au système de référence : non certifiable', cls: 'bg-amber-50 text-amber-800' },
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

          <div id="ticket-print" className="bg-white border border-slate-200 rounded-lg p-3 font-mono text-xs text-slate-900">
            {storeLogo && <div className="mb-2 flex justify-center"><img src={storeLogo} alt={`Logo ${store.name}`} className="block max-h-20 max-w-[75%] object-contain" style={{ imageRendering: 'auto' }} /></div>}
            <div className="center bold mb-1 text-center font-bold">{store.name}</div>
            <div className="center text-center">{store.address}</div>
            <div className="center text-center">Tel: {store.phone}</div>
            <div className="sep border-t border-dashed border-slate-400 my-1" />
            <div>Ticket: {sale.ticket_number}</div>
            {ref && <div className="ref font-bold tracking-wide break-all">Réf. : {ref}</div>}
            <div>Date: {formatDateTime(sale.sale_date)}</div>
            <div>Vendeur: {sellerName || '—'}</div>
            <div>Client: {customerName}</div>
            {sale.exchange_rate && sale.exchange_rate > 1 && <div>Taux vente: {sale.exchange_rate.toLocaleString('fr-FR')} CDF/USD</div>}
            {sale.exchange_rate_buy && sale.exchange_rate_buy > 1 && <div>Taux échange: {sale.exchange_rate_buy.toLocaleString('fr-FR')} CDF/USD</div>}
            <div className="sep border-t border-dashed border-slate-400 my-1" />
            <table className="w-full">
              <tbody>
                {lines.map((line) => (
                  <tr key={line.id}>
                    <td colSpan={2}>
                      {line.product_name}
                      {line.imei1 && <div className="text-[10px]">IMEI: {line.imei1}</div>}
                    </td>
                  </tr>
                )).flatMap((row, i) => [row,
                  <tr key={lines[i].id + '-qty'}>
                    <td>{lines[i].quantity} x {formatCurrency(lines[i].unit_price, currency, decimals)}</td>
                    <td className="right text-right">{formatCurrency(lines[i].line_total, currency, decimals)}</td>
                  </tr>])}
              </tbody>
            </table>
            <div className="sep border-t border-dashed border-slate-400 my-1" />
            <table className="w-full">
              <tbody>
                <tr><td>Sous-total</td><td className="right text-right">{formatCurrency(sale.subtotal, currency, decimals)}</td></tr>
                {sale.discount > 0 && <tr><td>Remise</td><td className="right text-right">-{formatCurrency(sale.discount, currency, decimals)}</td></tr>}
                {sale.tax_amount > 0 && <tr><td>TVA</td><td className="right text-right">{formatCurrency(sale.tax_amount, currency, decimals)}</td></tr>}
                <tr className="bold font-bold"><td>TOTAL</td><td className="right text-right">{formatCurrency(sale.total, currency, decimals)}</td></tr>
                {(sale.exchange_rate ?? 1) > 1 && <tr><td>Équivalent CDF</td><td className="right text-right">{(sale.total * (sale.exchange_rate ?? 1)).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} CDF</td></tr>}
              </tbody>
            </table>
            <div className="sep border-t border-dashed border-slate-400 my-1" />
            <table className="w-full">
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>{paymentLabel(p.payment_method)} ({p.currency_code || currency})</td>
                    <td className="right text-right">{formatCurrency((p.original_amount ?? p.amount), p.currency_code || currency, (p.currency_code || currency) === 'CDF' ? 0 : store.currency_decimals)}<div className="text-[10px]">≈ {formatCurrency(p.amount, currency, decimals)}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(sale.change_amount ?? 0) > 0 && <><div className="sep border-t border-dashed border-slate-400 my-1" /><div className="bold font-bold">Monnaie rendue: {(sale.change_amount ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: sale.change_currency === 'CDF' ? 0 : 2 })} {sale.change_currency || currency}</div></>}
            <div className="sep border-t border-dashed border-slate-400 my-1" />
            <div className="center text-center mt-2">{footerText}</div>
          </div>
        </div>

        {printMessage && <div className="mx-4 mb-2 rounded-lg bg-slate-100 p-2 text-xs text-slate-700" role="status">{printMessage}</div>}
        <div className="p-4 border-t border-slate-200 flex flex-wrap gap-2 sticky bottom-0 bg-white">
          <button type="button" onClick={() => void handlePrint('thermal')} disabled={printing} className="btn-primary flex-1 disabled:opacity-60" title="Imprimer sur une imprimante thermique Bluetooth compatible"><Printer className="w-4 h-4" />{printing ? 'Envoi…' : 'Thermique Bluetooth'}</button>
          <button type="button" onClick={() => void handlePrint('system')} disabled={printing} className="btn-secondary flex-1 disabled:opacity-60"><Printer className="w-4 h-4" />Impression système / PDF</button>
          {canShareReceiptNative() && <button type="button" onClick={() => void handlePrint('share')} disabled={printing} className="btn-secondary flex-1 disabled:opacity-60" title="Partager le texte du reçu via la feuille de partage native"><ReceiptIcon className="w-4 h-4" />Partager le reçu</button>}
          <button onClick={() => shareReceiptOnWhatsApp({ store: store.name, ticket: sale.ticket_number, reference: ref, date: formatDateTime(sale.sale_date), total: formatCurrency(sale.total, currency, decimals) })} className="btn-secondary" title="Partager la référence du reçu via WhatsApp"><MessageCircle className="w-4 h-4" /> WhatsApp</button>
          <button onClick={onClose} className="btn-secondary">Fermer</button>
        </div>
      </div>
    </div>
  );
}
