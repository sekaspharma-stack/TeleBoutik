import { WifiOff, CloudUpload, RefreshCw, Check, Cloud } from 'lucide-react';
import { useSync } from '../context/SyncContext';

export default function SyncStatusBar() {
  const { isOnline, pendingCount, isSyncing, progress, lastSyncResult, triggerSync } = useSync();

  const showBar = !isOnline || pendingCount > 0 || isSyncing;
  if (!showBar) {
    return (
      <div className="fixed bottom-3 right-3 z-40 flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/90 px-3 py-1.5 text-[11px] font-semibold text-slate-500 shadow-md backdrop-blur" role="status">
        <Cloud className="w-3.5 h-3.5 text-success-500" />
        <span className="hidden sm:inline">Synchronisé</span>
      </div>
    );
  }

  return (
    <div
      role="status"
      className={`fixed top-0 left-0 right-0 z-50 flex h-7 items-center justify-center gap-2 px-4 text-center text-xs font-semibold ${
        isSyncing
          ? 'bg-primary-700 text-white'
          : isOnline
          ? 'bg-primary-600 text-white'
          : 'bg-accent-500 text-ink-950'
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
                className="ml-2 inline-flex items-center gap-1 rounded-md bg-white/20 px-2 py-0.5 hover:bg-white/30 active:bg-white/40"
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
