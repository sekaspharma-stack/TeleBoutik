import { query, queryOne, execute, generateId, now, withLocalTransaction, type LocalTx } from './localDb';
import { sha256Hex } from '../lib/pin';
import type { User } from '../types';

/** Un JSON ré-encodé par le cloud peut changer l'ordre des clés : on le normalise avant de hacher. */
function canonicalJson(text: string | null): string {
  if (!text) return '';
  try {
    const sort = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(sort);
      if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value as object).sort().map((k) => [k, sort((value as Record<string, unknown>)[k])]));
      }
      return value;
    };
    return JSON.stringify(sort(JSON.parse(text)));
  } catch {
    return text;
  }
}

interface AuditHashFields {
  id: string;
  user_id: string;
  user_role: string;
  entity: string;
  action: string;
  before_data: string | null;
  after_data: string | null;
  created_at: string;
}

/** hash = SHA-256( prev_hash + contenu de l'entrée ) — 64 caractères hexadécimaux. */
export async function computeAuditHash(prevHash: string, f: AuditHashFields): Promise<string> {
  const content = JSON.stringify([f.id, f.user_id, f.user_role, f.entity, f.action, canonicalJson(f.before_data), canonicalJson(f.after_data), f.created_at]);
  return sha256Hex(`${prevHash}|${content}`);
}

/** Dernier maillon de la chaîne. À égalité de seconde, on prend celui qu'aucune autre entrée ne référence. */
async function getChainHead(run: LocalTx): Promise<string> {
  const latest = await run.queryOne<{ created_at: string }>('SELECT MAX(created_at) AS created_at FROM audit_log');
  if (!latest?.created_at) return '';
  const rows = await run.query<{ hash: string; prev_hash: string | null }>(
    'SELECT hash, prev_hash FROM audit_log WHERE created_at = $1',
    [latest.created_at]
  );
  if (rows.length <= 1) return rows[0]?.hash ?? '';
  const referenced = new Set(rows.map((r) => r.prev_hash ?? ''));
  return (rows.find((r) => !referenced.has(r.hash)) ?? rows[0]).hash;
}

async function appendAuditEntry(run: LocalTx, user: Pick<User, 'id' | 'role'>, entity: string, action: string, before: string | null, after: string | null): Promise<void> {
  const prevHash = await getChainHead(run);
  const fields: AuditHashFields = {
    id: generateId(), user_id: user.id, user_role: user.role, entity, action,
    before_data: before, after_data: after, created_at: now(),
  };
  const hash = await computeAuditHash(prevHash, fields);
  await run.execute(
    `INSERT INTO audit_log (id, user_id, user_role, entity, action, before_data, after_data, prev_hash, hash, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [fields.id, fields.user_id, fields.user_role, entity, action, before, after, prevHash, hash, fields.created_at]
  );
}

export async function addAuditLog(
  user: Pick<User, 'id' | 'role'>,
  entity: string,
  action: string,
  beforeData: unknown = null,
  afterData: unknown = null,
  /** Transaction en cours : obligatoire à l'intérieur de withLocalTransaction (sinon l'écriture attendrait la fin de la transaction). */
  tx?: LocalTx
): Promise<void> {
  const before = beforeData ? JSON.stringify(beforeData) : null;
  const after = afterData ? JSON.stringify(afterData) : null;
  if (tx) {
    await appendAuditEntry(tx, user, entity, action, before, after);
    return;
  }
  // Lecture du dernier maillon + insertion dans une même transaction : pas de bifurcation si deux écritures se croisent.
  await withLocalTransaction((t) => appendAuditEntry(t, user, entity, action, before, after));
}

export interface AuditChainReport {
  total: number;
  /** Entrées dont le hash SHA-256 a été recalculé et trouvé conforme. */
  verified: number;
  /** Anciennes entrées (hash 32 bits) : non vérifiables, antérieures à la correction. */
  legacy: number;
  /** Entrées dont le contenu ne correspond plus à leur hash (modifiées après coup). */
  altered: string[];
  /** Entrées dont le prev_hash ne correspond à aucune entrée connue (entrée supprimée ou chaîne rompue). */
  brokenLinks: string[];
  /** Entrées sans prev_hash : début de chaîne (normal : 1 par appareil, ou 1 au total sur un seul appareil). */
  chainStarts: number;
}

/** Recalcule toute la chaîne et signale les entrées modifiées ou les liens rompus. */
export async function verifyAuditChain(): Promise<AuditChainReport> {
  const rows = await query<{ id: string; user_id: string; user_role: string; entity: string; action: string; before_data: string | null; after_data: string | null; prev_hash: string | null; hash: string; created_at: string }>(
    'SELECT * FROM audit_log ORDER BY created_at ASC, id ASC'
  );
  const knownHashes = new Set(rows.map((r) => r.hash));
  const report: AuditChainReport = { total: rows.length, verified: 0, legacy: 0, altered: [], brokenLinks: [], chainStarts: 0 };
  for (const row of rows) {
    if (!/^[0-9a-f]{64}$/.test(row.hash)) { report.legacy += 1; continue; }
    const prev = row.prev_hash ?? '';
    if ((await computeAuditHash(prev, row)) === row.hash) report.verified += 1;
    else report.altered.push(row.id);
    if (prev === '') report.chainStarts += 1;
    else if (!knownHashes.has(prev)) report.brokenLinks.push(row.id);
  }
  return report;
}

export async function addSyncOp(
  entity: string,
  operation: 'insert' | 'update' | 'delete' | 'cancel',
  recordId: string,
  data: unknown,
  tx?: LocalTx
): Promise<void> {
  const run = tx ?? { queryOne, execute };
  const clockRow = await run.queryOne<{ max_clock: number }>(
    'SELECT COALESCE(MAX(logical_clock), 0) as max_clock FROM sync_ops'
  );
  const clock = (clockRow?.max_clock ?? 0) + 1;

  await run.execute(
    `INSERT INTO sync_ops (id, entity, operation, record_id, data, logical_clock, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)`,
    [generateId(), entity, operation, recordId, JSON.stringify(data), clock, now()]
  );
}
