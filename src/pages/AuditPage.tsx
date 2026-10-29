import { useState, useEffect, useCallback, Fragment } from 'react';
import { ScrollText, Filter, Search, ChevronRight, ChevronDown, Download } from 'lucide-react';
import { exportAuditCsv } from '../lib/secureBackup';
import { query } from '../db/localDb';
import { useAuth } from '../context/AuthContext';
import { formatDateTime, roleLabel } from '../lib/utils';
import type { AuditLog } from '../types';

export default function AuditPage() {
  const { user } = useAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [search, setSearch] = useState('');
  const [entityFilter, setEntityFilter] = useState('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const loadLogs = useCallback(async () => {
    let sql = `SELECT * FROM audit_log`;
    const params: unknown[] = [];
    const conditions: string[] = [];
    if (entityFilter !== 'all') {
      conditions.push(`entity = $${params.length + 1}`);
      params.push(entityFilter);
    }
    if (search) {
      conditions.push(`(LOWER(action) LIKE $${params.length + 1} OR LOWER(entity) LIKE $${params.length + 2})`);
      params.push(`%${search.toLowerCase()}%`, `%${search.toLowerCase()}%`);
    }
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY created_at DESC LIMIT 500';
    setLogs(await query<AuditLog>(sql, params));
  }, [entityFilter, search]);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  if (!user) return null;

  const entityOptions = [
    { value: 'all', label: 'Toutes' },
    { value: 'sale', label: 'Ventes' },
    { value: 'cash_session', label: 'Caisse' },
    { value: 'cash_movement', label: 'Mouvements caisse' },
    { value: 'product', label: 'Produits' },
    { value: 'stock_movement', label: 'Stock' },
    { value: 'auth', label: 'Connexions' },
  ];

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
          <ScrollText className="w-6 h-6 text-primary-600" />
          Piste d'Audit
        </h1>
        <p className="text-sm text-slate-500">Journal d’audit avec chaînage des empreintes ({logs.length} entrées chargées)</p>
        <button className="btn-secondary mt-3" onClick={() => void exportAuditCsv()}><Download className="w-4 h-4" /> Exporter tout le journal (CSV)</button>
      </div>

      <div className="mb-4 flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher..."
            className="input pl-9"
          />
        </div>
        <select value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)} className="input max-w-[180px]">
          {entityOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium text-slate-600">Date/Heure</th>
              <th className="text-left px-4 py-2.5 font-medium text-slate-600">Utilisateur</th>
              <th className="text-left px-4 py-2.5 font-medium text-slate-600">Entité</th>
              <th className="text-left px-4 py-2.5 font-medium text-slate-600">Action</th>
              <th className="text-left px-4 py-2.5 font-medium text-slate-600">Hash</th>
              <th className="text-center px-4 py-2.5 font-medium text-slate-600"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {logs.map((log) => (
              <Fragment key={log.id}>
                <tr
                  className="hover:bg-slate-50 cursor-pointer"
                  onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                >
                  <td className="px-4 py-2 text-xs text-slate-500">{formatDateTime(log.created_at)}</td>
                  <td className="px-4 py-2 text-slate-700">{log.user_role}</td>
                  <td className="px-4 py-2">
                    <span className="badge-primary">{log.entity}</span>
                  </td>
                  <td className="px-4 py-2 text-slate-700 font-medium">{log.action}</td>
                  <td className="px-4 py-2 font-mono text-[10px] text-slate-400">{log.hash?.substring(0, 16)}...</td>
                  <td className="px-4 py-2 text-center">
                    {expanded === log.id ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                  </td>
                </tr>
                {expanded === log.id && (
                  <tr className="bg-slate-50">
                    <td colSpan={6} className="px-4 py-3">
                      <div className="grid grid-cols-2 gap-4 text-xs">
                        {log.before_data && (
                          <div>
                            <p className="font-semibold text-slate-600 mb-1">Avant</p>
                            <pre className="bg-white rounded p-2 overflow-x-auto text-slate-600 border border-slate-200">{log.before_data}</pre>
                          </div>
                        )}
                        {log.after_data && (
                          <div>
                            <p className="font-semibold text-slate-600 mb-1">Après</p>
                            <pre className="bg-white rounded p-2 overflow-x-auto text-slate-600 border border-slate-200">{log.after_data}</pre>
                          </div>
                        )}
                        <div className="col-span-2">
                          <p className="font-semibold text-slate-600 mb-1">Intégrité chaîne</p>
                          <p className="text-slate-500">Hash précédent: <span className="font-mono">{log.prev_hash || '(origine)'}</span></p>
                          <p className="text-slate-500">Hash actuel: <span className="font-mono">{log.hash}</span></p>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {logs.length === 0 && (
          <div className="p-8 text-center text-slate-400 text-sm">Aucune entrée d'audit</div>
        )}
      </div>
    </div>
  );
}
