# Modifications ZIP 2 — Verrou de transactions et écritures comptables

Ce zip contient aussi les corrections du ZIP 1 (voir `MODIFICATIONS_ZIP1_CAISSE.md`). Le ticket de caisse et le champ RCCM ne sont pas touchés.

## Fichiers modifiés (par rapport au ZIP 1)

| Fichier | Nature |
|---|---|
| `src/db/localDb.ts` | Verrou de transactions, `withLocalTransaction`, `getDb()` protégé |
| `src/db/audit.ts` | `addAuditLog` / `addSyncOp` acceptent la transaction en cours (`tx`) |
| `src/db/saleService.ts` | Utilise `withLocalTransaction` ; nouvelles écritures comptables |
| `src/pages/StockPage.tsx` | Les deux créations/modifications de produit passent par `withLocalTransaction` |

## 3. Verrou de transactions locales (`localDb.ts`)

**Le problème.** PGlite n'a qu'une seule connexion. Entre `BEGIN` et `COMMIT`, toute autre écriture (synchronisation cloud, autre page, journal d'audit) passait dans la même transaction. Elle était donc validée ou annulée avec elle. La synchronisation utilise aussi `db.transaction()`, qui émettait un `BEGIN` imbriqué : son `COMMIT` validait trop tôt la transaction de la vente.

**Pourquoi le verrou est dans `getDb()` et pas seulement dans `beginLocalTransaction`.** Les pages Airtel Money et Telecom ouvrent leurs transactions avec `db.exec('BEGIN')`, et la synchronisation avec `db.transaction()`. Aucune ne passe par `beginLocalTransaction`. Un verrou limité à cette fonction ne les aurait pas protégées. Chaque appel à `getDb()` renvoie maintenant un accès avec son propre état, et ces pages sont couvertes sans être modifiées.

**Règles du verrou :**
- Un `BEGIN` (ou `db.transaction`) prend le verrou : un seul propriétaire à la fois, en file d'attente (FIFO).
- Tant qu'un accès possède le verrou, les requêtes des autres accès attendent la fin du `COMMIT` ou du `ROLLBACK`. Elles ne sont ni incluses ni annulées.
- Un `BEGIN` attend aussi que les requêtes déjà parties des autres accès soient terminées.
- `COMMIT` et `ROLLBACK` envoyés par un accès qui ne possède pas de transaction sont ignorés (avec un avertissement en console). Ils toucheraient la transaction d'un autre.
- Un `BEGIN` imbriqué sur le même accès est refusé avec une erreur explicite.
- **Anti-blocage :**
  - une transaction manuelle gardée plus de 60 s est annulée de force ;
  - une requête qui attend plus de 30 s derrière elle échoue avec « Base locale occupée… » ;
  - les transactions natives de la synchronisation, qui peuvent être longues, ne sont ni forcées ni limitées dans le temps.
- La mise en file de la synchronisation cloud est différée jusqu'au `COMMIT` et abandonnée en cas de `ROLLBACK`. Ce comportement existait déjà et est conservé, désormais par transaction.

**Nouvelle API `withLocalTransaction(async (tx) => { … })`.**
- Elle fait le `BEGIN`, le `COMMIT` en cas de succès, le `ROLLBACK` en cas d'erreur, et relâche toujours le verrou.
- Dans le callback, il faut utiliser `tx.query`, `tx.queryOne` et `tx.execute`. Les `query` et `execute` globaux attendraient la fin de la transaction.
- `addAuditLog(..., tx)` et `addSyncOp(..., tx)` reçoivent `tx` en dernier paramètre.

**Appelants migrés :** `completeSale`, `cancelSale`, et les deux transactions de `StockPage` (création de produit, modification de produit).

**API historique conservée :** `beginLocalTransaction`, `commitLocalTransaction` et `rollbackLocalTransaction` fonctionnent toujours et prennent le même verrou. Limite : les requêtes globales émises par un autre traitement pendant la transaction ne peuvent pas y être distinguées. Pour une isolation complète, il faut utiliser `withLocalTransaction`. Plus aucun fichier du projet n'utilise l'API historique.

**À savoir.** Les lectures des autres traitements attendent aussi pendant une transaction. L'attente est de l'ordre de quelques dizaines de millisecondes, soit la durée d'une vente. Une requête globale lancée par erreur dans un `withLocalTransaction` échoue au bout de 30 s au lieu de bloquer.

## 4. Écritures comptables (`saleService.ts`)

**À la vente.** Le total est réparti entre trois débits, tous crédités sur `Ventes`. La somme des trois égale toujours le total, et chaque ligne nulle est omise :

| Débit | Montant |
|---|---|
| `Caisse` | la part réellement encaissée (total − crédit − bon) |
| `Clients` | la part payée à crédit |
| `Bons clients` | la part payée par bon |

- Une vente 100 % espèces donne la même écriture qu'avant (`Caisse` / `Ventes`).
- **Choix à valider :** le compte `Bons clients` est nouveau. Tu n'avais précisé de compte que pour le crédit (`Clients`). Pour changer le nom, modifier la constante `ACCOUNT_VOUCHERS`.
- Les écritures de coût (`COGS` / `Stock`) sont inchangées.

**À l'annulation.**
- Chaque écriture de vente d'origine est inversée (`Ventes` au débit, le compte d'origine au crédit). Annuler une vente à crédit ne crédite donc jamais la `Caisse`.
- Si aucune écriture d'origine n'est retrouvée, la répartition est reconstituée à partir des paiements de la vente.
- Les anciennes ventes dont l'écriture d'origine débitait `Caisse` pour tout le total sont inversées à l'identique. Les livres restent cohérents entre eux, et aucune correction rétroactive n'est faite.
- **Ajout non demandé :** l'écriture `Stock` / `COGS` est maintenant contre-passée. Avant, le stock revenait en rayon mais le coût des marchandises vendues restait comptabilisé.

## Vérification effectuée

- La couche base (`localDb.ts`, `audit.ts`, `saleService.ts`) compile sans erreur de type, avec une déclaration minimale de PGlite (les paquets npm étaient inaccessibles).
- Le verrou a été testé en exécution réelle contre un faux PGlite à connexion unique :
  - une écriture externe pendant une transaction survit au `ROLLBACK` de l'autre ;
  - deux transactions concurrentes, dont une échoue, ne se mélangent pas ;
  - `db.transaction` de la synchronisation et un `BEGIN` manuel n'entrent plus en collision ;
  - le `ROLLBACK` d'un tiers est ignoré ;
  - l'API historique prend bien le verrou ;
  - le verrou est relâché après une erreur.
- La répartition `Caisse` / `Clients` / `Bons clients` a été vérifiée sur plusieurs cas (espèces, crédit partiel, bon + crédit + espèces, crédit supérieur au total).
- **Non fait :** `npm run build` complet et tests avec le vrai PGlite dans le navigateur. À vérifier chez toi :
  - vente puis annulation en espèces ;
  - vente à crédit (écriture `Clients`) puis annulation ;
  - vente avec bon ;
  - création de produit pendant une synchronisation ;
  - opération Airtel / Telecom pendant une vente.
