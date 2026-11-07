import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { X, Printer, Receipt as ReceiptIcon, FileText } from 'lucide-react';
import { queryOne } from '../db/localDb';
import { useAuth } from '../context/AuthContext';
import { toReceiptData, type ServiceReceiptInput } from '../lib/serviceReceipt';
import { canShareReceiptNative, printReceiptA4Half, printReceiptHtml, printThermalReceipt, shareReceiptNative } from '../lib/receiptPrinter';

/**
 * Reçu d'un service (Unités & Megas, Airtel Money, cartes SIM).
 * Mêmes modes d'impression que le ticket de caisse : thermique Bluetooth, impression système / PDF,
 * partage natif — plus la facture sur une moitié de feuille A4. Aucune écriture en base.
 */
export default function ServiceReceiptModal({ input, onClose }: { input: ServiceReceiptInput; onClose: () => void }) {
  const { store } = useAuth();
  const [logo, setLogo] = useState('');
  const [rccm, setRccm] = useState('');
  const [ready, setReady] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [message, setMessage] = useState('');
  const lock = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [logoRow, rccmRow] = await Promise.all([
        queryOne<{ value: string }>("SELECT value FROM settings WHERE key = 'store_logo_data_url' LIMIT 1").catch(() => null),
        queryOne<{ value: string }>("SELECT value FROM settings WHERE key = 'store_rccm' LIMIT 1").catch(() => null),
      ]);
      if (!alive) return;
      setLogo(logoRow?.value || '');
      setRccm((rccmRow?.value || '').trim());
      setReady(true);
    })();
    return () => { alive = false; };
  }, []);

  const data = useMemo(() => (store ? toReceiptData(input, store, rccm) : null), [input, store, rccm]);
  if (!store || !data || !ready) return null;
  const widthMm = Number(store.ticket_width) || 58;

  const run = async (method: 'thermal' | 'a4' | 'system' | 'share') => {
    if (lock.current) return; // verrou synchrone contre le double-clic
    lock.current = true; setPrinting(true); setMessage('');
    try {
      const el = document.getElementById('service-ticket-print');
      if (!el) throw new Error('Le contenu du reçu est introuvable.');
      if (method === 'thermal') {
        const r = await printThermalReceipt(el, widthMm, data);
        setMessage(`Commande envoyée${r.deviceName ? ` à « ${r.deviceName} »` : ' à l’imprimante'}. Vérifie la sortie papier.`);
      } else if (method === 'a4') {
        await printReceiptA4Half(data, logo);
        setMessage('Boîte d’impression ouverte : choisis le format A4. La facture occupe la moitié haute de la feuille. L’opération reste enregistrée.');
      } else if (method === 'share') {
        const r = await shareReceiptNative(el, input.ticket, data);
        setMessage(r === 'cancelled' ? 'Partage annulé.' : r === 'unsupported' ? 'Le partage natif n’est pas pris en charge ici.' : 'Feuille de partage native ouverte.');
      } else {
        await printReceiptHtml(el, input.ticket, widthMm);
        setMessage('Boîte d’impression ouverte. L’opération reste enregistrée.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Échec de l’impression. L’opération reste enregistrée.');
    } finally { lock.current = false; setPrinting(false); }
  };

  const row = (label: string, value: string, bold = false): JSX.Element => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span style={{ color: '#444' }}>{label}</span>{bold ? <b>{value}</b> : <span style={{ color: '#444' }}>{value}</span>}</div>
  );

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full animate-scale-in max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} style={{ maxWidth: store.ticket_width === '58' ? '340px' : '420px' }}>
        <div className="p-4 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white z-10">
          <div className="flex items-center gap-2"><ReceiptIcon className="w-5 h-5 text-success-600" /><h2 className="text-lg font-semibold text-slate-800">Reçu</h2></div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Fermer"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 space-y-3">
          {input.cancelled && <div className="rounded-lg bg-error-50 p-2.5 text-xs font-bold text-error-700">OPÉRATION ANNULÉE — ce reçu n’a plus de valeur comptable.</div>}
          <div id="service-ticket-print" style={{ background: '#fff', color: '#000', fontFamily: "'Courier New', Courier, monospace", fontSize: 12, lineHeight: 1.35, padding: '12px 10px', border: '1px solid #e2e8f0', borderRadius: 8 }}>
            <div style={{ textAlign: 'center' }}>
              {logo
                ? <img src={logo} alt={`Logo ${store.name}`} style={{ display: 'block', margin: '0 auto 6px', maxHeight: 64, maxWidth: '80%', objectFit: 'contain' }} />
                : <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 4 }}>{store.name}</div>}
              {rccm && <div style={{ fontWeight: 700, fontSize: 13, letterSpacing: 0.5 }}>RCCM : {rccm}</div>}
              {store.phone && <div style={{ color: '#444' }}>Tél: {store.phone}</div>}
              <div style={{ fontWeight: 700, fontSize: 13, marginTop: 4 }}>{data.title}</div>
            </div>
            <div style={{ borderTop: '2px solid #000', margin: '8px 0' }} />
            {row('Ticket :', data.ticket, true)}
            {row('Date :', data.date)}
            {row('Vendeur :', data.seller || '—')}
            {row('Client :', data.customer, true)}
            {(data.details ?? []).map((d) => <div key={d.label}>{row(`${d.label} :`, d.value)}</div>)}
            <div style={{ borderTop: '1px dashed #000', margin: '8px 0' }} />
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ borderBottom: '1px solid #000' }}>
                <th style={{ textAlign: 'left', padding: '2px 0', fontWeight: 400 }}>LIBELLÉ</th>
                <th style={{ textAlign: 'center', padding: '2px 0', fontWeight: 400 }}>QTÉ</th>
                <th style={{ textAlign: 'right', padding: '2px 0', fontWeight: 400 }}>P.U.</th>
                <th style={{ textAlign: 'right', padding: '2px 0', fontWeight: 400 }}>TOTAL</th>
              </tr></thead>
              <tbody>{data.lines.map((l, i) => (
                <tr key={i} style={{ verticalAlign: 'top' }}>
                  <td style={{ padding: '6px 4px 6px 0' }}><b>{l.name}</b></td>
                  <td style={{ textAlign: 'center', padding: '6px 0' }}>{l.qty}</td>
                  <td style={{ textAlign: 'right', padding: '6px 0 6px 4px', color: '#444', whiteSpace: 'nowrap' }}>{l.unit}</td>
                  <td style={{ textAlign: 'right', padding: '6px 0 6px 4px', fontWeight: 700, whiteSpace: 'nowrap' }}>{l.total}</td>
                </tr>))}</tbody>
            </table>
            <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '2px 0' }}><span>Sous-total :</span><b>{data.subtotal}</b></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, background: '#000', color: '#fff', fontWeight: 700, fontSize: 15, padding: '5px 8px', margin: '6px 0', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' } as CSSProperties}><span>TOTAL :</span><span>{data.total}</span></div>
            <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
            {data.payments.map((p, i) => <div key={i}>{row(`${p.label} :`, p.amount)}</div>)}
            {data.change && <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontWeight: 700 }}><span>Rendu :</span><span>= {data.change}</span></div>}
            <div style={{ border: '2px solid #000', textAlign: 'center', fontSize: 11, padding: '6px 8px', margin: '10px 0', textTransform: 'uppercase' }}>{data.warning}</div>
            <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 13, padding: '4px 0' }}>{data.footer}</div>
          </div>
        </div>
        {message && <div className="mx-4 mb-2 rounded-lg bg-slate-100 p-2 text-xs text-slate-700" role="status">{message}</div>}
        <div className="p-4 border-t border-slate-200 flex flex-wrap gap-2 sticky bottom-0 bg-white">
          <button type="button" onClick={() => void run('thermal')} disabled={printing} className="btn-primary flex-1 disabled:opacity-60"><Printer className="w-4 h-4" />{printing ? 'Envoi…' : 'Thermique Bluetooth'}</button>
          <button type="button" onClick={() => void run('a4')} disabled={printing} className="btn-primary flex-1 disabled:opacity-60" title="Imprimer la facture sur la moitié d’une feuille A4"><FileText className="w-4 h-4" />Facture ½ A4</button>
          <button type="button" onClick={() => void run('system')} disabled={printing} className="btn-secondary flex-1 disabled:opacity-60"><Printer className="w-4 h-4" />Impression système / PDF</button>
          {canShareReceiptNative() && <button type="button" onClick={() => void run('share')} disabled={printing} className="btn-secondary flex-1 disabled:opacity-60"><ReceiptIcon className="w-4 h-4" />Partager le reçu</button>}
          <button onClick={onClose} className="btn-secondary">Fermer</button>
        </div>
      </div>
    </div>
  );
}
