import { WifiOff, CloudUpload, RefreshCw, Check, Cloud } from 'lucide-react';
import { useSync } from '../context/SyncContext';

export default function SyncStatusBar() {
  const { isOnline, pendingCount, isSyncing, progress, lastSyncResult, triggerSync } = useSync();

  const showBar = !isOnline || pendingCount > 0 || isSyncing;
  if (!showBar) {
    return (
      <div className="fixed bottom-3 right-3 z-40 flex items-center gap-1.5 px-2.5 py-1.5 bg-white rounded-full shadow-md border border-slate-200 text-[11px] text-slate-500">
        <Cloud className="w-3.5 h-3.5 text-success-500" />
        <span className="hidden sm:inline">Synchronisé</span>
      </div>
    );
  }

  return (
    <div
      className={`fixed top-0 left-0 right-0 z-50 px-4 py-1.5 text-center text-xs font-medium flex items-center justify-center gap-2 ${
        isSyncing
          ? 'bg-blue-600 text-white'
          : isOnline
          ? 'bg-primary-600 text-white'
          : 'bg-warning-500 text-white'
      }`}
    >
      {isSyncing ? (
        <>
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          Synchronisation en cours...
          {progress.total > 0 && (
            <span>{progress.completed}/{progress.total} ({Math.round((progress.completed / progress.total) * 100)}%)</span>
          )}
          {progress.current && <span className="hidden md:inline opacity-80">{progress.current}</span>}
        </>
      ) : isOnline ? (
        <>
          {pendingCount > 0 ? (
            <>
              <CloudUpload className="w-3.5 h-3.5" />
              {pendingCount} opération(s) en attente
              <button
                onClick={triggerSync}
                className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 bg-white/20 rounded hover:bg-white/30 transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
                Sync
              </button>
            </>
          ) : (
            <>
              <Check className="w-3.5 h-3.5" />
              Tout est synchronisé
            </>
          )}
        </>
      ) : (
        <>
          <WifiOff className="w-3.5 h-3.5" />
          Hors ligne — {pendingCount > 0 ? `${pendingCount} en attente` : 'données locales'}
        </>
      )}

      {lastSyncResult && !isSyncing && (
        <span className="hidden sm:inline text-[10px] opacity-80">
          {lastSyncResult.synced > 0 && ` ${lastSyncResult.synced} envoyé(s)`}
          {lastSyncResult.failed > 0 && ` ${lastSyncResult.failed} échec(s)`}
        </span>
      )}
      {lastSyncResult?.errors && lastSyncResult.errors.length > 0 && !isSyncing && (
        <span title={lastSyncResult.errors.join('\n')} className="hidden lg:inline max-w-xs truncate opacity-90">
          Dernière erreur : {lastSyncResult.errors[0]}
        </span>
      )}
    </div>
  );
}
