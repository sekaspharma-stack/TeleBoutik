import { collection, onSnapshot, type Unsubscribe } from 'firebase/firestore';
import { db, isFirebaseConfigured } from './firebaseClient';
import { TABLE_COLLECTIONS, applyCloudChanges, type CloudDocChange } from './syncEngine';

/**
 * Synchronisation INSTANTANÉE : chaque appareil écoute Firestore en direct.
 * Dès qu'une vendeuse ouvre une caisse, vend ou clôture, le changement arrive sur les autres
 * appareils en quelques instants, sans rafraîchir ni attendre un téléchargement complet.
 *
 * - Les écritures faites par CET appareil (hasPendingWrites) sont ignorées : la base locale les a déjà.
 * - Une ligne locale encore en attente d'envoi n'est jamais écrasée (voir applyCloudChanges).
 * - Un enfant reçu avant son parent (ex. mouvement de caisse avant sa session) est réessayé automatiquement.
 */

// L'historique d'audit est volumineux et non critique pour l'affichage : il reste dans le téléchargement complet.
const EXCLUDED_COLLECTIONS = new Set(['audit_log']);
const REALTIME_ENTRIES = TABLE_COLLECTIONS.filter((entry) => !EXCLUDED_COLLECTIONS.has(entry.collection));
const ORDER = new Map(REALTIME_ENTRIES.map((entry, index) => [entry.table, index] as const));
const MAX_DEFERRED_ATTEMPTS = 20;
const RESTART_DELAY_MS = 15000;
const NOTIFY_DEBOUNCE_MS = 500;

type Deferred = { change: CloudDocChange; attempts: number };

export function startRealtimeSync(onDataChanged: () => void): () => void {
  if (!isFirebaseConfigured) return () => undefined;

  let stopped = false;
  const unsubscribes: Unsubscribe[] = [];
  const restartTimers = new Set<ReturnType<typeof setTimeout>>();
  const deferred = new Map<string, Deferred[]>();
  let chain: Promise<void> = Promise.resolve();
  let notifyTimer: ReturnType<typeof setTimeout> | null = null;

  // Premier instantané de chaque collection : on notifie une seule fois quand tous sont reçus.
  let initialPending = REALTIME_ENTRIES.length;
  const initialDone = new Set<string>();
  let initialNotified = false;
  let initialChanged = false;

  const notifySoon = () => {
    if (stopped) return;
    if (notifyTimer) clearTimeout(notifyTimer);
    notifyTimer = setTimeout(() => { notifyTimer = null; if (!stopped) onDataChanged(); }, NOTIFY_DEBOUNCE_MS);
  };

  const retryDeferred = async (): Promise<boolean> => {
    let changed = false;
    const tables = [...deferred.keys()].sort((a, b) => (ORDER.get(a) ?? 0) - (ORDER.get(b) ?? 0));
    for (const table of tables) {
      const items = deferred.get(table) ?? [];
      if (items.length === 0) { deferred.delete(table); continue; }
      const result = await applyCloudChanges(table, items.map((item) => item.change));
      if (result.applied > 0) changed = true;
      const stillFailing = new Set(result.deferred.map((change) => change.id));
      const next = items
        .filter((item) => stillFailing.has(item.change.id))
        .map((item) => ({ ...item, attempts: item.attempts + 1 }))
        .filter((item) => item.attempts < MAX_DEFERRED_ATTEMPTS);
      if (next.length > 0) deferred.set(table, next); else deferred.delete(table);
    }
    return changed;
  };

  const handleChanges = (table: string, changes: CloudDocChange[], isInitial: boolean) => {
    chain = chain.then(async () => {
      if (stopped) return;
      try {
        const result = await applyCloudChanges(table, changes);
        let changed = result.applied > 0;
        if (result.deferred.length > 0) {
          const list = deferred.get(table) ?? [];
          for (const change of result.deferred) list.push({ change, attempts: 0 });
          deferred.set(table, list);
        }
        if (deferred.size > 0 && await retryDeferred()) changed = true;
        if (isInitial) {
          if (changed) initialChanged = true;
        } else if (changed) {
          notifySoon();
        }
      } catch (error) {
        console.warn(`Temps réel : application impossible pour ${table} :`, error);
      }
    });
    return chain;
  };

  const markInitialDone = (collectionName: string) => {
    if (initialDone.has(collectionName)) return;
    initialDone.add(collectionName);
    initialPending--;
    if (initialPending <= 0 && !initialNotified) {
      initialNotified = true;
      // Une seule actualisation des écrans une fois l'état cloud entièrement reçu.
      chain = chain.then(() => { if (initialChanged) notifySoon(); });
    }
  };

  const listen = (entry: { table: string; collection: string }) => {
    if (stopped) return;
    let firstSnapshot = true;
    const unsubscribe = onSnapshot(
      collection(db, entry.collection),
      (snapshot) => {
        const isInitial = firstSnapshot;
        firstSnapshot = false;
        const changes: CloudDocChange[] = [];
        for (const change of snapshot.docChanges()) {
          // Écriture locale pas encore confirmée : elle vient de cet appareil, la base locale est déjà à jour.
          if (change.doc.metadata.hasPendingWrites) continue;
          changes.push({ type: change.type, id: change.doc.id, data: change.doc.data() as Record<string, unknown> });
        }
        const done = changes.length > 0 ? handleChanges(entry.table, changes, isInitial) : chain;
        if (isInitial) void done.then(() => markInitialDone(entry.collection));
      },
      (error) => {
        console.warn(`Temps réel : écoute interrompue pour ${entry.collection} :`, error);
        if (isInitialStuck(entry.collection)) markInitialDone(entry.collection);
        if (stopped) return;
        // L'écoute est fermée par Firestore après une erreur : on la relance plus tard.
        const timer = setTimeout(() => { restartTimers.delete(timer); listen(entry); }, RESTART_DELAY_MS);
        restartTimers.add(timer);
      }
    );
    unsubscribes.push(unsubscribe);
  };

  const isInitialStuck = (collectionName: string) => !initialDone.has(collectionName);

  for (const entry of REALTIME_ENTRIES) listen(entry);

  return () => {
    stopped = true;
    if (notifyTimer) clearTimeout(notifyTimer);
    for (const timer of restartTimers) clearTimeout(timer);
    restartTimers.clear();
    for (const unsubscribe of unsubscribes.splice(0)) {
      try { unsubscribe(); } catch { /* déjà fermé */ }
    }
  };
}
