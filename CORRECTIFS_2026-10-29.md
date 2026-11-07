# Correctifs TeleBoutik

## 1. Bouton Thermique Bluetooth
- Le bouton « Thermique Bluetooth » est désormais toujours affiché dans le reçu, comme dans la capture de référence.
- Si le navigateur ou le pont d’impression ne prend pas en charge l’impression Bluetooth directe, le clic affiche le message explicatif déjà géré par le service d’impression.

## 2. Annulation d’une vente
- Correction de la requête SQL qui écrit l’écriture comptable d’annulation dans `journal_entries`.
- L’ancienne requête plaçait `$4` dans une chaîne SQL entre apostrophes (`'Annulation vente $4'`) : ce n’était donc pas un paramètre SQL, alors que le tableau de paramètres fournissait la référence du ticket à cette position. Cela pouvait provoquer une erreur de nombre de paramètres.
- La description est maintenant passée comme véritable paramètre `$4` (`Annulation vente <numéro de ticket>`), avec les paramètres suivants correctement alignés.

## Validation
- Relecture statique des deux modifications effectuée.
- La compilation complète n’a pas pu être vérifiée dans cet environnement, car les dépendances npm ne sont pas installées (types Node et modules React absents). Exécuter `npm install`, puis `npm run build` dans le dossier `tele` avant déploiement.
