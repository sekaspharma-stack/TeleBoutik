import { RefreshCw, Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { useSync } from '../context/SyncContext';

/**
 * Barre commune des historiques de ventes de services (même esprit que l'historique des Ventes) :
 * résumé du jour, recherche, filtres par statut et bouton « Actualiser » (télécharge les ventes des autres appareils).
 */
export default function ServiceHistoryBar({ search, onSearch, placeholder, filter, onFilter, filters, summary }: {
  search: string;
  onSearch: (value: string) => void;
  placeholder: string;
  filter: string;
  onFilter: (value: string) => void;
  filters: Array<{ value: string; label: string }>;
  summary?: ReactNode;
}) {
  const refreshData = useSync((state) => state.refreshData);
  const isRefreshing = useSync((state) => state.isRefreshing);
  const refreshMessage = useSync((state) => state.refreshMessage);
  return (
    <div className="p-4 border-b border-slate-200 space-y-3">
      {summary && <p className="text-sm text-slate-600">{summary}</p>}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input type="text" className="input pl-9" value={search} onChange={(e) => onSearch(e.target.value)} placeholder={placeholder} />
        </div>
        {filters.map((f) => (
          <button key={f.value} type="button" onClick={() => onFilter(f.value)} className={filter === f.value ? 'btn-primary' : 'btn-secondary'}>{f.label}</button>
        ))}
        <button type="button" onClick={() => void refreshData()} disabled={isRefreshing} className="btn-secondary" title={refreshMessage || 'Télécharger les dernières ventes de tous les utilisateurs'}>
          <RefreshCw className={`w-4 h-4 inline mr-1 ${isRefreshing ? 'animate-spin' : ''}`} />Actualiser
        </button>
      </div>
      {refreshMessage && <p className="text-xs text-slate-500" role="status">{refreshMessage}</p>}
    </div>
  );
}
