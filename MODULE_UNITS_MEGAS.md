# Module « Unités & Megas » — point de contrôle

## Fonctionnalités ajoutées
- Vente séparée d'unités et de forfaits data.
- Opérateurs : Airtel, Orange, MTN et Vodacom.
- Téléphone client, service/forfait, valeur faciale, coût e-float, prix encaissé, devise, mode de paiement et référence unique obligatoires ou explicites.
- Vérification du solde e-float de l'opérateur avant enregistrement.
- Écritures de caisse appariées dans une transaction SQL : encaissement client et consommation e-float.
- Calcul de la marge brute estimée (prix encaissé - coût e-float).
- Historique par agent; propriétaire/gestionnaire voit les opérations de la cabine.
- Annulation réservée au propriétaire/gestionnaire avec motif obligatoire, écritures inverses et journal d'audit; aucune suppression de l'opération initiale.
- Ajout à la file de synchronisation Firebase, à la liste de remise à zéro cloud et à la navigation.
- La page Caisse affiche aussi les soldes Orange, MTN et Vodacom et permet d'enregistrer un mouvement sur ces portefeuilles.

## Vérifications exécutées
- Transpilation syntaxique TypeScript/TSX de tous les fichiers `src`: 0 diagnostic de syntaxe.
- La compilation complète `tsc -b && vite build` reste bloquée dans cet environnement par des dépendances/types manquants dans `node_modules` (notamment React, Node et D3). Le moteur PGlite n'est pas installé complètement, donc le test d'exécution SQL local n'a pas pu être exécuté ici.
- Firebase réel / fonctionnement Netlify non testés dans cet environnement.

## À ne pas considérer comme validé en production
Ce ZIP est un point de contrôle de développement, pas une version certifiée. Avant déploiement, installer proprement les dépendances avec la version Node compatible au projet, exécuter le build, puis tester en environnement de test : ouverture de caisse, solde e-float, vente en espèces et paiement mobile, référence dupliquée, solde insuffisant, annulation, synchronisation hors ligne/en ligne et consultation par rôle.
