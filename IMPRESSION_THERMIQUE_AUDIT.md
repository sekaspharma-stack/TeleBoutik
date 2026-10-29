# Audit et impression des reçus TeleBoutik — V3

## Audit du code source existant

- `src/components/TicketModal.tsx` est le point d'entrée unique du reçu, utilisé après une vente et depuis l'historique des ventes / l'archive IMEI.
- La vente est rechargée par `saleId` via `getSaleById`; les lignes viennent de `sale_lines`, l'IMEI affiché est lu depuis `imei_units`, les paiements via `getSalePayments`, le vendeur depuis `users` et le client depuis `customers`.
- Le DOM `#ticket-print` est la source d'affichage commune. Il comprend boutique et coordonnées, ticket et référence, date, vendeur/client, taux, lignes/quantités/prix, IMEI, sous-total, remise, TVA, total, équivalent CDF, moyens de paiement, monnaie rendue et pied de reçu.
- Les informations de boutique (notamment largeur du ticket 58/80 mm) viennent du contexte `AuthContext` et des paramètres de la boutique.
- Les données du reçu sont lues après l'enregistrement de la vente. Les fonctions d'impression ne modifient pas la base et n'annulent pas une vente en cas d'échec.

## Méthodes d'impression

1. **Thermique directe** (`src/lib/receiptPrinter.ts`) : pont natif `window.teleboutikPrinter.printRawBytes` avec payload ESC/POS Base64, ou `printText`; à défaut, Web Bluetooth dans un contexte sécurisé, pour les appareils BLE exposant le Nordic UART Service attendu. Les écritures BLE sont envoyées en petits blocs de 20 octets. Aucun basculement automatique vers une autre méthode n'est fait après un envoi partiel, afin d'éviter les doubles reçus.
2. **Impression système / PDF** : copie du même élément `#ticket-print` dans une fenêtre d'impression indépendante, styles noir et blanc, largeur 58/80 mm, puis `window.print()`.
3. **Partage natif** : lorsque `navigator.share` est disponible, le texte complet du reçu (dont la référence) peut être transmis à la feuille de partage native. Cela partage le texte, pas un fichier PDF. Le bouton WhatsApp existant reste disponible pour le résumé et la référence.

## Prévention des erreurs et doublons

- Un verrou synchrone `useRef` bloque les doubles clics pendant l'impression.
- Les boutons sont désactivés pendant l'opération.
- Une erreur d'impression est affichée dans le reçu; aucune écriture de vente n'est exécutée par ces fonctions.
- Une réponse explicite `false` ou `{ success: false }` du pont natif est traitée comme un échec.
- Aucun repli automatique après l'envoi thermique : après un échec de Bluetooth, vérifier l'imprimante avant de retenter avec une autre méthode.

## Limites de compatibilité

- Web Bluetooth exige HTTPS / contexte sécurisé et un navigateur compatible. Il ne pilote pas toutes les imprimantes BLE.
- Les imprimantes classiques Bluetooth SPP, y compris plusieurs imprimantes de poche, exigent un pont natif Android/iOS qui implémente `window.teleboutikPrinter`. Ce pont natif n'est pas inclus dans ce dépôt React/Vite.
- Les commandes ESC/POS sont génériques. La translittération ASCII simplifie les accents; l'encodage/codepage, le coupe-papier et la largeur réelle doivent être vérifiés sur le modèle d'imprimante.
- Le navigateur ne peut pas confirmer qu'un ticket est physiquement sorti du matériel.
- Le partage natif partage le texte du reçu, pas un PDF joint. Pour obtenir un PDF, choisir l'impression système puis « Enregistrer en PDF » si le système le propose.

## Tests effectués dans cet environnement

- Inspection du flux de données et des composants d'impression.
- Mise à jour de l'aide contextuelle pour Point de vente, Ventes et Paramètres.
- Tentative de `npm run lint` : échec environnemental parce que les définitions de types de `node_modules` étaient incomplètes (`TS2688`, plusieurs types manquants).
- Tentative de `npm ci --offline` : impossible, car un paquet (`zustand`) n'était pas disponible dans le cache npm. Le réseau / l'installation des dépendances n'a donc pas permis d'exécuter le build TypeScript/Vite.
- Aucun test matériel sur imprimante physique, Bluetooth, Android ou iOS n'a été effectué.

## Procédure de validation avant production

1. `npm ci`
2. `npm run lint`
3. `npm run build`
4. Sur le matériel cible : imprimer un ticket 58 mm et 80 mm si les deux largeurs sont utilisées; vérifier IMEI, accents, colonnes, montants et référence.
5. Débrancher l'imprimante pendant une impression : vérifier le message d'erreur et confirmer que la vente existe toujours.
6. Double-cliquer sur chaque bouton d'impression : un seul lancement doit être effectué.
7. Tester séparément Bluetooth BLE compatible, pont natif SPP si utilisé, impression système et partage natif.


## Logo de boutique sur le reçu (V6)
- Le reçu partagé visuellement inclut le logo stocké dans `settings.store_logo_data_url`.
- La voie HTML/PDF clone le reçu avec son image.
- La voie ESC/POS native envoie une image monochrome raster (GS v 0) avant le texte lorsque le logo est une data URL et que le pont prend en charge `printRawBytes`.
- Les ponts qui n’exposent que `printText` ne peuvent pas imprimer de bitmap : ils impriment le texte uniquement. Le matériel réel doit être testé, car le support raster ESC/POS varie selon les imprimantes.
- Le logo est stocké localement dans la base de l’appareil à ce stade.
