# TeleBoutik POS — Firebase + Netlify

Application React/Vite pour point de vente, stock, caisse, ventes et suivi de gestion.

## Configuration Firebase

Le client Firebase lit la configuration Web dans les variables d'environnement `VITE_FIREBASE_*`. Les valeurs doivent venir de Firebase Console → Paramètres du projet → Général → Vos applications → application Web.

Variables requises :

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MEASUREMENT_ID` (facultative pour Firestore, mais conseillée si disponible)

En local, copiez `.env.example` vers `.env` puis remplissez les valeurs. Dans Netlify, ajoutez les mêmes variables dans Project configuration → Environment variables. Ces valeurs sont la configuration Web publique Firebase, pas une clé de compte de service. Ne mettez jamais de clé Admin/service-account dans le navigateur.

## Démarrage initial

1. Vérifiez que Firestore Database est activée dans le projet Firebase choisi.
2. Configurez les variables `VITE_FIREBASE_*` dans les paramètres de build de votre hébergeur avant le déploiement. Pour Cloudflare Pages, utilisez `npm run build:cloudflare` : la compilation s’arrête si les variables Firebase obligatoires sont absentes.
3. Laissez Netlify construire le projet avec `npm run build` et publier le dossier `dist`.
4. Ouvrez l'application. Si aucune boutique et aucun utilisateur n'existent, l'assistant de première configuration apparaît. Il crée la boutique et le premier compte propriétaire, sans données de démonstration.
5. Connectez-vous avec le PIN défini dans l'assistant. Les écritures locales sont synchronisées vers Firestore en arrière-plan; au premier démarrage, les collections Firestore sont aussi restaurées vers une base locale vide.

## Important — sécurité

Le mode test Firestore autorise temporairement l'accès selon les règles créées par Firebase et expire généralement. Il convient uniquement aux essais. L'application actuelle utilise un PIN applicatif local et n'a pas encore de véritable authentification Firebase pour chaque utilisateur; **ne stockez pas de données réelles ni sensibles tant que l'authentification et les règles Firestore ne sont pas durcies**. Une clé Firebase Web n'est pas un secret, mais les règles Firestore doivent empêcher l'accès non autorisé.

## Déploiement Netlify

- Base directory : vide (racine du dépôt)
- Build command : `npm run build`
- Publish directory : `dist`
- Node : `24.12.0` (configuré dans `netlify.toml` pour correspondre à la version Firebase du verrouillage de dépendances)

Le dossier `dist` est généré pendant le build et ne doit pas être publié depuis une ancienne copie committée.


## Ajouts de cette version (USD / CDF)

- Paramètres Finance : deux taux distincts et configurables, sans taux d’exemple imposé. Le taux de vente doit être supérieur au taux d’échange.
- Point de vente : lorsqu’on utilise USD comme devise de la boutique, possibilité de saisir un paiement en USD ou CDF; les montants CDF sont convertis au taux de vente. Les valeurs originales et le taux appliqué sont enregistrés pour le reçu et l’historique.
- Monnaie rendue : choix USD ou CDF. Pour un paiement cash en CDF, si la monnaie est rendue en USD, le calcul applique le taux d’échange configuré, conformément à la règle demandée. La sortie de monnaie est enregistrée comme mouvement de caisse séparé.
- Reçus : affichage du client, des taux enregistrés au moment de la vente, de l’équivalent CDF, des paiements dans leur devise réelle et de la monnaie rendue.
- Caisse : journal séparé des échanges USD vers CDF, sans les compter comme ventes de marchandises.
- Stock : modification des prix d’achat, de vente et de gros d’un produit existant sans créer de doublon ni modifier les quantités ou mouvements de stock.
- Migration additive : les nouvelles colonnes sont ajoutées sans réécrire les anciennes ventes ni les stocks. Les anciens reçus gardent leurs données historiques.

## Vérification et précautions

Le contrôle de syntaxe TypeScript a été exécuté sans diagnostic de syntaxe. La compilation complète et les tests de bout en bout n’ont pas pu être confirmés dans cet environnement : l’installation des dépendances a dépassé le délai disponible, et l’environnement local utilise Node 22 alors que des dépendances Firebase du projet exigent Node >=24.12.0. Ne déploie pas cette archive directement sur la caisse de production sans sauvegarde préalable et test contrôlé.

**Attention au calcul de monnaie USD :** les taux sont saisis en CDF pour 1 USD. Mathématiquement, diviser un même excédent CDF par un taux plus bas donne davantage de dollars, pas moins. Le code suit ici la règle explicitement demandée (taux d’échange plus bas), mais si l’objectif prioritaire est de minimiser les dollars remis, il faut valider ce choix économique avant une utilisation réelle.

## Déploiement multi-hébergeurs

Les fichiers `vercel.json`, `netlify.toml`, `wrangler.toml`, `public/_redirects` et `public/_headers` préparent les déploiements Vercel, Netlify et Cloudflare Pages. Voir [`DEPLOY_MULTI_HEBERGEURS.md`](./DEPLOY_MULTI_HEBERGEURS.md) pour les paramètres à utiliser.
