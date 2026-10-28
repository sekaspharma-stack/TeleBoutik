import { getDb, query } from '../db/localDb';
import { generateId, now } from '../db/localDb';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Date métier fixe pour la RDC : les exports ne changent pas de jour selon le fuseau du poste.
function businessDate(): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lubumbashi', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function deriveKey(passphrase: string, salt: Uint8Array) {
  if (!crypto.subtle) throw new Error('Le chiffrement nécessite un navigateur moderne en HTTPS ou localhost.');
  const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
}

export async function exportEncryptedBackup(passphrase: string): Promise<void> {
  if (passphrase.trim().length < 12) throw new Error('Choisis une phrase secrète de 12 caractères minimum.');
  const db = await getDb();
  const tables = await query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name");
  const payload: Record<string, unknown[]> = {};
  for (const { table_name } of tables) {
    if (table_name === 'backup_records') continue;
    const result = await db.query(`SELECT * FROM "${table_name.replace(/"/g, '""')}"`);
    payload[table_name] = result.rows as unknown[];
  }
  const plain = encoder.encode(JSON.stringify({ format: 'teleboutik-encrypted-backup-v1', createdAt: now(), tables: payload }));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
  const bundle = { format: 'TeleBoutik AES-GCM backup v1', kdf: 'PBKDF2-SHA256-310000', salt: toBase64(salt), iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(cipher)) };
  downloadBlob(new Blob([JSON.stringify(bundle)], { type: 'application/json' }), `teleboutik-backup-${businessDate()}.tbak`);
}

export async function exportAuditCsv(): Promise<void> {
  const rows = await query<Record<string, unknown>>('SELECT * FROM audit_log ORDER BY created_at ASC');
  const columns = ['id','user_id','user_role','entity','action','before_data','after_data','prev_hash','hash','created_at'];
  const csv = [columns.join(';'), ...rows.map(row => columns.map(key => csvCell(row[key])).join(';'))].join('\r\n');
  downloadBlob(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }), `teleboutik-audit-${businessDate()}.csv`);
}

export async function exportDailyBusinessCsv(): Promise<void> {
  const date = businessDate();
  const sales = await query<Record<string, unknown>>('SELECT ticket_number, receipt_ref, sale_date, store_id, customer_id, subtotal, discount, tax_amount, total, total_cost, currency_code, status FROM sales WHERE sale_date::date = $1::date ORDER BY sale_date', [date]);
  const columns = ['ticket_number','receipt_ref','sale_date','store_id','customer_id','subtotal','discount','tax_amount','total','total_cost','currency_code','status'];
  const csv = [columns.join(';'), ...sales.map(row => columns.map(key => csvCell(row[key])).join(';'))].join('\r\n');
  downloadBlob(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }), `teleboutik-ventes-${date}.csv`);
}

function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}
function toBase64(bytes: Uint8Array): string {
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function shareReceiptOnWhatsApp(input: { store: string; ticket: string; reference: string; date: string; total: string; phone?: string }) {
  const message = `${input.store}\nReçu / facture : ${input.ticket}\nRéférence : ${input.reference || input.ticket}\nDate : ${input.date}\nTotal : ${input.total}\n\nPour obtenir le reçu PDF, ouvrez le ticket dans TeleBoutik puis choisissez Imprimer → Enregistrer au format PDF.`;
  const phone = (input.phone ?? '').replace(/\D/g, '');
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}
