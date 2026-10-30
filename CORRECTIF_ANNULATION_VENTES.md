# Correctif — annulation des ventes

## Règles d'autorisation
- Le propriétaire (`role = owner`) peut annuler une vente sans demander un second PIN.
- Un gérant doit fournir le PIN d'un propriétaire actif différent de son propre compte.
- La confirmation de l'annulation par PIN est enregistrée dans `manager_approvals`.
- Le motif d'annulation est obligatoire.

## Cohérence des données
L'annulation est exécutée dans une transaction locale. En cas d'erreur, les modifications sont annulées ensemble.
- Refuse une vente déjà annulée et les états non annulables.
- Vérifie l'existence des lignes et la validité des quantités.
- Ajoute les mouvements de retour en stock et remet les unités IMEI en stock.
- Contre-passe les dettes client générées par une vente à crédit.
- Enregistre les remboursements de paiement dans les mouvements de caisse, le journal comptable, l'audit et la file de synchronisation.
- Détecte les écritures d'annulation déjà présentes pour éviter de créer des doublons.

## Vérification
Exécuter `npm install`, puis `npm run build` dans un environnement Node compatible. Les dépendances n'ont pas pu être installées intégralement dans l'environnement de préparation, donc la compilation complète reste à confirmer.
