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
2. Configurez les variables `VITE_FIREBASE_*` dans Netlify avant le déploiement.
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
