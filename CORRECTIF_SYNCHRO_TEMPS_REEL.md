# Correctif synchronisation temps réel (caisse vendeuse → propriétaire)

## Causes trouvées
1. **Page Caisse** (`src/pages/CashPage.tsx`) : la session « ouverte » n'était cherchée que pour l'utilisateur connecté
   (`WHERE user_id = moi`). Le propriétaire voyait donc « Aucune session ouverte » et aucune carte, même si la
   vendeuse avait une caisse ouverte et que les données étaient bien arrivées dans sa base locale.
2. **Aucune écoute en direct** : les données cloud n'étaient téléchargées qu'au démarrage, au retour réseau ou via le
   bouton d'actualisation (téléchargement complet de ~30 collections). Rien n'arrivait tant qu'on ne rafraîchissait pas.
3. Délai d'envoi des écritures locales vers le cloud : 1,2 s (ramené à 0,3 s).

## Corrections
- `src/db/realtimeSync.ts` (nouveau) : écoute Firestore en direct (`onSnapshot`) sur toutes les collections sauf
  `audit_log`. Les changements d'autres appareils sont appliqués dans la base locale puis les écrans se rechargent.
  Les lignes locales en attente d'envoi ne sont jamais écrasées ; un enfant reçu avant son parent
  (mouvement avant session) est réessayé automatiquement ; une écoute interrompue est relancée après 15 s.
- `src/db/syncEngine.ts` : `applyCloudChanges()` (application incrémentale), `loadPendingKeys()` extrait du
  téléchargement complet pour être partagé, `TABLE_COLLECTIONS` exporté, délai d'envoi 300 ms.
- `src/context/SyncContext.tsx` : l'écoute temps réel démarre avec le watcher et incrémente `dataVersion`.
- `src/pages/CashPage.tsx` : pour owner/manager, nouvelle section « Caisses ouvertes par l'équipe » avec les cartes
  (Espèces, Airtel Money, Total) de chaque caisse ouverte par un autre utilisateur ; l'historique affiche
  l'utilisateur et la cabine.

## À vérifier (non testé ici : pas de Node 24 / npm / Firebase dans mon environnement)
1. `npm ci && npm run build` avec Node 24.
2. Deux appareils : la vendeuse ouvre une caisse, fait une vente → la page Caisse du propriétaire doit se mettre à jour
   en quelques secondes, sans rafraîchir.
3. Règles Firestore : lecture autorisée sur toutes les collections écoutées pour les comptes concernés.
