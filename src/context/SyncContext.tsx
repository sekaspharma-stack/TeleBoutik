import { create } from 'zustand';
import { query } from '../db/localDb';
import { flushPendingCloudTableWrites, syncPendingOps, isSyncing, pullCloudData, restorePendingCloudSync, type SyncProgress } from '../db/syncEngine';

interface SyncState {
  isOnline: boolean;
  pendingCount: number;
  lastSync: string | null;
  isSyncing: boolean;
  progress: SyncProgress;
  lastSyncResult: { synced: number; failed: number; errors?: string[] } | null;
  /** Incrémenté quand des données cloud ont été fusionnées en arrière-plan : les écrans se rafraîchissent. */
  dataVersion: number;
  setOnline: (online: boolean) => void;
  refreshPendingCount: () => Promise<void>;
  triggerSync: () => Promise<void>;
  refreshData: () => Promise<void>;
  isRefreshing: boolean;
  refreshMessage: string | null;
}

export const useSync = create<SyncState>((set, get) => ({
  isOnline: typeof navigator === 'undefined' ? false : navigator.onLine,
  pendingCount: 0,
  lastSync: null,
  isSyncing: false,
  progress: { completed: 0, total: 0, current: null },
  lastSyncResult: null,
  dataVersion: 0,
  isRefreshing: false,
  refreshMessage: null,

  setOnline: (online) => {
    set({ isOnline: online });
    if (online) {
      void (async () => {
        // Offline changes go up first; cloud server state is pulled only after queued writes.
        await restorePendingCloudSync();
        await flushPendingCloudTableWrites();
        await get().triggerSync();
        await flushPendingCloudTableWrites();
        const result = await pullCloudData();
        if (result.available) set({ dataVersion: get().dataVersion + 1 });
        if (!result.available || result.failedCollections.length > 0 || result.skippedReason) {
          console.warn('Cloud reconnect completed with limitations:', result);
        }
      })().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        set({ lastSyncResult: { synced: 0, failed: 1, errors: [message] } });
        console.warn('Cloud reconnect sync failed:', error);
      });
    }
  },

  refreshPendingCount: async () => {
    try {
      const rows = await query<{ count: number | string }>(
        "SELECT COUNT(*) as count FROM sync_ops WHERE status = 'pending'"
      );
      set({ pendingCount: Number(rows[0]?.count ?? 0) });
    } catch (error) {
      console.error('Unable to read pending sync operations:', error);
    }
  },

  refreshData: async () => {
    const state = get();
    if (state.isRefreshing) return;
    set({ isRefreshing: true, refreshMessage: null });
    try {
      // Ensure the local database is initialized before querying or reconciling it.
      await query<{ count: number | string }>('SELECT COUNT(*) AS count FROM app_meta');

      if (typeof navigator === 'undefined' || !navigator.onLine) {
        set({
          dataVersion: get().dataVersion + 1,
          refreshMessage: 'Données locales actualisées. Connexion Internet indisponible : les données cloud n’ont pas été vérifiées.',
        });
        return;
      }

      // Pull first: this checks an explicit cloud-reset epoch before any queued local
      // operation can be uploaded, preventing stale local data from repopulating a reset cloud.
      const initialPull = await pullCloudData();
      if (!initialPull.available || initialPull.skippedReason) {
        set({
          dataVersion: get().dataVersion + 1,
          refreshMessage: initialPull.skippedReason
            ? `Actualisation locale uniquement : ${initialPull.skippedReason}. Aucune donnée locale n’a été supprimée.`
            : `Actualisation cloud impossible : ${initialPull.failedCollections.join(', ') || 'connexion ou configuration Firebase'}. Les données locales sont conservées.`,
        });
        await get().refreshPendingCount();
        return;
      }

      // Only upload pending operations after the server state and reset marker were read.
      await restorePendingCloudSync();
      await flushPendingCloudTableWrites();
      await get().triggerSync();
      await flushPendingCloudTableWrites();

      const finalPull = await pullCloudData();
      await get().refreshPendingCount();
      set({
        dataVersion: get().dataVersion + 1,
        refreshMessage: finalPull.available && !finalPull.skippedReason
          ? (finalPull.failedCollections.length
              ? `Actualisation terminée avec des collections non lues : ${finalPull.failedCollections.join(', ')}.`
              : 'Données actualisées depuis Firebase.')
          : `Données locales conservées. Actualisation cloud incomplète : ${finalPull.skippedReason || finalPull.failedCollections.join(', ') || 'erreur inconnue'}.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({
        dataVersion: get().dataVersion + 1,
        refreshMessage: `Échec de l’actualisation cloud : ${message}. Les données locales sont conservées.`,
        lastSyncResult: { synced: 0, failed: 1, errors: [message] },
      });
    } finally {
      set({ isRefreshing: false });
    }
  },

  triggerSync: async () => {
    if (typeof navigator === 'undefined' || !navigator.onLine || isSyncing()) return;
    set({ isSyncing: true, progress: { completed: 0, total: 0, current: null } });
    try {
      const result = await syncPendingOps((progress) => set({ progress }));
      set({
        lastSync: new Date().toISOString(),
        lastSyncResult: { synced: result.synced, failed: result.failed, errors: result.errors },
      });
      await get().refreshPendingCount();
      if (result.synced > 0) await pullCloudData();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ lastSyncResult: { synced: 0, failed: 1, errors: [message] } });
    } finally {
      set({ isSyncing: false, progress: { ...get().progress, current: null } });
    }
  },
}));

let watcherCleanup: (() => void) | null = null;

export function initSyncWatcher() {
  watcherCleanup?.();

  const goOnline = () => {
    useSync.getState().setOnline(true);
  };
  const goOffline = () => useSync.getState().setOnline(false);
  window.addEventListener('online', goOnline);
  window.addEventListener('offline', goOffline);
  void useSync.getState().refreshPendingCount();
  if (navigator.onLine) {
    void restorePendingCloudSync()
      .then(() => flushPendingCloudTableWrites())
      .then(() => useSync.getState().triggerSync())
      .then(() => pullCloudData())
      .then((result) => { if (result.available) useSync.setState((state) => ({ dataVersion: state.dataVersion + 1 })); })
      .catch((error) => console.warn('Initial cloud synchronization failed:', error));
  }

  const poll = window.setInterval(() => {
    if (navigator.onLine) {
      void useSync.getState().refreshPendingCount().then(() => {
        if (useSync.getState().pendingCount > 0) void useSync.getState().triggerSync();
      });
    }
  }, 30000);

  watcherCleanup = () => {
    window.removeEventListener('online', goOnline);
    window.removeEventListener('offline', goOffline);
    window.clearInterval(poll);
    watcherCleanup = null;
  };
  return watcherCleanup;
}
