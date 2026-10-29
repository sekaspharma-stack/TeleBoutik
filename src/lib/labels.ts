export function printBarcodeLabel(input: { name: string; sku: string; barcode?: string; imei?: string; price?: string }) {
  const safe = (s: string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] ?? c));
  const code = input.imei || input.barcode || input.sku;
  const win = window.open('', '_blank', 'width=500,height=400');
  if (!win) throw new Error('Autorise les fenêtres surgissantes pour imprimer une étiquette.');
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Étiquette ${safe(code)}</title><style>@page{size:50mm 30mm;margin:2mm}body{font-family:Arial,sans-serif;margin:0;width:46mm;color:#000}.name{font-size:9pt;font-weight:bold;max-height:8mm;overflow:hidden}.code{font:7pt monospace;word-break:break-all;margin-top:1mm}.barcode{font-family:monospace;font-size:15pt;letter-spacing:1px;text-align:center;margin-top:1mm}.price{text-align:right;font-size:9pt;font-weight:bold}</style></head><body><div class="name">${safe(input.name)}</div><div class="barcode">*${safe(code)}*</div><div class="code">${safe(code)}</div>${input.price ? `<div class="price">${safe(input.price)}</div>` : ''}<script>window.onload=()=>window.print()</script></body></html>`);
  win.document.close();
}
