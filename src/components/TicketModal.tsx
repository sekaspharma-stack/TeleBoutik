import { useState, useEffect } from 'react';
import { X, Printer, Check } from 'lucide-react';
import { getSaleById, getSaleLines, getSalePayments } from '../db/saleService';
import { useAuth } from '../context/AuthContext';
import { formatCurrency, formatDateTime, paymentLabel } from '../lib/utils';
import type { Sale, SaleLine, SalePayment } from '../types';

export default function TicketModal({ saleId, onClose }: { saleId: string; onClose: () => void }) {
  const { store, user } = useAuth();
  const [sale, setSale] = useState<Sale | null>(null);
  const [lines, setLines] = useState<SaleLine[]>([]);
  const [payments, setPayments] = useState<SalePayment[]>([]);

  useEffect(() => {
    (async () => {
      setSale(await getSaleById(saleId));
      setLines(await getSaleLines(saleId));
      setPayments(await getSalePayments(saleId));
    })();
  }, [saleId]);

  if (!sale || !store) return null;

  const currency = store.currency;
  const decimals = store.currency_decimals;
  const width = store.ticket_width === '58' ? 'max-w-xs' : 'max-w-sm';

  const handlePrint = () => {
    const printContent = document.getElementById('ticket-print');
    if (!printContent) return;
    const win = window.open('', '', 'width=400,height=600');
    if (!win) return;
    win.document.write(`
      <html><head><title>Ticket ${sale.ticket_number}</title>
      <style>
        body { font-family: 'Courier New', monospace; font-size: 12px; margin: 0; padding: 8px; width: ${store.ticket_width}mm; }
        .center { text-align: center; }
        .bold { font-weight: bold; }
        .sep { border-top: 1px dashed #000; margin: 4px 0; }
        table { width: 100%; border-collapse: collapse; }
        td { padding: 1px 0; }
        .right { text-align: right; }
      </style></head><body>${printContent.innerHTML}</body></html>
    `);
    win.document.close();
    win.print();
    win.close();
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full ${width} animate-scale-in max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} style={{ maxWidth: store.ticket_width === '58' ? '320px' : '400px' }}>
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-success-100 rounded-full flex items-center justify-center">
              <Check className="w-5 h-5 text-success-600" />
            </div>
            <h2 className="text-lg font-semibold text-slate-800">Vente réussie</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4">
          <div id="ticket-print" className="bg-white border border-slate-200 rounded-lg p-3 font-mono text-xs">
            <div className="center bold mb-1">{store.name}</div>
            <div className="center">{store.address}</div>
            <div className="center">Tel: {store.phone}</div>
            <div className="sep" />
            <div>Ticket: {sale.ticket_number}</div>
            <div>Date: {formatDateTime(sale.sale_date)}</div>
            <div>Vendeur: {user?.name}</div>
            <div className="sep" />
            <table>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.id}>
                    <td colSpan={2}>
                      {line.product_name}
                      {line.imei_unit_id && <div className="text-[10px]">IMEI: {lines.find(l => l.id === line.id)?.imei_unit_id?.substring(0, 15)}</div>}
                    </td>
                  </tr>
                ))}
                {lines.map((line) => (
                  <tr key={line.id + '-qty'}>
                    <td>{line.quantity} x {formatCurrency(line.unit_price, currency, decimals)}</td>
                    <td className="right">{formatCurrency(line.line_total, currency, decimals)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="sep" />
            <table>
              <tbody>
                <tr>
                  <td>Sous-total</td>
                  <td className="right">{formatCurrency(sale.subtotal, currency, decimals)}</td>
                </tr>
                {sale.discount > 0 && (
                  <tr>
                    <td>Remise</td>
                    <td className="right">-{formatCurrency(sale.discount, currency, decimals)}</td>
                  </tr>
                )}
                {sale.tax_amount > 0 && (
                  <tr>
                    <td>TVA</td>
                    <td className="right">{formatCurrency(sale.tax_amount, currency, decimals)}</td>
                  </tr>
                )}
                <tr className="bold">
                  <td>TOTAL</td>
                  <td className="right">{formatCurrency(sale.total, currency, decimals)}</td>
                </tr>
              </tbody>
            </table>
            <div className="sep" />
            <table>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>{paymentLabel(p.payment_method)}</td>
                    <td className="right">{formatCurrency(p.amount, currency, decimals)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="sep" />
            <div className="center mt-2">{store.footer_text}</div>
            <div className="center text-[10px] mt-1">Garantie: voir conditions en boutique</div>
          </div>
        </div>

        <div className="p-4 border-t border-slate-200 flex gap-2">
          <button onClick={handlePrint} className="btn-primary flex-1">
            <Printer className="w-4 h-4" />
            Imprimer
          </button>
          <button onClick={onClose} className="btn-secondary">
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
