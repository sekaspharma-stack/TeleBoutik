# Modifications ZIP 1 — Caisse et ventes

Périmètre : points 1 et 2 de la demande. Le ticket de caisse et le champ RCCM ne sont pas touchés.
Les points 3 (verrou de transactions, `localDb.ts`) et 4 (écritures comptables) sont dans le ZIP 2.

## Fichiers modifiés

| Fichier | Nature |
|---|---|
| `src/db/saleService.ts` | `completeSale` et `cancelSale` (corrections principales) |
| `src/pages/POSPage.tsx` | Transmet l'id d'autorisation de remise au service ; pourcentage de remise calculé sur le brut |
| `src/pages/SalesPage.tsx` | Affiche les avertissements renvoyés par `cancelSale` |

## 1. `cancelSale`

- **Remboursement = paiement − monnaie rendue.** La monnaie rendue à la vente est déjà sortie de la caisse (mouvement `sale_change`). Elle est donc déduite des paiements en espèces avant de créer la sortie. La valeur lue est celle du mouvement de caisse réel ; à défaut, celle enregistrée sur la vente. Si la monnaie absorbe tout un paiement, aucun mouvement n'est créé pour lui.
- **Devise et taux recopiés.** Chaque mouvement de remboursement reçoit `currency_code`, `original_amount` et `applied_rate` du paiement d'origine. `original_amount` est ramené proportionnellement au montant net remboursé.
- **Session ouverte obligatoire.** Le remboursement est enregistré dans une session ouverte du même magasin, choisie dans cet ordre :
  1. la session d'origine si elle est encore ouverte ;
  2. sinon la caisse ouverte de la personne qui annule ;
  3. sinon l'unique caisse ouverte du magasin.
- **Refus** si aucune session n'est ouverte, ou si plusieurs sont ouvertes sans que l'utilisateur ait la sienne. Le contrôle a lieu avant toute écriture.
- **Session d'origine clôturée : l'annulation est signalée, pas bloquée.** Le remboursement va dans la session ouverte en cours. Le signalement apparaît : dans le message affiché à l'utilisateur, dans le motif du mouvement de caisse et dans le journal d'audit. Pour refuser plutôt que signaler, il faut remplacer le `warnings.push(...)` de `planCashRefund` par un `throw new Error(...)`.
- Les paiements `credit` et `voucher` ne touchent pas la caisse : pas de sortie de caisse pour eux. Une vente entièrement à crédit s'annule donc même sans session ouverte.
- `cancelSale` renvoie maintenant `{ refundSessionId, warnings }` au lieu de `void`. Les appels existants qui ignorent le retour continuent de fonctionner.

## 2. `completeSale` : contrôles côté service

Tous les contrôles sont dans le service. Une erreur annule toute la transaction.

- **Paiements.**
  - La somme doit couvrir le total recalculé (tolérance 0,01).
  - Le mode de paiement doit être connu, et chaque montant strictement positif.
  - Un paiement `credit` exige un client (sinon la dette n'était enregistrée nulle part).
  - La monnaie rendue exige un paiement en espèces et ne peut pas dépasser les espèces encaissées.
- **Remise maximale.** Le pourcentage est calculé sur le montant brut (prix × quantité, avant remises), remises de ligne et remise globale cumulées. La limite est celle du rôle (propriétaire 100 %, gérant `max_manager_discount`, vendeur `max_seller_discount`), lue en base et non dans l'état de l'interface.
- **Remise au-delà de la limite.** Elle n'est acceptée qu'avec une autorisation `sale_discount` valide, créée par `approveSensitiveAction` :
  - magasin et demandeur identiques à ceux de la vente ;
  - approbateur propriétaire ou gérant actif, différent du vendeur ;
  - pourcentage dans la limite de l'approbateur ;
  - **usage unique** : l'autorisation est rattachée à la vente (`target_id`).
- **Remise de ligne.** Elle ne peut pas dépasser le montant de la ligne. La remise globale ne peut pas dépasser le sous-total.
- **Stock.** Pour les articles non sérialisés, le stock disponible (entrées − sorties) doit couvrir la quantité demandée, cumulée si l'article est sur plusieurs lignes.
- **Totaux recalculés** par `priceSale` : lignes, `subtotal`, taxe (selon la configuration du magasin) et `total`. Les valeurs du panier sont ignorées (un `console.warn` signale un écart). Ce sont les valeurs du service qui sont stockées, scellées sur le ticket et utilisées dans l'écriture comptable.
- **Contrôles ajoutés en cohérence :**
  - quantité entière positive ;
  - article existant ;
  - article sérialisé : IMEI obligatoire et quantité 1 ;
  - IMEI appartenant bien à l'article ;
  - pas deux fois le même IMEI dans un panier ;
  - session de caisse ouverte et du bon magasin ;
  - utilisateur actif.

## Impact sur l'interface (`POSPage.tsx`, `SalesPage.tsx`)

- `POSPage` conserve le flux « PIN du gérant » et transmet maintenant `discount_approval_id` au service. Sans lui, le service refuserait toute remise au-delà de la limite du vendeur.
- Le pourcentage de remise est calculé sur le brut, comme dans le service. Avant, il était calculé sur le net, donc sous-estimé.
- `SalesPage` affiche les avertissements d'annulation.
- `CompleteSaleInput.subtotal`, `tax_amount` et `total` deviennent facultatifs et sont ignorés.

## Vérification effectuée

- `saleService.ts` compile sans erreur de type avec TypeScript.
- Le calcul des totaux a été testé à part (remises de ligne et globale, taxe 16 %).
- **Non fait :** `npm run build` complet et test en base PGlite. L'installation des dépendances a échoué dans l'environnement de préparation (réseau). Lance `npm install && npm run build`, puis les scénarios suivants :
  - vente espèces avec monnaie rendue, puis annulation ;
  - vente avec remise au-delà de la limite, avec et sans PIN gérant ;
  - vente à crédit sans client ;
  - quantité supérieure au stock ;
  - annulation sans caisse ouverte ;
  - annulation après clôture de la caisse d'origine.

## Reste pour le ZIP 2

- Verrou (mutex) autour de `beginLocalTransaction` / `commit` / `rollback` dans `localDb.ts`.
- Écritures comptables : « Clients » au lieu de « Caisse » pour la part à crédit ou par bon, et écriture d'annulation correspondante. Les écritures actuelles (`Caisse`/`Ventes` à la vente, `Ventes`/`Caisse` à l'annulation) n'ont volontairement pas été modifiées ici.
