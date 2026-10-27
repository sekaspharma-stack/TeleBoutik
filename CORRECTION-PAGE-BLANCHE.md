# Correction ciblée — page blanche du tableau de bord

## Changements
- `src/pages/DashboardPage.tsx` : normalisation défensive des dates retournées par PGlite et formateur d'axe du graphique qui n'appelle plus `substring` sur une valeur non textuelle.
- `public/icon-192.png` et `public/icon-512.png` : ajout des icônes déclarées dans le manifeste PWA pour supprimer les 404 correspondants.

## Vérification
Le build local n'a pas pu être validé dans l'environnement de préparation : l'installation des dépendances a dépassé le délai disponible et TypeScript ne trouvait donc pas toutes les définitions de types. Relancer `npm ci` puis `npm run build` dans un environnement de développement complet avant déploiement.

Cette correction vise le plantage du graphique et les icônes manquantes. Elle ne prouve pas à elle seule que le délai d'initialisation PGlite/IndexedDB est résolu.
