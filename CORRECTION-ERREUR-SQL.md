Correction ciblée de l'erreur d'initialisation TeleBoutik

Cause identifiée dans le code source : les requêtes d'écriture du journal comptable utilisaient $4 à l'intérieur d'une chaîne SQL entre apostrophes (par exemple 'Vente $4'). PostgreSQL traite cela comme du texte littéral, pas comme un paramètre. Comme les paramètres suivants étaient $5, $6 et $7, le paramètre $4 n'était pas typé et pouvait provoquer « Could not determine data type of parameter ».

Correction : les descriptions concatènent désormais le texte et le paramètre avec || $4 dans src/db/seed.ts et src/db/saleService.ts, y compris l'annulation d'une vente. Le démarrage du seed vérifie aussi si une boutique existe déjà : si oui, il marque le seed terminé au lieu de relancer des centaines d'insertions de données de démonstration à chaque échec précédent, ce qui évite les duplications et les longues attentes répétées.

À déployer depuis le code source avec la commande npm run build et le dossier publié dist. Ne pas déployer le vieux dossier dist seul.

Validation : le build local n'a pas pu être confirmé dans cet environnement, car l'installation npm a été interrompue et les dépendances sont incomplètes. Le déploiement Netlify doit donc être vérifié après publication.
