# Correction — priorité Firestore et repli local TeleBoutik

## Comportement mis en place

- Quand l'application est en ligne, le chargement initial attend la lecture Firestore avant d'ouvrir les écrans métier.
- Les lectures de référence utilisent `getDocsFromServer` afin de demander les données au serveur plutôt que de se fier au cache local Firestore potentiellement ancien.
- Les opérations locales en attente sont restaurées et envoyées avant la lecture cloud.
- Après une lecture réussie d'une collection, les données cloud sont importées dans PGlite. Les copies locales absentes du cloud sont retirées uniquement pour les collections dont la lecture serveur a réussi.
- Les changements offline marqués dans `app_meta` et les ventes encore en attente dans `sync_ops` sont protégés contre l'écrasement et la suppression pendant la réconciliation.
- Si la connexion est absente ou si Firestore ne répond pas, l'application conserve les données locales pour permettre le travail hors ligne et réessaie à la reconnexion.
- La synchronisation globale automatique « envoyer toute la base locale au cloud » est désactivée. Seules les opérations en attente/les lignes modifiées doivent être envoyées, afin qu'une vieille base locale ne remplace pas la base cloud.
- Si Firestore renvoie des collections boutique et comptes complètement vides alors que des données locales existent, la réconciliation destructive est suspendue par sécurité et un avertissement est écrit dans la console. Il faut alors vérifier la configuration du projet Firebase.

## Contrôles réalisés ici

- Transpilation syntaxique TypeScript/TSX sur 32 fichiers : 0 diagnostic syntaxique.
- Contrôles statiques : lecture serveur Firestore utilisée; file offline restaurée avant la lecture cloud; envoi global local→cloud automatique désactivé; réconciliation limitée aux collections lues avec succès; protection des opérations en attente.
- Intégrité de l'archive ZIP vérifiée.

## Non vérifié

- Build Vite complet, tests navigateur et connexion réelle au projet Firebase non exécutés dans cet environnement.
- Le comportement doit être testé sur un environnement de préproduction avec le bon `VITE_FIREBASE_PROJECT_ID` et les règles Firestore réelles.
- Cette correction n'invente pas de mécanisme de résolution automatique de conflits métier entre deux appareils qui modifient simultanément le même enregistrement. Les opérations offline explicitement en attente sont préservées et poussées au cloud; un test multi-appareils reste nécessaire.

## Test préproduction recommandé

1. Avec une connexion stable, modifier un produit sur un appareil et vérifier que l'autre appareil voit la valeur cloud actualisée après synchronisation.
2. Passer hors ligne, créer une vente de test, recharger la page et vérifier que l'opération reste en attente localement.
3. Rétablir le réseau et vérifier que la vente monte au cloud une seule fois, puis que les deux appareils affichent les mêmes soldes/stock.
4. Simuler une connexion lente et vérifier que l'app n'affiche pas immédiatement des copies locales anciennes avant la tentative de lecture serveur.
5. Confirmer que la console ne signale pas un projet Firestore vide inattendu.
