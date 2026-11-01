# Modifications TeleBoutik — ticket, caisse et prix (29/10/2026)

- Suppression des deux lignes « Taux vente » et « Taux échange » sur le ticket imprimable.
- Ajout, juste avant le message de remerciement, de la mention en gras : « La marchandise vendue n’est ni remboursée ni échangée ! ».
- Le POS recharge la session de caisse ouverte depuis la base à l'ouverture de l'écran et revérifie la session au moment de valider le panier, afin d'éviter de demander d'ouvrir une caisse déjà ouverte lorsque le contexte React était périmé.
- Les cartes des produits dans les résultats de recherche affichent désormais le prix avec la devise propre à la variante (USD ou CDF), sans attendre le clic sur le produit.

## Vérification

Les changements de code ont été appliqués. La compilation n'a pas pu être validée dans cet environnement : `npm ci` a expiré et l'installation des dépendances est incomplète. À vérifier avec `npm ci` puis `npm run build` dans un environnement réseau fonctionnel.
