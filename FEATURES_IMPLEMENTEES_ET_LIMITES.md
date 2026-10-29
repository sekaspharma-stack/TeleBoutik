# TeleBoutik — extensions livrées dans cette archive

## Implémenté dans le code
- `completeSale` est enveloppée par `BEGIN / COMMIT / ROLLBACK`; les écritures vente/lignes/stock/paiements/caisse/journal/audit/file de synchronisation sont exécutées dans la transaction. Le déclenchement de la synchronisation des tables est différé jusqu'au commit.
- Onglet Paramètres > Sauvegardes (gérant/propriétaire) : export complet JSON chiffré AES-256-GCM, clé dérivée d'une phrase secrète PBKDF2-SHA256 (310 000 itérations); export CSV des ventes du jour et du journal d'audit.
- Ticket : impression via la boîte d'impression du navigateur (choisir « Enregistrer au format PDF ») et partage WhatsApp de la référence + résumé textuel.
- Tables additives/migrations pour garantie par IMEI, historique SAV/réparations, registre de dettes et relances, suggestions de réassort, validations gérant et appartenance multi-boutiques.
- Services typés dans `src/db/operations.ts` pour enregistrer les garanties/SAV/dettes, consulter les garanties qui expirent, proposer le réassort, calculer la marge par produit, consolider les ventes par boutique et enregistrer une validation PIN distincte du demandeur.
- Composant réutilisable de scan caméra (`src/components/CameraScanner.tsx`) et impression d’étiquettes code/IMEI (`src/lib/labels.ts`) ajoutés au code source.

## Limites à connaître (pas prétendre le contraire)
- La sauvegarde chiffrée et les exports sont déclenchés manuellement. Le navigateur ne peut garantir un export quotidien automatique lorsque l'application est fermée; pour cela il faut un service serveur/cron ou une tâche installée sur le poste. La phrase secrète n'est jamais stockée.
- Le bouton WhatsApp partage le résumé et la référence, pas une pièce PDF jointe automatiquement. Pour joindre le PDF, imprimer/enregistrer le ticket en PDF puis joindre ce fichier dans WhatsApp. Un vrai envoi automatique nécessite une intégration WhatsApp Business approuvée.
- Les tables et services Garantie/SAV/dettes/réassort/multi-boutiques sont des fondations de données et de logique; leurs écrans complets, rappels planifiés, scan caméra, étiquettes et tableau de bord consolidé ne sont pas encore reliés à la navigation.
- L'envoi SMS nécessite une passerelle SMS locale/fournisseur et des identifiants; aucun SMS n'est envoyé par cette archive.
- Les rôles restent ceux du schéma existant. Les validations par PIN gérant doivent encore être reliées aux actions sensibles avant de considérer ce contrôle comme appliqué partout.
- Le build de validation n'a pas pu être exécuté ici : `npm ci` a expiré pendant le téléchargement des dépendances. Après extraction, exécuter `npm ci` puis `npm run build`; corriger toute erreur TypeScript révélée avant déploiement.

## Adaptation locale
Les montants utilisent les devises déjà prises en charge par l'application (CDF/USD) et les exports CSV utilisent le séparateur `;` et le BOM UTF-8 pour une ouverture plus fiable dans Excel en français. Les relances restent préparées pour le téléphone du client, mais nécessitent le choix d'un canal et la confirmation humaine avant envoi.
