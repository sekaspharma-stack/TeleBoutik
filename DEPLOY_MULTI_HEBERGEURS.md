# Déploiement TeleBoutik — Netlify, Cloudflare Pages et Vercel

Cette version ajoute les fichiers de configuration des trois hébergeurs. L'application reste une SPA Vite : le dossier publié est `dist` et les routes client doivent retomber sur `/index.html`.

## Commandes de build

```bash
npm ci
npm run build
```

Le build utilise TypeScript (`tsc -b`) puis Vite. Utiliser une version Node compatible avec les dépendances du lockfile ; la configuration Netlify existante fixe Node `24.12.0`.

## Netlify

- Base directory : racine du projet
- Build command : `npm run build`
- Publish directory : `dist`
- Variables d'environnement : ajouter les variables `VITE_FIREBASE_*` nécessaires dans les paramètres du site.
- `netlify.toml` configure déjà le fallback SPA et les règles de cache.

## Cloudflare Pages

- Connecter le dépôt Git à Pages.
- Framework preset : Vite (ou configuration personnalisée)
- Build command : `npm run build`
- Build output directory : `dist`
- Root directory : `/`
- Ajouter les variables `VITE_FIREBASE_*` dans Settings → Variables and Secrets → Build.
- `public/_redirects` est copié dans `dist` par Vite et configure le fallback SPA.
- `public/_headers` configure les en-têtes de cache.
- `wrangler.toml` documente le répertoire de sortie Pages pour les workflows Wrangler compatibles.

## Vercel

- Importer le dépôt et choisir Vite si la détection automatique n'est pas proposée.
- Build command : `npm run build`
- Output directory : `dist`
- Ajouter les variables `VITE_FIREBASE_*` dans Project Settings → Environment Variables.
- `vercel.json` configure le fallback SPA et les en-têtes de cache.

## Important

- Les variables `VITE_*` sont incorporées dans le bundle navigateur au moment du build : ce ne sont pas des secrets. Ne jamais placer une clé de compte de service Firebase ou une clé privée dans ces variables.
- Vérifier les règles Firestore, l'authentification et les variables de chaque environnement avant d'utiliser des données réelles.
- Les redirections SPA ne remplacent pas une configuration de sécurité backend.
- Les configurations sont ajoutées, mais un déploiement réel doit être testé séparément sur chaque fournisseur.
