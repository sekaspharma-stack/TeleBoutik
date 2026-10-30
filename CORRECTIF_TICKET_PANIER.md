# Correctifs ticket + panier (points 10 et 11)

## TicketModal.tsx
- Nouvel état `ready` : activé seulement quand vente, lignes, paiements, vendeur, client, logo, RCCM et vérification du sceau sont chargés. Rien ne s'affiche avant.
- Réinitialisation complète des états à chaque changement de `saleId` (le client de la vente précédente ne persiste plus).
- Boutons Thermique / Système / Partage / WhatsApp désactivés tant que `ready` est faux ; `handlePrint` refuse aussi d'imprimer.
- Erreur de chargement ou vente introuvable : message avec bouton Fermer (au lieu d'un écran vide).

## CartContext.tsx
- `updateQuantity`, `updatePrice`, `updateItemDiscount`, `setGlobalDiscount` : valeur non finie (NaN, Infinity) ignorée via `Number.isFinite`.
- Remise de ligne plafonnée à prix x quantité ; remise globale plafonnée au sous-total ; plafonds recalculés à chaque modification du panier (quantité, prix, suppression, prix de gros).
- `addItem` renvoie maintenant `{ ok, message }`. Doublon d'article sérialisé : refus avec message explicite.

## POSPage.tsx
- Les 5 appels à `addItem` utilisent `added.ok` / `added.message` pour afficher l'erreur.
