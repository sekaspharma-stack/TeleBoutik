import { useState, useEffect } from 'react';
import { X, Printer, Check, ShieldCheck, ShieldAlert, ShieldQuestion, Receipt as ReceiptIcon } from 'lucide-react';
import { getSaleById, getSaleLines, getSalePayments } from '../db/saleService';
import { query, queryOne } from '../db/localDb';
import { useAuth } from '../context/AuthContext';
import { formatCurrency, formatDateTime, paymentLabel } from '../lib/utils';
import { verifyReceipt } from '../lib/receipt';
import type { Sale, SaleLine, SalePayment } from '../types';

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
  const [integrity, setIntegrity] = useState<Integrity>('checking');

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

  const handlePrint = () => {
    const printContent = document.getElementById('ticket-print');
    if (!printContent) return;
    const win = window.open('', '', 'width=400,height=600');
    if (!win) return;
    win.document.write(`
      <html><head><title>Ticket ${sale.ticket_number}</title>
      <style>
        body { font-family: 'Courier New', monospace; font-size: 12px; margin: 0; padding: 8px; width: ${store.ticket_width}mm; color: #000; background: #fff; }
        .center { text-align: center; }
        .bold { font-weight: bold; }
        .sep { border-top: 1px dashed #000; margin: 4px 0; }
        table { width: 100%; border-collapse: collapse; }
        td { padding: 1px 0; }
        .right { text-align: right; }
        .ref { font-size: 13px; font-weight: bold; letter-spacing: 1px; word-break: break-all; }
      </style></head><body>${printContent.innerHTML}</body></html>
    `);
    win.document.close();
    win.print();
    win.close();
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
            {ref && <div className="center text-center text-[10px]">Vérifiez ce reçu dans Ventes → « Vérifier un reçu » avec la référence ci-dessus.</div>}
            <div className="center text-center mt-2">{store.footer_text}</div>
            <div className="center text-center text-[10px] mt-1">Garantie: voir conditions en boutique</div>
          </div>
        </div>

        <div className="p-4 border-t border-slate-200 flex gap-2 sticky bottom-0 bg-white">
          <button onClick={handlePrint} className="btn-primary flex-1"><Printer className="w-4 h-4" />Imprimer</button>
          <button onClick={onClose} className="btn-secondary">Fermer</button>
        </div>
      </div>
    </div>
  );
}
