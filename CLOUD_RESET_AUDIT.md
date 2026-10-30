# Audit — Réinitialisation des données cloud

## Correction apportée

Le bouton « Réinitialiser les données cloud » appelle `resetCloudBusinessData()` dans `src/db/cloudReset.ts`. L'ancienne liste couvrait principalement les collections historiques et omettait les nouveaux modules : garanties, réparations SAV, dettes/relances, suggestions de réassort, validations de gérant et sauvegardes. Elle contenait aussi `users`, alors que le moteur de synchronisation utilise `app_users` pour les comptes.

La liste révisée inclut les collections opérationnelles historiques et celles des nouveaux modules, même si ces dernières ne sont pas encore reliées au moteur de synchronisation courant. Chaque collection est interrogée côté serveur et ses documents sont supprimés par lots de 400. Le résultat indique le nombre de documents supprimés et le nombre de collections vérifiées.

## Données volontairement conservées

- `stores` : configuration et identité des boutiques.
- `app_users` : comptes utilisateurs.
- `settings` : paramètres, y compris le logo de la boutique.
- `audit_log` : historique d'audit permanent. Un événement de réinitialisation y est ajouté après suppression.

Les données locales PGlite de l'appareil ne sont pas effacées par ce bouton.

## Limites importantes

- Firestore ne permet pas une transaction atomique couvrant toutes ces collections. Si une erreur réseau ou de permission survient au milieu, la suppression peut être partielle ; l'erreur est remontée et l'action peut être relancée après inspection.
- La suppression par lots est limitée à 400 documents par lot, en dessous de la limite Firestore de 500 opérations par batch.
- Les collections Firestore ne peuvent être découvertes exhaustivement depuis le client sans connaître leurs noms. La fonction vérifie explicitement la liste ci-dessus ; toute nouvelle collection ajoutée à l'avenir doit être ajoutée à `RESETTABLE_COLLECTIONS`.
- Les sous-collections imbriquées ne sont pas supprimées par la suppression des documents parents. Les modules actuels listés utilisent des collections de premier niveau ; si des sous-collections sont ajoutées, une procédure dédiée côté serveur sera nécessaire.
- Ce bouton est réservé au rôle `owner` et exige la confirmation textuelle `REINITIALISER CLOUD`.

## Tests réalisés

- Inspection statique de la liste par comparaison avec les mappings du moteur de synchronisation et les tables ajoutées dans `localDb.ts`.
- Vérification statique que les comptes utilisent `app_users`, et que `stores`, `settings` et `audit_log` restent hors de la liste supprimée.
- Vérification de la taille des lots (400) et du journal d'audit écrit après suppression.
- Pas de test destructif sur le vrai projet Firebase et pas de compilation complète dans cet environnement. Tester d'abord sur un projet Firebase de test.
