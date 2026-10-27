# TeleBoutik POS

Application de gestion de boutique de téléphonie : point de vente (POS), gestion de stock avec IMEI, caisse, crédit client, et tableau de bord financier.

## Stack technique

- **Frontend** : React 18 + TypeScript + Vite
- **UI** : Tailwind CSS + lucide-react (icônes) + recharts (graphiques)
- **Base de données** : Supabase (PostgreSQL) — schéma cloud avec RLS
- **PWA** : vite-plugin-pwa (fonctionnement hors-ligne possible)
- **State** : Zustand
- **Routage** : React Router

## Prérequis

- Node.js 20+
- Un compte Supabase avec un projet provisionné

## Installation

```bash
npm install
```

## Configuration

Créer un fichier `.env` à la racine avec les variables Supabase :

```
VITE_SUPABASE_URL=https://votre-projet.supabase.co
VITE_SUPABASE_ANON_KEY=votre-cle-anon
```

Ces variables sont préfixées `VITE_` pour être accessibles côté client (Vite ne expose que les variables avec ce préfixe).

## Développement

```bash
npm run dev
```

L'application est disponible sur http://localhost:5173

## Build

```bash
npm run build
```

Les fichiers compilés sont générés dans `dist/`.

## Base de données Supabase

Le schéma de la base de données est défini dans `supabase/migrations/`. Les migrations sont appliquées via les outils MCP Supabase.

### Tables principales

| Table | Description |
|-------|-------------|
| `stores` | Informations boutique, devise, TVA |
| `app_users` | Personnel (propriétaire, gérant, vendeur, comptable) |
| `products` / `product_variants` | Catalogue produits avec SKU et prix |
| `imei_units` | Suivi des téléphones par IMEI |
| `stock_movements` | Mouvements de stock (event sourcing) |
| `sales` / `sale_lines` / `sale_payments` | Ventes et paiements |
| `cash_sessions` / `cash_movements` | Gestion de caisse |
| `customers` | Clients et crédit |
| `audit_log` | Journal d'audit immuable |
| `sync_ops` | Synchronisation local/cloud |

### Sécurité (RLS)

Toutes les tables ont Row Level Security activé. L'accès est limité aux utilisateurs authentifiés.

## Déploiement

### Déploiement sur Bolt

L'application peut être déployée directement depuis Bolt (bouton "Deploy" dans l'interface).

### Déploiement manuel (Vercel, Netlify, etc.)

1. Construire le projet : `npm run build`
2. Déployer le dossier `dist/` sur votre hébergeur statique
3. Configurer les variables d'environnement `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` sur l'hébergeur

### GitHub

1. Initialiser le repo : `git init && git add . && git commit -m "Initial commit"`
2. Créer un repo sur GitHub et pousser : `git remote add origin <url> && git push -u origin main`

### Variables d'environnement pour GitHub Actions

Dans Settings > Secrets and variables > Actions, ajouter :
- `VITE_SUPABASE_URL` — l'URL du projet Supabase
- `VITE_SUPABASE_ANON_KEY` — la clé anon Supabase

## Codes PIN de démonstration

- `0000` — Propriétaire
- `1111` — Gérant
- `2222` — Vendeur

## Licence

Usage privé — TeleBoutik.
