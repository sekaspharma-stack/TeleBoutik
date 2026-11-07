# Facture sur demi-feuille A4 + reçus pour les services

## Ajouts
- `printReceiptA4Half` (src/lib/receiptPrinter.ts) : facture 210 x 148,5 mm en haut d'une feuille A4, même contenu que le ticket thermique, trait pointillé de découpe.
- `ServiceReceiptModal` + `lib/serviceReceipt.ts` : reçu réutilisable avec Thermique Bluetooth, **Facture ½ A4**, Impression système / PDF, Partage.
- Unités & Megas : reçu après chaque vente + bouton « Reçu » dans l'historique.
- Shop Airtel Money (dépôt / retrait) : idem.
- Cartes SIM : reçu après vente à l'unité ou en carton, bouton « Reçu » sur les SIM vendues, liste des 20 dernières ventes en vrac.
- Caisse (POS / Ventes) : bouton « Facture ½ A4 » dans le ticket existant.

## Notes
- Aucune écriture en base : l'impression ne peut ni modifier ni dupliquer une vente.
- Dans la boîte d'impression, choisir le papier A4, échelle 100 %.
- Vérification faite : syntaxe TS/TSX (0 erreur). Build complet et test d'impression réelle à faire sur ta machine (`npm ci && npm run build`).
