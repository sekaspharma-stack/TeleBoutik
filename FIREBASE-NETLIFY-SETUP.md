# Liaison Firebase ↔ Netlify (pas à pas)

## A. Dans Firebase

1. Ouvrir https://console.firebase.google.com/ et sélectionner le projet destiné à TeleBoutik.
2. Dans **Build → Firestore Database**, vérifier que la base existe.
3. Dans **Project settings → General → Your apps**, ouvrir l'application Web et copier les champs de sa configuration Web.
4. Utiliser les champs `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId` et, si disponible, `measurementId`.
5. Ne jamais copier une clé de compte de service/Admin dans une variable `VITE_*` ou dans le code navigateur.

## B. Dans Netlify

1. Ouvrir le projet `teleboutik`.
2. Aller dans **Project configuration → Environment variables**.
3. Créer les variables suivantes avec les valeurs exactes de la configuration Web Firebase :
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`
   - `VITE_FIREBASE_MEASUREMENT_ID` (facultative)
4. Ce sont des valeurs de configuration Web publiques, nécessaires au navigateur. Ne les marquez pas « Contains secret values ». Supprimer ensuite les anciennes variables `apiKey` et `authDomain` si elles ne sont plus utilisées.
5. Vérifier : Base directory vide, Build command `npm run build`, Publish directory `dist`.
6. Déclencher un nouveau déploiement et vérifier `Published`.

## C. Premier lancement

1. Ouvrir le site. Si l'ancienne boutique de démonstration exacte `TeleShop Abidjan` est présente dans la base locale, cette version la supprime afin de ne pas garder les produits/ventes d'exemple.
2. L'assistant **Configurer TeleBoutik** doit apparaître si aucune boutique et aucun utilisateur ne sont trouvés. Entrer les informations réelles de la boutique et choisir un PIN propriétaire de 4 à 6 chiffres.
3. Se connecter avec ce PIN.
4. Créer un produit test, attendre quelques secondes, puis vérifier dans Firestore les collections `stores`, `app_users` et `products`.
5. Recharger le site : les données doivent toujours être présentes.

## Sécurité à traiter avant la production

Le mode test Firestore est temporaire et peut permettre des lectures/écritures publiques. Le PIN est haché côté application, mais cela ne remplace pas Firebase Authentication et des règles Firestore strictes. Ne saisissez aucune vraie donnée sensible tant que cette étape n'est pas faite.
