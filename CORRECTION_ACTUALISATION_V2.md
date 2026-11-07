# Correctif actualisation TeleBoutik — V2

## Cause directe confirmée
Le bouton du logo dans `src/components/AppLayout.tsx` appelait uniquement `window.location.reload()`. Cela rechargeait les fichiers de l'application mais ne garantissait pas une lecture fraîche de Firestore avant l'affichage des écrans.

## Correction
- Le bouton déclenche maintenant `refreshData()` dans `src/context/SyncContext.tsx` au lieu de recharger toute la page.
- La base locale PGlite est vérifiée avant la synchronisation.
- Quand l'appareil est en ligne, la lecture cloud est effectuée avant l'envoi des files locales : le marqueur explicite de réinitialisation est ainsi vérifié avant toute tentative d'envoi.
- En cas de cloud inaccessible, de configuration manquante ou de lecture ambiguë, les données locales sont conservées et un message explicite s'affiche.
- Après une synchronisation réussie, `dataVersion` change pour remonter les écrans et relancer leurs lectures locales.
- Un indicateur de chargement empêche les clics répétés pendant l'actualisation.

## Vérification
Cette archive a été modifiée à partir du projet fourni. La compilation TypeScript/Vite et les tests d'intégration Firebase ne sont pas déclarés réussis : ils doivent être exécutés dans l'environnement Node/Firebase de test approprié avant le déploiement en production.
