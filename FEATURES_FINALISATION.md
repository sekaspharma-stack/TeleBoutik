# TeleBoutik — état de finalisation des 9 fonctions

Cette version ajoute un écran **Gestion avancée** accessible depuis le menu et relie les fondations des modules à des parcours utilisables.

## Fonctionnalités reliées dans le code

1. **Ventes atomiques** : `completeSale` utilise `BEGIN/COMMIT/ROLLBACK`; les annulations de vente sont également transactionnelles. La file de synchronisation est déclenchée après commit. Une dette est créée dans le registre lors d'une vente à crédit associée à un client.
2. **Sauvegardes et audit** : export JSON chiffré AES-256-GCM avec phrase secrète (PBKDF2-SHA256), export CSV quotidien des ventes et export CSV du journal d'audit. Les dates de fichiers/export sont calculées dans le fuseau métier `Africa/Lubumbashi`.
3. **Reçu/PDF/WhatsApp** : le reçu contient la référence vérifiable, l'impression permet « Enregistrer au format PDF » et WhatsApp ouvre un message prérempli avec la référence. Le PDF doit être joint manuellement dans WhatsApp; l'API WhatsApp Business n'est pas configurée.
4. **Garantie/SAV par IMEI** : écran de création de garantie liée à une vente et éventuellement à une unité IMEI, liste des garanties expirant sous 90 jours, historique SAV et statut de réparation.
5. **Dettes/relances** : écran d'enregistrement des dettes, soldes, échéances, paiement de dette, préparation d'un rappel WhatsApp ou SMS. L'utilisateur confirme l'envoi dans l'application externe.
6. **Stock/marges** : affichage des suggestions de réassort et rapport de marge par produit avec dates choisies.
7. **Étiquettes/scan** : impression d'étiquette thermique et scan caméra via `BarcodeDetector` si pris en charge par le navigateur et si HTTPS/caméra autorisés. L'impression actuelle affiche le code en texte lisible; ce n'est pas encore un glyphe de code-barres graphique certifié.
8. **Rôles/PIN** : les annulations de ventes demandent motif et PIN d'un autre gérant/propriétaire; une remise supérieure au plafond du rôle requiert une validation PIN distincte. Les validations sont enregistrées dans `manager_approvals`.
9. **Multi-boutiques** : tableau consolidé des ventes, coûts et marges par boutique sur une période, réservé au gérant/propriétaire.

## Limites à régler avant production

- **Build non certifié** : `npm ci` a dépassé le délai dans cet environnement. La transpilation syntaxique de 49 fichiers TypeScript/TSX réussit, mais cela ne remplace pas `npm run build` avec toutes les dépendances. L'installation affiche aussi des avertissements de version Node des dépendances Firebase.
- **Sauvegarde quotidienne automatique chiffrée** : l'export chiffré est manuel afin de ne jamais stocker la phrase secrète dans le navigateur. Le CSV du jour est également manuel. Pour une tâche réellement automatique même application fermée, il faut un service planifié/serveur et une stratégie de gestion de clés de sauvegarde.
- **SMS/WhatsApp** : l'application ouvre les applications natives avec le message prérempli; aucun SMS ou WhatsApp n'est envoyé en arrière-plan. Les intégrations automatiques nécessitent les fournisseurs, les identifiants et les autorisations appropriés.
- **Multi-boutiques** : le tableau consolide les ventes présentes dans la base locale synchronisée. La séparation des droits et des stocks par boutique doit être vérifiée sur le modèle de données Firebase réel avant d'utiliser plusieurs boutiques en production; l'ancien schéma ne stocke pas `store_id` sur tous les mouvements de stock.
- **Code-barres** : étiquette thermique avec code en texte, pas encore un code-barres graphique à valider sur le matériel exact.
- Les opérations nouvelles doivent être testées sur une copie de la base de la boutique avant déploiement. Ne pas exécuter de réinitialisation cloud pour appliquer ces migrations.

## Commandes de validation après installation

```bash
npm ci
npm run lint
npm run build
```
