# TeleBoutik POS — plan de validation A à Z

## État des travaux et limites

Les écrans et branchements de base suivants sont présents dans cette version de travail :
- Airtel Money : Cash In / Cash Out, mouvements de caisse, historique et annulations;
- Unités & Megas : enregistrement de vente, consommation e-float, paiement et référence;
- Cartes SIM : entrée en stock, vente, attribution de l'agent et mouvement de caisse;
- Cabines & agents : registre de caisse, affectation d'agent et activation/désactivation;
- Rapports & commissions : filtres de période/devise, agrégats et règles indicatives de commission;
- Audit et synchronisation : nouvelles tables ajoutées au moteur de synchronisation et à la liste de réinitialisation cloud.

**Cette archive n'est pas encore certifiée pour la production.** Le contrôle TypeScript syntaxique est passé sur 32 fichiers avec zéro diagnostic. Les contrôles statiques des routes et mappings de synchronisation sont passés. La compilation complète `npm run build` n'a pas pu s'exécuter : l'environnement a des dépendances/types manquants (`@types/node`, `@types/react`, types D3, etc.) et l'exécutable Vite n'est pas présent dans `node_modules/.bin`. Aucun test réel sur un projet Firebase/Netlify connecté n'a pu être déclaré réussi.

## Préparation obligatoire

1. Faire une sauvegarde de la base locale et exporter les données Firebase avant les tests.
2. Déployer uniquement sur une URL de préproduction, jamais directement sur la production.
3. Créer des comptes de test distincts : propriétaire, gérant, vendeur A, vendeur B et comptable.
4. Préparer une cabine/registre 1 attribuée au vendeur A et une cabine/registre 2 attribuée au vendeur B.
5. Utiliser des références de test identifiables, par exemple `TEST-AM-001`, `TEST-TEL-001`, `TEST-SIM-001`.
6. Vérifier que les données testées ne sont pas des données réelles de clients.

## A — Installation et démarrage

- Installer les dépendances du projet avec la version Node compatible avec le projet et son fichier de verrouillage.
- Lancer `npm run build`. Le test est réussi uniquement si `tsc -b` et `vite build` terminent avec le code 0.
- Lancer l'application en préproduction et vérifier l'absence d'erreurs fatales dans la console.
- Ouvrir chaque route depuis le menu et directement par URL : `/cash`, `/airtel-money`, `/telecom-sales`, `/sim-cards`, `/cabins`, `/reports-commissions`, `/audit`.

## B — Connexion et rôles

- Vérifier que chaque PIN valide connecte le bon compte et qu'un PIN invalide est refusé.
- Vérifier qu'un vendeur ne peut pas ouvrir Cabines & agents ni modifier les règles de commission.
- Vérifier que le comptable peut consulter les rapports mais ne peut pas modifier les règles.
- Vérifier que le gérant peut gérer les cabines/règles, mais que la réinitialisation cloud reste réservée au propriétaire.
- Vérifier la déconnexion et l'expiration automatique de session.

## C — Cabines et affectations

- Créer « Cabine A » avec registre 1, attribuée au vendeur A.
- Créer « Cabine B » avec registre 2, attribuée au vendeur B.
- Vérifier le refus d'un numéro de registre déjà utilisé ou d'un nom déjà utilisé.
- Se connecter comme vendeur A : la cabine B ne doit pas être sélectionnable.
- Tenter d'ouvrir une caisse déjà ouverte sur le même registre depuis un autre compte : l'ouverture doit être refusée.
- Désactiver une cabine et vérifier qu'elle ne peut plus être ouverte par un vendeur.
- Vérifier que les mouvements et opérations d'une session restent liés à son `cash_session_id` et à son registre.

## D — Ouverture, mouvements et clôture de caisse

- Ouvrir une session avec des soldes de départ distincts : cash USD, cash CDF, e-float USD et e-float CDF.
- Vérifier chaque solde sur l'écran Caisse et dans les mouvements.
- Enregistrer un dépôt puis un retrait et contrôler le signe et le montant.
- Fermer la caisse avec un montant compté exact : écart attendu égal à zéro.
- Refaire avec un montant différent : l'écart doit être calculé et conservé.
- Vérifier qu'une caisse fermée ne peut plus être utilisée pour une nouvelle opération.

## E — Airtel Money Cash In

- Avec un solde e-float suffisant, créer un Cash In avec numéro client, montant, devise et référence unique.
- Vérifier l'entrée du cash physique et la sortie d'e-float selon le flux défini.
- Vérifier l'historique, l'agent, la session et l'audit.
- Rejouer la même référence : le doublon doit être refusé.
- Tester un solde e-float insuffisant : aucune transaction ni mouvement ne doit être créé.

## F — Airtel Money Cash Out

- Avec assez de cash physique, créer un Cash Out.
- Vérifier la sortie de cash et l'entrée d'e-float selon le flux défini.
- Tester un cash physique insuffisant : aucune écriture ne doit être créée.
- Vérifier l'affichage des deux devises sans conversion implicite.

## G — Annulation Airtel Money

- Annuler une opération comme propriétaire/gérant avec un motif obligatoire.
- Vérifier que l'original reste visible en statut annulé et n'est pas supprimé.
- Vérifier les écritures inverses, le motif, l'auteur et la date d'annulation.
- Retenter l'annulation : elle doit être refusée pour éviter une double inversion.
- Vérifier que le vendeur ne dispose pas de l'action d'annulation.

## H — Unités et forfaits Megas

- Enregistrer une vente valide pour chaque opérateur utilisé en test.
- Vérifier le numéro client, le type de service, la valeur faciale, le coût, le prix, la devise, le paiement et la référence.
- Vérifier que le coût est déduit du portefeuille e-float de l'opérateur et que le paiement client augmente le mode de paiement sélectionné.
- Tester coût supérieur au prix, référence vide, référence en double et e-float insuffisant : tout doit être refusé sans mouvement partiel.
- Vérifier la marge affichée : prix de vente moins coût, dans la même devise.
- Annuler une vente en tant que gérant et contrôler les écritures inverses et l'audit.

## I — Cartes SIM

- Ajouter une SIM avec opérateur, numéro, ICCID facultatif, coût, prix et devise.
- Tenter d'ajouter le même numéro ou le même ICCID : le doublon doit être refusé.
- Vendre une SIM disponible en choisissant un mode de paiement et une référence.
- Vérifier le statut vendu, le client, l'agent vendeur, la référence, la marge et le mouvement de caisse.
- Tenter de vendre une deuxième fois la même SIM : refus obligatoire.
- Vérifier que les SIM vendues ne sont plus présentées comme disponibles.

## J — Rapports et commissions

- Tester Aujourd'hui, Hier, 7 derniers jours, mois en cours et période personnalisée.
- Vérifier le refus d'une période dont la date de début est postérieure à la date de fin.
- Tester USD et CDF séparément ; vérifier qu'aucun total ne mélange les devises.
- Comparer les nombres et totaux des rapports aux lignes d'historique pour chaque service.
- Configurer une règle de commission avec taux et fixe, puis vérifier le calcul indicatif.
- Vérifier que la règle n'est pas présentée comme un paiement réel et qu'elle ne modifie pas la caisse.
- Vérifier que les dépenses sont agrégées uniquement dans leur devise enregistrée.

## K — Audit

- Vérifier les événements de connexion/déconnexion, création de SIM, vente de SIM, création/affectation de cabine, règles de commission et opérations Airtel/Telecom.
- Vérifier que l'audit donne l'identifiant de l'agent, l'heure, l'action et la référence.
- Vérifier que l'annulation conserve l'historique initial et les écritures inverses.
- Vérifier que les vendeurs n'accèdent pas aux actions réservées au propriétaire.

## L — Synchronisation Firebase

- Avec une connexion active, créer une opération et vérifier la présence du document correspondant dans la collection Firebase attendue.
- Vérifier les collections `airtel_transactions`, `telecom_transactions`, `sim_cards`, `cabins`, `commission_rules` et `cash_movements`.
- Vérifier que les identifiants locaux et cloud correspondent et que les montants/champs critiques ne sont pas perdus.
- Couper Internet, créer une opération de test, puis rétablir Internet.
- Vérifier que l'opération en attente est synchronisée une seule fois et que le compteur d'attente revient à zéro.
- Ouvrir la même préproduction dans un second navigateur/appareil et vérifier que les changements cloud réapparaissent.
- Tester un conflit de mise à jour et un refus Firebase : l'erreur doit être visible, sans fausse confirmation de synchronisation.

## M — Hors ligne et reprise

- Passer hors ligne avant l'ouverture de l'application et vérifier que les données locales restent accessibles.
- Créer une vente test hors ligne, fermer/réouvrir l'application, puis vérifier la persistance locale.
- Reconnecter Internet et vérifier la reprise de synchronisation.
- Redémarrer pendant qu'une opération est en attente et vérifier que la file survit au redémarrage.

## N — Non-régression boutique

- Effectuer une vente de produit classique, une vente en gros, une recherche produit, un paiement mixte et une clôture de caisse.
- Vérifier stock, ticket, historique des ventes, marge, paiements et mouvements de caisse.
- Vérifier que les modules télécom/SIM ne modifient pas les quantités du stock marchand.
- Vérifier que les totaux USD/CDF et les soldes Airtel/Orange/MTN/Vodacom restent cohérents.

## O — Tests de robustesse

- Double-cliquer rapidement sur les boutons d'enregistrement : une seule opération doit être créée.
- Simuler une erreur après le début d'une transaction SQL : rollback complet, aucune écriture orpheline.
- Vérifier les références vides/dupliquées, les montants négatifs, zéro, très élevés et les numéros invalides.
- Vérifier que les historiques restent rapides avec plusieurs milliers de lignes et qu'ils n'entraînent pas de blocage du menu.

## P — Réinitialisation cloud

- Ne jamais tester la réinitialisation sur des données réelles.
- Utiliser une base Firebase dédiée aux tests, vérifier la liste exacte des collections visées et sauvegarder avant exécution.
- Vérifier que le propriétaire seul peut exécuter l'action et que le journal d'audit de réinitialisation est conservé.

## Q — Préproduction Netlify

- Construire l'application avec `npm run build` réussi.
- Déployer une branche ou un site Netlify de préproduction distinct.
- Vérifier les variables Firebase, domaines autorisés, règles Firestore et les chemins de routage SPA.
- Tester le rafraîchissement direct de chaque URL et la reprise après mise à jour.

## R — Critères d'acceptation avant production

Tous les critères suivants sont obligatoires :
1. Compilation complète réussie sans erreurs TypeScript.
2. Tous les tests B à Q exécutés et consignés avec résultat PASS/FAIL.
3. Aucune écriture partielle en cas d'erreur ou de solde insuffisant.
4. Aucun doublon lors d'un double-clic ou d'une reprise de synchronisation.
5. Soldes de caisse/e-float rapprochés avec les mouvements sources.
6. Les rôles et affectations d'agents sont respectés.
7. Les données sont synchronisées sur deux clients connectés et survivent au mode hors ligne.
8. Sauvegarde de production et procédure de retour arrière prêtes.

## Feuille de résultat

Pour chaque test, noter : identifiant, date/heure, environnement, utilisateur/ rôle, données d'entrée, résultat attendu, résultat réel, preuve (capture/log), PASS/FAIL, correctif et retest. Aucun test non exécuté ne doit être marqué PASS.
