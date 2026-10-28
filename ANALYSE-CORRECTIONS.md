# Analyse et corrections TeleBoutik

## Causes trouvées dans la version source analysée

1. `App.tsx` appelait `seedDemoData()` à chaque première initialisation locale. Le seed crée de nombreux produits, IMEI, tickets et dépenses avec beaucoup de requêtes SQL séquentielles. Cela explique une part importante du démarrage très lent et les données de démonstration persistantes.
2. Les écrans utilisent encore PGlite/IndexedDB comme base locale. L'ancien moteur de synchronisation n'envoyait qu'une partie des entités à Firestore; plusieurs collections n'étaient donc jamais créées à distance.
3. Les erreurs réseau Firestore n'étaient pas toujours gérées de façon sûre et certaines opérations en échec étaient marquées `rejected`, empêchant une nouvelle tentative.
4. La configuration Firebase était codée en dur dans `firebaseClient.ts`, ce qui faisait remonter les valeurs dans le JavaScript généré et provoquait le scanner de secrets de Netlify lorsque les mêmes valeurs étaient déclarées comme secrètes.
5. Le manifeste PWA demandait `icon-192.png` et `icon-512.png`, absentes du dossier `public` source. Les fichiers WASM/data de PGlite n'étaient pas inclus dans la liste de pré-cache PWA.
6. Le graphique du tableau de bord appelait `substring` sans vérifier le type de la valeur reçue, ce qui pouvait faire planter le rendu du menu.
7. Le dépôt contenait une configuration Supabase résiduelle et un dossier `dist` généré ancien, sources de confusion avec le déploiement Firebase/Netlify.

## Changements inclus

- Suppression du lancement automatique du seed et retrait du module de données de démonstration.
- Nettoyage automatique de la base locale uniquement si le magasin correspond exactement au nom de démonstration connu `TeleShop Abidjan`.
- Assistant de première configuration pour créer une boutique et un premier compte propriétaire, sans compte PIN de démonstration.
- Hachage SHA-256 des nouveaux PIN avant stockage local/cloud.
- File d'attente de synchronisation persistante dans `app_meta`, envoi des lignes modifiées vers Firestore et restauration/actualisation des données cloud dans une base locale vide ou non modifiée localement.
- Synchronisation des collections utilisées par les tables de l'application au lieu de la liste limitée précédente.
- Gestion plus prudente des erreurs réseau et nouvelle tentative des opérations réseau transitoires.
- Configuration Firebase via variables `VITE_FIREBASE_*` au lieu de valeurs intégrées au code.
- Correction du formateur du graphique et ajout des icônes PWA/favicons.
- Pré-cache PWA des fichiers `.wasm` et `.data` de PGlite, jusqu'à 12 Mo.
- Nettoyage des fichiers `.env`, de la configuration Supabase et du dossier `dist` généré; `dist` doit être créé par le build Netlify.
- Node 24.12.0 configuré dans `netlify.toml` pour correspondre aux exigences de la version Firebase verrouillée.

## Limites connues

Cette livraison conserve PGlite comme base locale/offline car les pages de TeleBoutik exécutent encore des requêtes SQL. Firestore devient un miroir cloud synchronisé, avec restauration et actualisation des lignes non modifiées localement; ce n'est pas encore une réécriture pure de toutes les pages en accès direct Firestore ni un système complet de résolution de conflits multi-utilisateurs simultanés.

Le mode test Firestore n'est pas adapté à la production. L'application n'utilise pas encore Firebase Authentication par utilisateur. Ne stockez pas de données réelles sensibles avant d'ajouter l'authentification et des règles Firestore strictes.

## Validation effectuée dans cet environnement

- Analyse syntaxique TypeScript/TSX : 27 fichiers analysés, aucune erreur de syntaxe.
- Le build complet `npm run build` n'a pas pu être exécuté ici : l'installation des dépendances via `npm ci` a dépassé le délai de l'environnement. Le premier build Netlify après configuration des variables doit donc être vérifié avant de considérer la mise en production validée.
