# Mise à jour — thème sombre, cartes fusionnées, reçus vérifiables, archive IMEI, clients du shop

## 1. Mode sombre
- `src/lib/theme.ts` (store + persistance localStorage + suivi du thème système), `src/components/ThemeToggle.tsx` (interrupteur `role="switch"`).
- Interrupteur dans le menu latéral et la barre mobile. Script anti-flash dans `index.html`.
- Palette : fond #121212, surfaces #1E1E1E, texte #E0E0E0, accent #4FD1C5. Les écrans existants sont remappés dans `index.css` (section « MODE SOMBRE »).

## 2. Cartes USD + CDF fusionnées
- `src/components/MoneyCard.tsx` : `MoneyCard` (dégradé), `SoftMoneyCard`, `KpiCard`.
- Tableau de bord : « Chiffre d'affaires », « Encaissé », « Marge » = 1 carte chacune (USD et CDF).
- Caisse : Espèces physiques, Airtel Money, Total disponible, Fond d'ouverture, Entrées, Sorties = 1 carte chacune.

## 3. Reçus et anti double-clic
- Référence `TB-AAMMJJ-XXXXXX-YYYYYY` (id unique + empreinte SHA-256), colonnes `sales.receipt_ref` / `receipt_hash` (`src/lib/receipt.ts`, `saleService.ts`).
- Contrôle d'unicité du n° de ticket, refus de vendre deux fois le même IMEI.
- `LoadingButton` + `useSingleFlight` (verrou synchrone) : POS, Caisse (4 modales), Stock, Clients, Airtel, Unités/Megas, SIM, annulation de vente.

## 4. Archive IMEI (Stock → onglet « Archive vendus »)
- `SoldImeiArchive.tsx` : IMEI, vente, reçu, client, vendeur, chronologie des mouvements. Rien n'est supprimé. IMEI dupliqué refusé à la création.

## 5. Ventes
- Bouton « Voir le reçu », bloc « Vérifier un reçu » (authentique / altéré / ancien / introuvable).

## 6. Shop
- `CustomerSelect.tsx` : recherche, récupération et création rapide de client (Airtel Money et Unités/Megas). Colonnes `customer_id` (+ `customer_name` pour télécom).

## Migration
`SCHEMA_VERSION = 2026-10-28.2` : uniquement des `ADD COLUMN IF NOT EXISTS` et des index. Aucune donnée existante n'est modifiée.

## Limites connues
- La compilation complète (`npm run build`) n'a pas pu être exécutée ici (pas d'accès réseau pour installer les dépendances) : seul un contrôle syntaxique TypeScript a été fait. Lancer `npm install && npm run build` puis tester avant la production.
- « Infalsifiable » au sens strict exige une signature côté serveur : l'application est 100 % locale/hors ligne, donc la vérification détecte les modifications, mais ne peut pas être inviolable face à quelqu'un qui contrôle la base du navigateur.
