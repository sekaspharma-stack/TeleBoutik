# Modifications ZIP 3 — Montants, tickets, réglages, sceau

Base : ZIP 2 (transactions + compta). Les corrections ci-dessous s'ajoutent à celles du ZIP 1 et du ZIP 2.

## 1. Montants : REAL (float32) → NUMERIC (`localDb.ts`)
- Montants (prix, ventes, soldes, caisse, crédits…) : `NUMERIC(14,2)`. Taux de change : `NUMERIC(18,6)`. Pourcentages : `NUMERIC(9,4)`.
- Les quantités de stock (`current_stock`, `minimum_stock`, `suggested_quantity`) restent en REAL.
- **Migration automatique** des bases existantes (SCHEMA_VERSION `2026-10-30.1`), une seule fois par appareil.
  La conversion passe par `double precision` : un `real::numeric` direct ne garde que 6 chiffres (12 345 678 → 12 345 700).
  Les valeurs déjà faussées par le float32 ne peuvent pas être retrouvées ; elles sont arrondies au centime.
- PGlite renvoie NUMERIC en texte : un parseur (OID 1700 → nombre) est ajouté à l'ouverture de la base.
- `saleService.ts` arrondit tous les montants entrants (lignes, remise, paiements, monnaie rendue, taux) avant tout calcul, écriture ou sceau.

## 2. Numéro de ticket (`db/ticketNumber.ts`, `saleService.ts`, `lib/receipt.ts`)
- Format `AAAAMMJJ-APP-0042` : jour local, code appareil de 3 caractères (créé une fois, stocké dans `app_meta`), compteur séquentiel du jour.
- Attribué dans la transaction de la vente (verrou local) ; compteur = max(dernier ticket vendu, dernier numéro attribué).
- Index unique `idx_sales_ticket_number_unique`, **limité au nouveau format**. Les anciens tickets (`AAAAMMJJ-0042`) peuvent contenir des doublons : on ne les réécrit pas.
- `verifyReceipt` : recherche d'abord par référence (unique), puis par n° de ticket. Si plusieurs ventes portent le n°, résultat `ambiguous` (aucune vente au hasard). Le ticket ouvert dans l'app est contrôlé directement par son id (`verifySaleRecord`).
- `generateTicketNumber()` (aléatoire) supprimé de `utils.ts`.

## 3. Réglages : identifiant fixe (`db/settings.ts`)
- Chaque réglage a l'id `setting:<clé>` (ex. `setting:store_rccm`, `setting:store_logo_data_url`) via `saveSetting()` / `deleteSettings()`. Appliqué aussi aux taux USD/CDF.
- Migration locale : les lignes existantes sont renommées ; l'upsert du nouvel id et la suppression de l'ancien document cloud sont mis en file.
- `syncEngine.ts` : à la lecture du cloud, les documents `settings` sont ramenés sur `setting:<clé>` (anciens doublons fusionnés, le document canonique l'emporte).

## 4. Sceau du reçu v2 (`lib/receipt.ts`)
- Le sceau couvre en plus : paiements (mode, devise, montant, montant d'origine, taux, référence), monnaie rendue (montant + devise), taux de change, client, vendeur.
- Nouvelle référence `TB2-AAMMJJ-XXXXXX-YYYYYY`. Les reçus `TB-…` (ancien sceau) et sans sceau passent en **legacy**.
- Non couvert (volontairement) : nom du produit sur les lignes, remise de ligne, notes.

## À vérifier chez toi (`npm run build` et PGlite réel non exécutés ici : pas d'accès aux paquets)
1. Ouvrir l'app sur une base existante : la migration doit passer sans erreur, montants inchangés.
2. Vente en espèces, puis ticket : référence `TB2-…`, statut « authentique ».
3. Deux ventes de suite : `…-0001`, `…-0002`.
4. Enregistrer logo + RCCM sur deux appareils : une seule ligne par clé dans Firestore (`settings/setting:store_rccm`).
5. Si l'option `parsers` de PGlite ≥ 0.2 n'est pas reconnue par ta version, les montants reviendraient en texte : à tester en premier.
