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

# Correctif Caisse (ouverture / clôture / fonds)
- La page Caisse n'est plus rechargée de force à chaque synchronisation (App.tsx) : la fenêtre de clôture ne se ferme plus pendant la saisie. La page se met à jour toute seule, sans fermer les fenêtres.
- Clôture par devise : espèces USD et CDF comptées séparément (plus de CDF bloqué quand le taux n'est pas configuré), écart par devise, Airtel Money en contrôle facultatif.
- Le propriétaire / gérant peut clôturer la caisse d'un vendeur depuis « Caisses ouvertes par l'équipe » ; un vendeur ne peut clôturer que la sienne.
- « Solde théorique » affiché par devise (ex. 100 $ + 100 000 CDF) au lieu de 100 USD seulement.
- Historique : Fond, Théorique, Compté et Écart par devise, y compris pour une session encore ouverte.
- Nouvelle colonne `cash_sessions.closing_detail` (migration automatique, synchronisée).

# Correctif Caisse — taux USD/CDF
- La Caisse lit maintenant les taux de Paramètres → Finance (taux de vente, ex. 2300 ; à défaut taux d'échange, ex. 2250), en premier et indépendamment des autres requêtes.
- USD et CDF restent séparés partout (carte théorique, clôture, historique) ; le CDF est converti en USD au taux, avec le « Total ≈ USD ».
- Ouverture de caisse / mouvement en CDF : le taux est relu au moment de l'opération ; s'il est introuvable, l'opération est refusée au lieu d'enregistrer un montant faux.
- Historique : la clôture utilise le taux du jour de la clôture.

# Correctif Caisse — total général en USD
- La carte « Total disponible (Espèces + Airtel Money) » affiche maintenant, en plus de USD et CDF séparés, une ligne « TOTAL GÉNÉRAL EN USD » = USD + CDF converti au taux (2300 par défaut), avec le montant converti et le taux utilisé.
- Même ligne sur les cartes « Caisses ouvertes par l'équipe » (propriétaire / gérant).
- Si le taux est introuvable, un message l'indique au lieu d'un faux total.
