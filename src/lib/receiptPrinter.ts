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
/** Hauteur maximale du logo imprimé (points). 100 px ≈ 4 Ko au lieu de 7 Ko : impression nettement plus rapide. */
const LOGO_MAX_HEIGHT = 100;

/**
 * Fin de ticket : UNE seule avance papier calibrée (ESC J n, n points ≈ n/8 mm) puis arrêt net.
 * Plus de lignes vides en rafale ni de GS V (coupe/avance) : le rouleau s'arrête de lui-même
 * juste après la dernière ligne, à la hauteur de la barre de déchirure.
 */
const FEED_END_DOTS = 56;
const END_OF_TICKET = [0x1b, 0x4a, FEED_END_DOTS];

async function buildLogoRaster(dataUrl: string, widthMm: number): Promise<Uint8Array> {
  const image = new Image();
  image.src = dataUrl;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Le logo de la boutique ne peut pas être chargé pour l’impression.'));
  });
  // Largeurs d’impression courantes : 384 points en 58 mm, 576 en 80 mm.
  const maxWidth = widthMm >= 80 ? 576 : 384;
  const scale = Math.min(maxWidth / image.naturalWidth, LOGO_MAX_HEIGHT / image.naturalHeight, 1);
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
  const content = encoder.encode(body + '\n');
  const logo = logoDataUrl ? await buildLogoRaster(logoDataUrl, widthMm) : new Uint8Array();
  const bytes = new Uint8Array(2 + (logo.length ? logo.length + 6 : 0) + content.length + END_OF_TICKET.length);
  bytes.set([0x1b, 0x40], 0);
  let offset = 2;
  if (logo.length) {
    bytes.set([0x1b, 0x61, 0x01], offset); offset += 3; // centrer le logo
    bytes.set(logo, offset); offset += logo.length;
    bytes.set([0x1b, 0x61, 0x00], offset); offset += 3;
  }
  bytes.set(content, offset);
  bytes.set(END_OF_TICKET, offset + content.length);
  return bytes;
}
/** Données déjà formatées du reçu : une seule source pour l'écran, l'impression système et le thermique. */
export type ReceiptData = {
  storeName: string;
  rccm: string;
  phone: string;
  ticket: string;
  ref: string;
  date: string;
  seller: string;
  customer: string;
  lines: Array<{ name: string; imei?: string; qty: string; unit: string; total: string }>;
  subtotal: string;
  total: string;
  payments: Array<{ label: string; amount: string }>;
  change: string;
  warning: string;
  footer: string;
};

type Seg = { text: string; center?: boolean; bold?: boolean; reverse?: boolean };

function wrapWords(value: string, width: number): string[] {
  const words = value.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const out: string[] = [];
  let current = '';
  for (let word of words) {
    while (word.length > width) {
      if (current) { out.push(current); current = ''; }
      out.push(word.slice(0, width)); word = word.slice(width);
    }
    if (!current) current = word;
    else if (current.length + 1 + word.length <= width) current += ' ' + word;
    else { out.push(current); current = word; }
  }
  if (current) out.push(current);
  return out.length ? out : [''];
}

/** Met en page le reçu en colonnes fixes (32 colonnes en 58 mm, 48 en 80 mm), comme le reçu de référence. */
function layoutReceipt(d: ReceiptData, columns: number, hasLogo: boolean): Seg[] {
  const a = asciiSafe;
  const segs: Seg[] = [];
  const rule = (ch: string) => segs.push({ text: ch.repeat(columns) });
  const centered = (text: string, bold = false) => wrapWords(a(text), columns).forEach((t) => segs.push({ text: t, center: true, bold }));
  const pair = (left: string, right: string, bold = false) => {
    const l = a(left), r = a(right);
    if (l.length + r.length + 1 <= columns) segs.push({ text: l + ' '.repeat(columns - l.length - r.length) + r, bold });
    else { wrapWords(l, columns).forEach((t) => segs.push({ text: t, bold })); segs.push({ text: r.padStart(columns), bold }); }
  };

  if (!hasLogo && d.storeName) centered(d.storeName, true);
  if (d.rccm) centered(`RCCM : ${d.rccm}`, true);
  if (d.phone) centered(`Tel: ${d.phone}`);
  rule('=');
  pair('Ticket :', d.ticket, true);
  if (d.ref) wrapWords(a(`Ref. : ${d.ref}`), columns).forEach((t) => segs.push({ text: t }));
  pair('Date :', d.date);
  pair('Vendeur :', d.seller || '-');
  pair('Client :', d.customer, true);
  rule('-');

  const qtyW = 3;
  const puW = columns >= 48 ? 10 : 7;
  const totW = columns >= 48 ? 11 : 8;
  const nameW = columns - qtyW - puW - totW - 3;
  const inline = d.lines.every((l) => a(l.unit).length <= puW && a(l.total).length <= totW && a(l.qty).length <= qtyW);
  if (inline) {
    segs.push({ text: 'LIBELLE'.padEnd(nameW) + ' ' + 'QTE'.slice(0, qtyW).padStart(qtyW) + ' ' + 'P.U.'.padStart(puW) + ' ' + 'TOTAL'.padStart(totW) });
  } else {
    pair('LIBELLE', 'TOTAL');
  }
  rule('-');
  for (const line of d.lines) {
    if (inline) {
      const parts = wrapWords(a(line.name), nameW);
      segs.push({ text: parts[0].padEnd(nameW) + ' ' + a(line.qty).padStart(qtyW) + ' ' + a(line.unit).padStart(puW) + ' ' + a(line.total).padStart(totW), bold: true });
      parts.slice(1).forEach((t) => segs.push({ text: t, bold: true }));
    } else {
      wrapWords(a(line.name), columns).forEach((t) => segs.push({ text: t, bold: true }));
      pair(`${a(line.qty)} x ${a(line.unit)}`, line.total);
    }
    if (line.imei) { segs.push({ text: 'IMEI:' }); wrapWords(a(line.imei), columns).forEach((t) => segs.push({ text: t })); }
  }
  rule('-');
  pair('Sous-total :', d.subtotal);
  const totalLabel = ' TOTAL :', totalValue = a(d.total) + ' ';
  segs.push({ text: totalLabel + ' '.repeat(Math.max(1, columns - totalLabel.length - totalValue.length)) + totalValue, bold: true, reverse: true });
  rule('-');
  d.payments.forEach((p) => pair(`${p.label} :`, p.amount));
  pair('Rendu :', `= ${d.change}`, true);

  // Encadré d'avertissement
  const inner = columns - 4;
  segs.push({ text: '+' + '-'.repeat(columns - 2) + '+' });
  wrapWords(a(d.warning).toUpperCase(), inner).forEach((t) => {
    const left = Math.floor((inner - t.length) / 2);
    segs.push({ text: '| ' + ' '.repeat(left) + t + ' '.repeat(inner - t.length - left) + ' |' });
  });
  segs.push({ text: '+' + '-'.repeat(columns - 2) + '+' });
  segs.push({ text: '' });
  centered(d.footer, true);
  return segs;
}

/** Texte brut (partage, pont natif « texte ») avec la même mise en page que le thermique. */
export function receiptToText(d: ReceiptData, widthMm = 58, hasLogo = false): string {
  const columns = widthMm >= 80 ? 48 : 32;
  return layoutReceipt(d, columns, hasLogo)
    .map((s) => (s.center ? ' '.repeat(Math.max(0, Math.floor((columns - s.text.length) / 2))) + s.text : s.text))
    .join('\n');
}

async function buildEscPosFromData(d: ReceiptData, widthMm: number, logoDataUrl?: string): Promise<Uint8Array> {
  const columns = widthMm >= 80 ? 48 : 32;
  const encoder = new TextEncoder();
  const chunks: number[][] = [[0x1b, 0x40]];
  if (logoDataUrl) {
    chunks.push([0x1b, 0x61, 0x01], Array.from(await buildLogoRaster(logoDataUrl, widthMm)), [0x1b, 0x61, 0x00, 0x0a]);
  }
  for (const seg of layoutReceipt(d, columns, !!logoDataUrl)) {
    chunks.push([0x1b, 0x61, seg.center ? 1 : 0, 0x1b, 0x45, seg.bold ? 1 : 0, 0x1d, 0x42, seg.reverse ? 1 : 0]);
    chunks.push(Array.from(encoder.encode(seg.text + '\n')));
  }
  chunks.push([0x1b, 0x45, 0x00, 0x1d, 0x42, 0x00, 0x1b, 0x61, 0x00], END_OF_TICKET);
  return Uint8Array.from(chunks.flat());
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
export async function printThermalReceipt(receiptElement: HTMLElement, widthMm: number, data?: ReceiptData): Promise<PrinterResult> {
  const logo = receiptElement.querySelector('img') as HTMLImageElement | null;
  const logoDataUrl = logo?.src?.startsWith('data:image/') ? logo.src : undefined;
  const text = data ? receiptToText(data, widthMm, !!logoDataUrl) : (receiptElement.innerText || receiptElement.textContent || '');
  if (!text.trim()) throw new Error('Le contenu du reçu est vide.');
  const bytes = data ? await buildEscPosFromData(data, widthMm, logoDataUrl) : await buildEscPos(text, widthMm, logoDataUrl);
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

    // Envoi par gros paquets : Chrome négocie automatiquement le MTU avec l'imprimante (jusqu'à 512 octets).
    // On essaie 180 octets, puis 100, puis 20 (MTU minimal) si l'imprimante refuse. Avec réponse, chaque
    // écriture est acquittée : aucune pause n'est nécessaire. Sans réponse, une courte pause de 8 ms suffit.
    const useNoResponse = !!(characteristic.properties?.writeWithoutResponse && characteristic.writeValueWithoutResponse);
    const pauseMs = useNoResponse ? 8 : 0;
    const writeChunk = async (chunk: Uint8Array) => {
      const payload = chunk as unknown as BufferSource;
      if (useNoResponse) await characteristic!.writeValueWithoutResponse!(payload);
      else await characteristic!.writeValue(payload);
    };
    const chunkSizes = [180, 100, 20];
    let sizeIndex = 0;
    let offset = 0;
    while (offset < bytes.length) {
      const chunk = bytes.slice(offset, Math.min(offset + chunkSizes[sizeIndex], bytes.length));
      try {
        await writeChunk(chunk);
      } catch (writeError) {
        // Paquet trop grand pour le MTU réel : on réduit la taille et on renvoie le même morceau.
        if (sizeIndex < chunkSizes.length - 1) { sizeIndex++; continue; }
        throw writeError;
      }
      offset += chunk.length;
      if (pauseMs && offset < bytes.length) await new Promise((resolve) => setTimeout(resolve, pauseMs));
    }
    // Laisse l'imprimante vider son tampon et finir la dernière ligne avant de fermer la liaison.
    // Rien n'est envoyé après la commande de fin de ticket : le rouleau s'arrête proprement.
    await new Promise((resolve) => setTimeout(resolve, 600));
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
    @page{size:${widthMm}mm auto;margin:2mm}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#000}body{font-family:'Courier New',monospace;font-size:10pt;width:${Math.max(48,widthMm-4)}mm;line-height:1.25}#receipt{border:0!important;border-radius:0!important;padding:0!important;width:100%;font:inherit;color:#000!important;background:#fff!important}#receipt *{box-shadow:none!important}table{width:100%;border-collapse:collapse}td{padding:1px 0;vertical-align:top}.right{text-align:right}.ref{overflow-wrap:anywhere}.sep{border-top:1px dashed #000;margin:4px 0}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
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
export async function shareReceiptNative(receiptElement: HTMLElement, ticketNumber: string, data?: ReceiptData): Promise<'shared' | 'cancelled' | 'unsupported'> {
  const text = (data ? receiptToText(data, 58) : (receiptElement.innerText || receiptElement.textContent || '')).trim();
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
