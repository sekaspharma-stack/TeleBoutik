/**
 * Nettoyage unique de l'ancien stockage local (sql.js / SQLite WASM stocké dans IndexedDB ou localStorage).
 *
 * Sécurité : seules les bases dont le nom correspond à un ancien moteur sont supprimées.
 * La base active (PGlite `teleboutik-db`) et le cache Firestore ne sont JAMAIS touchés,
 * afin de ne perdre aucune opération hors-ligne en attente de synchronisation.
 */
const FLAG = 'teleboutik:legacy-cleanup:v1';
const LEGACY_DB_NAME = /sql\.?js|sqljs|sqlite|^teleboutik[-_](sql|old|legacy|backup)/i;
const LEGACY_STORAGE_KEY = /sql\.?js|sqljs|teleboutik[-_.](sql|legacy)/i;
const KNOWN_LEGACY_NAMES = ['sql.js', 'SQL.js', 'sqljs', 'teleboutik-sql', 'teleboutik-sqljs', 'teleboutik-sqlite'];

function deleteIndexedDb(name: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function run(): Promise<void> {
  try {
    if (localStorage.getItem(FLAG)) return;
  } catch {
    return; // stockage inaccessible : on ne tente rien
  }

  const names = new Set<string>(KNOWN_LEGACY_NAMES);
  try {
    const listed = (await indexedDB.databases?.()) ?? [];
    for (const info of listed) if (info.name && LEGACY_DB_NAME.test(info.name)) names.add(info.name);
  } catch { /* Firefox ancien : on se contente des noms connus */ }

  await Promise.all([...names].map(deleteIndexedDb));

  try {
    for (const key of Object.keys(localStorage)) if (LEGACY_STORAGE_KEY.test(key)) localStorage.removeItem(key);
    localStorage.setItem(FLAG, new Date().toISOString());
  } catch { /* ignore */ }
}

/** Lance le nettoyage hors du chemin critique de démarrage. */
export function scheduleLegacyStorageCleanup(): void {
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (idle) idle(() => { void run(); }, { timeout: 10000 });
  else window.setTimeout(() => { void run(); }, 3000);
}
