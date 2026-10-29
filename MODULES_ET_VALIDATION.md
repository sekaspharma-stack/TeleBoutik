# TeleBoutik POS — état des modules et validation

Cette archive est un point de contrôle de test, pas une certification de production.

## Huit domaines couverts ou présents dans le projet
1. Boutique POS, produits, ventes, stock et caisse — fonctions de base déjà présentes, non validées en non-régression complète.
2. Airtel Money Cash In / Cash Out — code présent, non testé en exécution réelle.
3. Vente d'unités et forfaits Megas — saisie manuelle, cash/e-float, marge estimée et historique présents ; aucune intégration API opérateur.
4. Stock et vente de cartes SIM — code présent ; file de synchronisation persistée après vente et garde de rôle ajoutées.
5. Cabines et agents — registres et affectations présents, mais la session de caisse n'est pas liée à un identifiant de cabine ; séparation multi-cabine incomplète.
6. Commissions — règles indicatives présentes ; pas de paiement automatique ni de rapprochement réel.
7. Rapports — filtres de période/devise et synthèses présents ; exactitude comptable à valider.
8. Audit et synchronisation — mappings de tables présents ; Firebase réel, sécurité Firestore et reprise offline non testés.

## Vérifications réellement exécutées
- Transpilation syntaxique TypeScript/TSX sur 32 fichiers : 0 diagnostic.
- Vérification statique routes/menu, schémas/mappings Firebase/reset cloud et file persistée de vente SIM : contrôles réussis sauf limites décrites dans `RAPPORT_AUDIT_BRANCHEMENTS.md`.
- `npm ci` : non terminé avant le délai maximal.
- `npm run build` : échec d'environnement dû aux dépendances/types absents ; pas de compilation applicative validée.
- Tests PGlite navigateur, Firebase, règles Firestore et Netlify : non exécutés.

## Usage autorisé
Préproduction / test seulement, avec données fictives et sauvegarde. Ne pas déployer sur la production tant que la compilation, le lien session-cabine et le plan de test A à Z ne sont pas validés.

## Corrections de stock, caisse et aide (2026-10-27)
Voir `CORRECTIONS_STOCK_CAISSE_SIM_HELPINFO.md` : inventaire unités/Megas séparé du e-float, SIM en vrac à l'unité ou carton de 250, total général équivalent USD, clôture espèces en USD/CDF et panneau HelpInfo global par module. Compilation et tests Firebase/browser restent à exécuter.
