# Mise à jour : démarrage rapide, hors-ligne Firestore, nouveau design

## Causes de lenteur / blocages trouvées
1. **Démarrage bloqué par le réseau** (`App.tsx`) : l'écran « Chargement… » attendait l'envoi des files, la synchro, puis le téléchargement complet de ~30 collections Firestore (`getDocsFromServer`, sans délai maximum). Réseau lent ou coupé = écran bloqué.
2. **Import cloud très lent** (`syncEngine.ts`) : un `INSERT` PGlite par document, chacun écrit séparément dans IndexedDB.
3. **Course à l'initialisation** (`localDb.ts`) : un second appelant de `getDb()` recevait la base avant la création du schéma (StrictMode + sync) → erreurs « relation does not exist », base instable.
4. **Schéma rejoué à chaque lancement** : ~40 `CREATE TABLE`, des `ALTER` et un `DROP/ADD CONSTRAINT` à chaque démarrage.
5. **Écritures Firestore sans délai** : une connexion « en ligne » mais inutilisable bloquait la file indéfiniment.
6. **Bundle monolithique** : tous les écrans + Recharts chargés au démarrage ; polices Google bloquant l'affichage.
7. `vite.config.js` / `.d.ts` générés par `tsc -b` masquaient `vite.config.ts`.

## Corrections
- Démarrage **local d'abord** ; la synchro cloud tourne en arrière-plan. Seul cas d'attente (20 s max) : appareil neuf sans boutique locale.
- Persistance Firestore native (`persistentLocalCache` + multi-onglets + long-polling auto) dans `firebaseClient.ts`.
- `getDb()` partagé via une promesse unique ; schéma/migrations versionnés (`SCHEMA_VERSION`).
- Import cloud en transactions (un SAVEPOINT par ligne), pull unique en vol, délais sur toutes les lectures/écritures cloud.
- Pages chargées à la demande (`React.lazy`), chunks séparés, polices non bloquantes + cache PWA.
- Nettoyage unique des anciennes bases sql.js/SQLite (`legacyCleanup.ts`), sans toucher à la base active.

## Design et interactions
- Nouveau système visuel (`index.css`, `tailwind.config.js`) : menu latéral encre, surfaces épurées, police Manrope, ombres douces.
- Survol réservé aux appareils à souris (`hoverOnlyWhenSupported` + `@media (hover:hover)`), retour d'appui `:active` au toucher, `touch-action: manipulation`, mouvement réduit respecté.

## Ordre de chargement (connexion d'abord)
1. **Écran de connexion immédiat** sur un appareil déjà utilisé : le clavier PIN s'affiche avant même l'ouverture de la base locale ; la validation attend automatiquement que la base soit prête.
2. **Téléchargement prioritaire** (`pullPriorityData`) : uniquement la boutique et les comptes (`stores`, `app_users`). Sur un appareil neuf, c'est la seule attente (15 s max) ; sur un appareil connu, il tourne en arrière-plan.
3. **Après connexion** : synchronisation complète (envoi des opérations en attente, puis réception des produits, ventes, stock…) en arrière-plan.
