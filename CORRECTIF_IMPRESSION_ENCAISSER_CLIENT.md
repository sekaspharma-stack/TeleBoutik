# Correctifs : impression thermique, bouton Encaisser, aperçu client

## 1. Impression thermique lente (src/lib/receiptPrinter.ts)
- Logo limité à 100 px de haut (avant 160) : environ 4 Ko au lieu de 7 Ko.
- Envoi Bluetooth par paquets de 180 octets (au lieu de 20), avec repli automatique 100 puis 20 octets
  si l'imprimante refuse. Pause de 8 ms seulement en écriture sans réponse, 0 ms sinon (avant 35 ms fixes).
  Le MTU est négocié automatiquement par Chrome/Android.

## 2. Le rouleau continue de sortir après l'impression
- Suppression des 3 lignes vides finales et de la commande GS V (coupe/avance) qui faisait défiler le papier.
- Une seule avance calibrée en fin de ticket : ESC J 56 (56 points, environ 7 mm), puis plus rien n'est envoyé.
  Pour ajuster la longueur : constante FEED_END_DOTS dans receiptPrinter.ts (8 points = 1 mm).
- Attente de 600 ms avant de fermer la liaison, pour que l'imprimante termine la dernière ligne.

## 3. Bouton « Encaisser » qui ne réagit pas (src/pages/POSPage.tsx)
- Cause : le message d'erreur (ex. « ouvre une session de caisse ») s'affichait en haut de l'écran, hors de
  vue sur téléphone, donc le bouton semblait mort. Même problème pour les erreurs de vente, cachées derrière
  la fenêtre d'encaissement.
- Maintenant : message d'erreur affiché juste au-dessus du bouton, avec un bouton « Ouvrir la caisse »
  si aucune caisse n'est ouverte ; erreurs de vente affichées dans la fenêtre d'encaissement ;
  bouton « Vérification… » pendant le contrôle ; l'identifiant de caisse vérifié est réutilisé pour la vente
  (plus de cashSession! périmé).

## 4. Aperçu du client dans le panier (POSPage.tsx, CartContext.tsx)
- Carte client dans le panier : nom, téléphone, solde dû, boutons Changer / Retirer.
- Le sélecteur propose directement les clients récents, recherche par nom ou téléphone (espaces ignorés),
  liste défilante, message « Aucun client trouvé ».
- CartContext : nouveaux champs customerPhone, customerBalance, customerCreditLimit (remis à zéro par clear()).
