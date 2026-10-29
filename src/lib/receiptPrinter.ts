/** Impression thermique best-effort. Le Web Bluetooth ne prend en charge que les imprimantes BLE exposant un service UART connu; les imprimantes Bluetooth classiques (SPP) nécessitent le pont natif Android/iOS. */
export type PrinterResult = { method: 'native' | 'ble'; deviceName?: string };

type NativePrinterBridge = {
  printRawBytes?: (args: { base64: string; widthMm: number; encoding: 'escpos' }) => Promise<unknown> | unknown;
  printText?: (args: { text: string; widthMm: number }) => Promise<unknown> | unknown;
};
type BluetoothCharacteristicLike = {
  uuid?: string;
  properties?: { write?: boolean; writeWithoutResponse?: boolean };
  writeValue(value: BufferSource): Promise<void>;
  writeValueWithoutResponse?: (value: BufferSource) => Promise<void>;
};
type BluetoothServiceLike = { getCharacteristic(uuid: string): Promise<BluetoothCharacteristicLike>; getCharacteristics?: () => Promise<BluetoothCharacteristicLike[]> };
type BluetoothServerLike = { getPrimaryService(uuid: string): Promise<BluetoothServiceLike> };
type BluetoothDeviceLike = { name?: string; gatt?: { connect(): Promise<BluetoothServerLike>; connected?: boolean; disconnect(): void } };
type BluetoothApiLike = { requestDevice(options: { acceptAllDevices?: boolean; filters?: Array<{ services?: string[]; namePrefix?: string }>; optionalServices?: string[] }): Promise<BluetoothDeviceLike> };

declare global { interface Window { teleboutikPrinter?: NativePrinterBridge } }

// UUID candidats décrits dans la référence technique et NUS déjà utilisé par TeleBoutik.
// Ils ne prouvent pas la compatibilité de la P5_300A : le périphérique doit exposer un service et une caractéristique d'écriture.
const CANDIDATE_SERVICES = [
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART (déjà pris en charge)
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '000018f0-0000-1000-8000-00805f9b34fb',
];
const CANDIDATE_CHARACTERISTICS = [
  '6e400002-b5a3-f393-e0a9-e50e24dcca9e',
  '6e400003-b5a3-f393-e0a9-e50e24dcca9e',
];

/**
 * Convertit le texte du re\u00e7u en ASCII imprimable par l'imprimante thermique.
 *
 * Cause des \u00ab ? \u00bb sur le ticket : Intl/toLocaleString('fr-FR') ins\u00e8re une espace fine
 * ins\u00e9cable (U+202F) comme s\u00e9parateur de milliers (\u00ab 2 250 \u00bb, \u00ab 427 500 \u00bb). Elle \u00e9tait
 * remplac\u00e9e par \u00ab ? \u00bb car hors ASCII. On convertit donc d'abord TOUTES les espaces Unicode
 * en espace normale, puis les symboles courants en \u00e9quivalents ASCII, et seulement ensuite
 * on retire les accents. Le \u00ab ? \u00bb ne subsiste que pour un caract\u00e8re r\u00e9ellement inconnu.
 */
function asciiSafe(value: string): string {
  return value
    // espaces Unicode : NBSP, espace fine, espace demi-cadratin, etc. + caract\u00e8res invisibles
    .replace(/[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g, ' ')
    .replace(/[\u200b-\u200d\u2060\ufeff\u00ad]/g, '')
    // symboles typographiques courants \u2192 ASCII
    .replace(/[\u2018\u2019\u201a\u2032]/g, "'")
    .replace(/[\u201c\u201d\u201e\u00ab\u00bb\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[\u2192\u21d2\u27a1]/g, '->')
    .replace(/\u2190/g, '<-')
    .replace(/\u2248/g, '~')
    .replace(/\u00d7/g, 'x')
    .replace(/\u20ac/g, 'EUR')
    .replace(/[\u2022\u00b7]/g, '*')
    .replace(/\u0153/g, 'oe').replace(/\u0152/g, 'OE')
    .replace(/\u00e6/g, 'ae').replace(/\u00c6/g, 'AE')
    // accents : \u00e9 \u2192 e, \u00e7 \u2192 c, etc.
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E\n\r\t]/g, '?');
}
function wrapLine(line: string, width: number): string[] {
  const s = line.replace(/\s+/g, ' ').trim();
  if (!s) return [''];
  const result: string[] = [];
  for (let i = 0; i < s.length; i += width) result.push(s.slice(i, i + width));
  return result;
}
async function buildLogoRaster(dataUrl: string, widthMm: number): Promise<Uint8Array> {
  const image = new Image();
  image.src = dataUrl;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Le logo de la boutique ne peut pas être chargé pour l’impression.'));
  });
  // Largeurs d’impression courantes : 384 points en 58 mm, 576 en 80 mm.
  const maxWidth = widthMm >= 80 ? 576 : 384;
  const scale = Math.min(maxWidth / image.naturalWidth, 160 / image.naturalHeight, 1);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Conversion du logo pour l’imprimante impossible.');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const rowBytes = Math.ceil(canvas.width / 8);
  const raster = new Uint8Array(8 + rowBytes * canvas.height);
  // GS v 0 : image raster ESC/POS, mode normal.
  raster.set([0x1d, 0x76, 0x30, 0x00, rowBytes & 0xff, (rowBytes >> 8) & 0xff, canvas.height & 0xff, (canvas.height >> 8) & 0xff]);
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      const luminance = (pixels[i] * 299 + pixels[i + 1] * 587 + pixels[i + 2] * 114) / 1000;
      if (pixels[i + 3] > 20 && luminance < 160) {
        const offset = 8 + y * rowBytes + (x >> 3);
        raster[offset] |= 0x80 >> (x & 7);
      }
    }
  }
  return raster;
}
async function buildEscPos(text: string, widthMm: number, logoDataUrl?: string): Promise<Uint8Array> {
  const columns = widthMm >= 80 ? 48 : 32;
  const body = asciiSafe(text)
    .replace(/\u00a0/g, ' ')
    .replace(/\t+/g, '  |  ')
    .replace(/[ ]+\n/g, '\n')
    .split(/\r?\n/)
    .flatMap((line) => wrapLine(line, columns))
    .join('\n');
  const encoder = new TextEncoder();
  const content = encoder.encode(body + '\n\n\n');
  const logo = logoDataUrl ? await buildLogoRaster(logoDataUrl, widthMm) : new Uint8Array();
  const bytes = new Uint8Array(2 + (logo.length ? logo.length + 6 : 0) + content.length + 3);
  bytes.set([0x1b, 0x40], 0);
  let offset = 2;
  if (logo.length) {
    bytes.set([0x1b, 0x61, 0x01], offset); offset += 3; // centrer le logo
    bytes.set(logo, offset); offset += logo.length;
    bytes.set([0x1b, 0x61, 0x00], offset); offset += 3;
  }
  bytes.set(content, offset);
  bytes.set([0x1d, 0x56, 0x00], offset + content.length);
  return bytes;
}
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 0x8000, bytes.length)));
  return btoa(binary);
}

export function isDirectThermalAvailable(): boolean {
  if (window.teleboutikPrinter?.printRawBytes || window.teleboutikPrinter?.printText) return true;
  return !!(navigator as Navigator & { bluetooth?: BluetoothApiLike }).bluetooth && window.isSecureContext;
}

/** Imprime les données extraites du même contenu de reçu affiché par TicketModal. */
export async function printThermalReceipt(receiptElement: HTMLElement, widthMm: number): Promise<PrinterResult> {
  const text = receiptElement.innerText || receiptElement.textContent || '';
  if (!text.trim()) throw new Error('Le contenu du reçu est vide.');
  const logo = receiptElement.querySelector('img') as HTMLImageElement | null;
  const logoDataUrl = logo?.src?.startsWith('data:image/') ? logo.src : undefined;
  const bytes = await buildEscPos(text, widthMm, logoDataUrl);
  const bridge = window.teleboutikPrinter;
  if (bridge?.printRawBytes) {
    const response = await bridge.printRawBytes({ base64: toBase64(bytes), widthMm, encoding: 'escpos' });
    assertBridgeSuccess(response);
    return { method: 'native' };
  }
  if (bridge?.printText) {
    const response = await bridge.printText({ text, widthMm });
    assertBridgeSuccess(response);
    return { method: 'native' };
  }

  const bluetooth = (navigator as Navigator & { bluetooth?: BluetoothApiLike }).bluetooth;
  if (!bluetooth || !window.isSecureContext) {
    throw new Error('Impression Bluetooth directe indisponible dans ce navigateur. Utilise « Impression système / PDF » ou installe le pont natif compatible avec ton imprimante.');
  }
  let device: BluetoothDeviceLike | undefined;
  try {
    // L'utilisateur choisit explicitement son périphérique dans le sélecteur Android/Chrome.
    // acceptAllDevices permet le diagnostic de services inconnus; seuls les UUID listés
    // peuvent ensuite être interrogés sans erreur de permission GATT.
    device = await bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: CANDIDATE_SERVICES });
    if (!device.gatt) throw new Error('Ce périphérique ne fournit pas de connexion BLE GATT. Si la P5_300A utilise Bluetooth classique SPP, un pont natif Android est nécessaire.');
    const server = await device.gatt.connect();
    let service: BluetoothServiceLike | undefined;
    let serviceUsed = '';
    for (const serviceUuid of CANDIDATE_SERVICES) {
      try { service = await server.getPrimaryService(serviceUuid); serviceUsed = serviceUuid; break; }
      catch { /* ce service candidat n'est pas exposé par ce périphérique */ }
    }
    if (!service) throw new Error(`Le périphérique « ${device.name || 'sélectionné'} » ne présente aucun service BLE reconnu. Les UUID candidats testés ne sont pas une preuve de compatibilité P5_300A.`);

    let characteristic: BluetoothCharacteristicLike | undefined;
    for (const characteristicUuid of CANDIDATE_CHARACTERISTICS) {
      try {
        const candidate = await service.getCharacteristic(characteristicUuid);
        if (candidate.properties?.write || candidate.properties?.writeWithoutResponse || !candidate.properties) { characteristic = candidate; break; }
      } catch { /* caractéristique candidate absente */ }
    }
    if (!characteristic && service.getCharacteristics) {
      const all = await service.getCharacteristics();
      characteristic = all.find((item) => item.properties?.write || item.properties?.writeWithoutResponse);
    }
    if (!characteristic) throw new Error(`Service BLE ${serviceUsed} trouvé, mais aucune caractéristique d'écriture compatible n'a été détectée.`);

    // Taille prudente compatible avec le MTU BLE minimal. Petite pause pour limiter
    // les pertes sur les imprimantes qui traitent lentement les commandes ESC/POS.
    const chunkSize = 20;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const chunk = bytes.slice(offset, Math.min(offset + chunkSize, bytes.length));
      if (characteristic.properties?.writeWithoutResponse && characteristic.writeValueWithoutResponse) await characteristic.writeValueWithoutResponse(chunk);
      else await characteristic.writeValue(chunk);
      if (offset + chunkSize < bytes.length) await new Promise((resolve) => setTimeout(resolve, 35));
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
    device.gatt.disconnect();
    return { method: 'ble', deviceName: device.name };
  } catch (error) {
    try { device?.gatt?.disconnect(); } catch { /* best effort */ }
    if (error instanceof Error && /cancel|dismiss/i.test(error.name + ' ' + error.message)) throw new Error('Sélection de l’imprimante annulée. Aucun reçu n’a été envoyé.');
    throw error instanceof Error ? error : new Error('Échec de la connexion ou de l’envoi Bluetooth.');
  }
}

/** Ouvre la boîte d’impression système avec la même mise en page HTML; ne touche jamais à la vente enregistrée. */
export function printReceiptHtml(receiptElement: HTMLElement, ticketNumber: string, widthMm: number): Promise<void> {
  const win = window.open('', '_blank', 'popup,width=420,height=700');
  if (!win) throw new Error('La fenêtre d’impression a été bloquée. Autorise les fenêtres contextuelles puis réessaie.');
  const clone = receiptElement.cloneNode(true) as HTMLElement;
  clone.removeAttribute('id');
  win.document.open();
  win.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reçu ${escapeHtml(ticketNumber)}</title><style>
    @page{size:${widthMm}mm auto;margin:2mm}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#000}body{font-family:'Courier New',monospace;font-size:10pt;width:${Math.max(48,widthMm-4)}mm;line-height:1.25}#receipt{border:0!important;border-radius:0!important;padding:0!important;width:100%;font:inherit;color:#000!important;background:#fff!important}#receipt *{color:#000!important;background:transparent!important;border-color:#777!important;box-shadow:none!important}table{width:100%;border-collapse:collapse}td{padding:1px 0;vertical-align:top}.right{text-align:right}.ref{overflow-wrap:anywhere}.sep{border-top:1px dashed #000;margin:4px 0}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style></head><body></body></html>`);
  const target = win.document.body;
  clone.id = 'receipt';
  target.appendChild(clone);
  win.document.close();
  return new Promise((resolve, reject) => {
    let finished = false;
    const cleanup = () => {
      if (finished) return;
      finished = true;
      clearTimeout(safetyUnlock);
      try { win.close(); } catch { /* le navigateur peut garder la fenêtre */ }
      resolve();
    };
    win.addEventListener('afterprint', cleanup, { once: true });
    // Certains navigateurs mobiles ne déclenchent pas afterprint. On libère alors
    // le verrou de l'interface, mais on ne ferme pas la fenêtre de destination.
    const safetyUnlock = setTimeout(() => { if (!finished) { finished = true; resolve(); } }, 120000);
    try {
      win.focus();
      win.requestAnimationFrame(() => {
        try { win.print(); }
        catch (error) { clearTimeout(safetyUnlock); finished = true; reject(error instanceof Error ? error : new Error('Impossible d’ouvrir la boîte d’impression.')); }
      });
    } catch (error) {
      clearTimeout(safetyUnlock);
      finished = true;
      reject(error instanceof Error ? error : new Error('Impossible d’ouvrir la boîte d’impression.'));
    }
  });
}
function assertBridgeSuccess(response: unknown): void {
  if (response === false || (response && typeof response === 'object' && 'success' in response && (response as { success?: unknown }).success === false)) {
    const detail = response && typeof response === 'object' && 'error' in response ? String((response as { error?: unknown }).error ?? '') : '';
    throw new Error(detail || 'Le pont natif a signalé un échec d’impression.');
  }
}

/** Partage le contenu textuel du même reçu via la feuille de partage native (iOS/Android compatibles). */
export async function shareReceiptNative(receiptElement: HTMLElement, ticketNumber: string): Promise<'shared' | 'cancelled' | 'unsupported'> {
  const text = (receiptElement.innerText || receiptElement.textContent || '').trim();
  if (!text) throw new Error('Le contenu du reçu est vide.');
  if (typeof navigator.share !== 'function') return 'unsupported';
  try {
    await navigator.share({ title: `Reçu TeleBoutik ${ticketNumber}`, text });
    return 'shared';
  } catch (error) {
    // L'annulation volontaire de la feuille de partage n'est pas une erreur de vente.
    if (error instanceof Error && error.name === 'AbortError') return 'cancelled';
    throw error instanceof Error ? error : new Error('Le partage natif a échoué.');
  }
}

export function canShareReceiptNative(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
}
