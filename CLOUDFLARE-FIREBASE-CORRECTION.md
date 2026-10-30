# TeleBoutik — correction Cloudflare Pages / Firebase

Cette archive corrige la configuration de build identifiée dans `V7.3-CLOUDFLARE-FIREBASE-CHECK`.

## Configuration Cloudflare Pages

- Framework preset : **Vite** (ou None si Vite n'est pas proposé).
- Build command : `npm run build:cloudflare`
- Build output directory : `dist`
- Root directory : laisser vide.
- Production branch : `main`.
- Node.js : le fichier `.node-version` fixe Node à `24.12.0`.

## Variables Firebase pendant le build

Le script vérifie que les quatre variables indispensables sont réellement accessibles au processus de build, sans afficher leurs valeurs.

Dans **Settings → Variables and Secrets**, configure ces noms pour **Production** :

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`

Recommandé pour le problème de disponibilité observé dans les logs : sélectionner le type **Secret** plutôt que **Text** pour ces variables, puis saisir les valeurs exactes de la configuration Web Firebase. Les trois variables ci-dessous sont facultatives pour le démarrage de Firebase, mais il est préférable de les configurer aussi :

- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_MEASUREMENT_ID`

Si le type d'une variable existante ne peut pas être modifié, supprime/recrée uniquement cette variable avec le même nom et le type **Secret**. Fais-le une variable à la fois, en recopiant la valeur depuis Firebase Console. Ne partage pas ces valeurs dans le chat.

**Important :** la configuration Firebase Web n'est pas un secret une fois intégrée au JavaScript livré au navigateur. Le type Secret sert ici à transmettre la valeur au build de manière chiffrée dans le tableau de bord ; il ne rend pas la configuration privée dans l'application publiée. La sécurité repose sur les règles Firebase/Firestore et les autorisations appropriées. Ne place jamais de clé de compte de service Firebase dans une variable `VITE_*`.

## Validation après déploiement

1. Lance un nouveau déploiement de la branche `main`.
2. Dans les logs, vérifie que les quatre variables obligatoires affichent `PRESENTE` et que le build se termine avec succès.
3. Ouvre l'application et vérifie l'état de synchronisation Firebase/Firestore ainsi qu'une opération de synchronisation réelle.
4. Si une variable apparaît encore `ABSENTE`, le script s'arrêtera volontairement au lieu de déployer une application avec la synchronisation cloud désactivée.

Le contrôle ne journalise jamais les valeurs des variables.
