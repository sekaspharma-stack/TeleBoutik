# TeleBoutik — audit et corrections ciblées (V7.3)

## Architecture vérifiée dans l'archive
- React 18 / Vite / TypeScript : `package.json`, `vite.config.ts`, `src/main.tsx`.
- Zustand : `src/context/SyncContext.tsx`.
- PGlite persistant IndexedDB : `src/db/localDb.ts`, initialisation via `getDb()` et URI `idb://teleboutik-db`.
- Firebase/Firestore : `src/db/firebaseClient.ts`, cache persistant multi-onglets quand Firebase est configuré.
- PWA : `vite-plugin-pwa`, `registerType: 'autoUpdate'` dans `vite.config.ts`.
- Cloudflare Pages : script `build:cloudflare`, `wrangler.toml` et `CLOUDFLARE-FIREBASE-CORRECTION.md`.

## Causes/risques constatés dans le code
1. `pullCloudDataInner()` réconcilie et supprime les lignes locales absentes du cloud pour chaque collection lue avec succès. La protection existante ne détecte le cas vide qu'en vérifiant simultanément `stores` et `app_users`; elle ne distinguait pas un reset métier volontaire d'une collection métier vide.
2. Les opérations hors-ligne sont persistées dans `app_meta` (`cloud_pending:*`, `cloud_pending_full:*`) et dans `sync_ops`. Elles sont restaurées au démarrage par `restorePendingCloudSync()`. Sans marqueur de reset global, une autre session/appareil peut conserver une file obsolète.
3. Le watcher de synchronisation démarre au retour réseau et au démarrage. `pullCloudData()` déduplique ses propres appels simultanés, mais le flux global en ligne peut tout de même lancer plusieurs étapes asynchrones distinctes.
4. Firestore est configuré avec cache IndexedDB persistant. C'est utile hors-ligne, mais le cache Firestore ne constitue pas une preuve que l'état serveur est vide; les lectures de réconciliation utilisent heureusement `getDocsFromServer`.
5. La PWA utilise `autoUpdate` et précache les bundles HTML/JS/CSS. Il faut valider le comportement sur un vrai déploiement; le test Cloudflare/Firebase n'est pas réalisable sans accès aux comptes et environnement de test.

## Corrections apportées dans cette archive
- Ajout d'un marqueur explicite `system_state/business_data` à la fin d'une réinitialisation cloud réussie. Il porte un `reset_id` vérifiable; une collection vide seule ne déclenche pas cette action.
- Lors d'une synchronisation complète, chaque appareil lit ce marqueur avant la réconciliation. Si le `reset_id` diffère de celui mémorisé localement, l'appareil supprime les anciennes données métier locales synchronisées, vide les files `sync_ops` et `cloud_pending:*`, puis mémorise le nouvel epoch. Les tables de boutique, comptes, paramètres et audit sont préservées.
- Le marqueur n'est publié qu'après la suppression complète et réussie des collections cloud; une erreur de suppression ne prétend donc pas être un reset terminé.

## Limites et précautions
- Le reset cloud est une action destructive et doit être exécuté uniquement avec confirmation, par un propriétaire, en ligne et sur le bon projet Firebase. La suppression Firestore multi-collections n'est pas atomique.
- Le mécanisme de reset epoch doit être validé sur un projet Firebase de test avec deux navigateurs/appareils avant la production. Les règles Firestore doivent autoriser le propriétaire à lire/écrire `system_state/business_data` et interdire ces opérations aux rôles non autorisés.
- Le scénario de test destructif Firebase n'a pas été exécuté ici. Aucun test réel multi-appareil ni déploiement Cloudflare n'est revendiqué.
- `npm ci` n'a pas terminé dans l'environnement de travail; le runtime disponible est Node 22.16.0 alors que `.node-version` demande Node 24.12.0. Par conséquent, la compilation TypeScript/Vite n'a pas pu être exécutée et aucun résultat de build n'est revendiqué.

## Vérifications recommandées avant mise en production
1. Utiliser Node 24.12.0, puis `npm ci` et `npm run build`.
2. Sur un projet Firebase de test, créer des données sur deux appareils, lancer le reset depuis un compte owner et vérifier que l'autre appareil ne renvoie pas ses anciennes lignes.
3. Tester séparément cloud vide sans marqueur, erreur réseau, refus d'autorisation et reset interrompu.
4. Vérifier les règles Firestore pour `system_state` et faire une sauvegarde avant toute opération destructive.
