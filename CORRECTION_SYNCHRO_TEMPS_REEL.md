# Correction — synchronisation entre appareils (caisse vendeuse ↔ propriétaire)

## Symptôme
Une vendeuse ouvre sa caisse chez elle : ses cartes (espèces, Airtel Money, total, entrées/sorties) s'affichent chez elle,
mais rien chez le propriétaire, même après rafraîchissement de la page.

## Causes trouvées
1. **La page Caisse ne lisait que la session de l'utilisateur connecté** (`WHERE user_id = moi`). Même avec des données
   parfaitement synchronisées, le propriétaire voyait « Aucune session ouverte » et aucune carte.
2. **Envoi des ventes incomplet** (`upsertSale`) : les mouvements de caisse et les paiements étaient écrits dans Firestore avec
   une liste de champs fixe et SANS `merge` → `currency_code`, `original_amount`, `applied_rate` étaient effacés.
   Chez un autre appareil, un encaissement en CDF réapparaissait comme un montant USD faux → cartes incohérentes.
3. **Aucune écoute temps réel** : un appareil ne recevait les changements des autres qu'au démarrage ou au clic sur le logo,
   par un téléchargement complet (lent, tout ou rien).
4. **Tables jamais synchronisées** : `customer_debt_ledger` (dettes clients), `debt_reminders`, `warranty_records`,
   `repair_records`, `manager_approvals` restaient sur l'appareil qui les créait (absentes de `TABLE_COLLECTIONS`).
5. Envoi différé de 1,2 s (puis 5 s en cas de nouvel envoi pendant un envoi).

## Corrections
- `src/db/syncEngine.ts`
  - `upsertSale` : envoie toutes les colonnes de chaque ligne liée, en `merge`.
  - Nouvelle **écoute temps réel** `startRealtimeSync` / `stopRealtimeSync` (Firestore `onSnapshot`) sur toutes les collections
    sauf `audit_log` : chaque changement distant est appliqué dans PGlite (parents avant enfants, relance si le parent n'est
    pas encore arrivé, lignes locales en attente jamais écrasées, échos de nos propres écritures ignorés).
  - Le téléchargement complet n'écrase plus ni ne supprime une ligne que le temps réel vient d'appliquer.
  - 5 tables ajoutées à la synchronisation ; envoi après 150 ms au lieu de 1200 ms.
- `src/context/SyncContext.tsx` : démarrage immédiat de l'écoute après connexion, compteur `liveTick`, hook
  `useLiveRefresh(load)` : l'écran se recharge SANS être remonté (les fenêtres ouvertes et champs en saisie sont conservés).
- `src/pages/CashPage.tsx` : le propriétaire / gérant voit **toutes les caisses ouvertes de la boutique** (onglets par agent,
  cartes de la caisse sélectionnée, clôture possible), historique avec colonne Agent/registre. Le vendeur ne voit que la sienne.
- `useLiveRefresh` ajouté à : Tableau de bord, Ventes, Stock, Airtel Money, Unités & Megas, Cartes SIM, Cabines, Clients,
  Rapports, Gestion avancée. Le Point de vente n'est volontairement pas rechargé (on n'interrompt pas une vente).

## Vérification réalisée
- Comparaison des diagnostics TypeScript avant/après : aucune erreur de syntaxe ni de nom introuvable ajoutée.
- NON exécuté ici : `npm install` (registre npm injoignable depuis l'environnement), build Vite, test réel avec Firebase.

## Test à faire (2 appareils)
1. Vendeuse : ouvrir la caisse avec fonds USD + CDF + Airtel. Propriétaire (page Caisse déjà ouverte) : l'onglet de la
   vendeuse et ses cartes apparaissent en 1–2 s sans rien toucher.
2. Vendeuse : encaisser une vente en CDF. Propriétaire : les cartes se mettent à jour, montant en CDF correct.
3. Propriétaire : F5, se reconnecter → les cartes sont là. Vendeuse : clôturer → l'onglet disparaît chez le propriétaire.
4. Couper le réseau de la vendeuse, vendre, le rétablir → tout remonte et apparaît chez le propriétaire.

## Point d'attention
Les règles de sécurité Firestore doivent autoriser la lecture (`list`) de toutes les collections synchronisées, y compris
les 5 nouvelles : `customer_debt_ledger`, `debt_reminders`, `warranty_records`, `repair_records`, `manager_approvals`.
