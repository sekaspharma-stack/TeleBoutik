# Rapport d'audit des branchements — TeleBoutik POS

Date : 27 octobre 2026

## Contrôles statiques exécutés

- 32 fichiers TypeScript/TSX transpilés : 0 diagnostic de syntaxe.
- Routes React et liens du menu pour Airtel Money, Unités/Megas, Cartes SIM, Cabines et Rapports/Commissions : présents.
- Tables locales `airtel_transactions`, `telecom_transactions`, `sim_cards`, `cabins` et `commission_rules` : présentes dans le schéma.
- Mappings de ces tables vers les collections Firebase et inclusion dans la liste de réinitialisation cloud : présents.
- Contrainte de `cash_movements.payment_method` : migration prévue pour accepter cash, Airtel, Orange, MTN, Vodacom, Wave, carte et virement.
- Ventes SIM : correction ajoutée pour persister dans `app_meta` la file de synchronisation des écritures `sim_cards` et `cash_movements`, afin qu'elle puisse être restaurée après rechargement.
- Accès direct aux pages Airtel Money, Unités/Megas et Cartes SIM : garde de rôle ajoutée pour owner, manager et seller, même si l'URL est saisie directement.
- Archive ZIP : contrôle d'intégrité requis avant remise.

## État des huit domaines

1. Boutique POS / stock / caisse : fonctionnalités existantes, non soumises à une suite complète de non-régression dans cet environnement.
2. Airtel Money : écran, transactions, mouvements de cash/e-float, historique et annulation avec écritures inverses présents dans le code ; pas de test d'exécution réel.
3. Unités/Megas : vente manuelle, coût e-float, paiement, référence, marge estimée et annulation présents ; aucune API opérateur de recharge n'est intégrée/validée.
4. Cartes SIM : stock et vente manuelle avec mouvement de caisse ; la file cloud après vente est maintenant persistée. Pas de test d'exécution réel.
5. Cabines/agents : création, attribution et activation/désactivation des registres présents. **Branchement incomplet : une session de caisse n'est pas liée par `cabin_id` à une cabine ; le numéro de registre dans la session n'est pas sélectionné depuis la cabine.** Ne pas considérer le multi-cabine comme opérationnel pour séparer les caisses.
6. Commissions : règles de taux et de montant fixe et estimations présentes. **Aucun paiement réel de commission ni rapprochement contractuel automatique avec les opérateurs.** Les conversions entre devises différentes ne sont pas validées.
7. Rapports : rapports par période/devise et synthèses de vente présents. Exactitude comptable, conversions et rapprochement cash/e-float à vérifier avec des données de test.
8. Audit/synchronisation : mappings et file de synchronisation déclarés. Firebase réel, règles de sécurité Firestore, reprise après coupure, conflits entre appareils et idempotence non testés.

## Limites de validation de cet environnement

- `npm ci --no-audit --no-fund` n'a pas terminé avant le délai maximal.
- L'environnement dispose de Node.js 22.16.0 ; les paquets Firebase résolus dans le lockfile annoncent un moteur Node >=24.12.0.
- `npm run build` échoue avant compilation applicative car des dépendances/types manquent (`@types/node`, React, D3, etc.) et les exécutables locaux TypeScript/Vite ne sont pas installés complètement. Ce résultat est un échec d'environnement, pas une preuve que le code compile.
- Aucun test de navigateur, PGlite dans le navigateur, Firebase ou Netlify n'a été exécuté.

## Recommandation

Cette archive peut être utilisée **uniquement sur un déploiement de préproduction/test**, après sauvegarde, et jamais sur l'instance de production ou avec des données réelles de clients. Le module multi-cabine et la compilation restent bloquants pour une validation de production. Suivre `PLAN_TESTS_A_Z_TeleBoutik.md` et arrêter au premier test échoué.
