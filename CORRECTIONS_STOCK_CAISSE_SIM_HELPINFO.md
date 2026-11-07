# Corrections TeleBoutik — stock télécom, SIM, caisse et HelpInfo

## Logique appliquée

### Unités et Megas
- Ajout d'un inventaire séparé `telecom_stock`, par boutique et type de service (`units` ou `data_bundle`).
- Le bouton « Définir le stock initial unités / Megas » demande un stock en nombre entier d'unités. Il ne crée plus un mouvement Airtel Money.
- Les unités et les Megas sont vendus par quantité entière. La quantité diminue du stock correspondant.
- Le coût d'achat et le prix payé par le client restent des montants monétaires distincts. Le prix reçu crée une entrée de caisse selon la devise et le mode de paiement choisis; le coût est utilisé pour calculer la marge, mais ne débite pas le solde e-float.
- L'annulation crée une écriture de caisse inverse et remet la quantité au stock. La quantité possède sa propre colonne afin que les anciennes ventes ne soient pas interprétées comme des quantités à partir de `face_value`.
- Les changements de stock, ventes et mouvements sont ajoutés à la file de synchronisation persistante.

### Cartes SIM
- Le stock individuel existant reste disponible pour les cartes dont le numéro/ICCID est suivi individuellement.
- Ajout d'un inventaire en vrac avec un nombre de cartes, un coût par carte et un prix de vente par carte.
- Un lot en vrac peut être vendu à l'unité ou par carton de 250 cartes. Une vente par carton retire 250 cartes et crée un mouvement de caisse positif pour le montant encaissé.
- Les ventes de lots sont conservées dans `sim_batch_sales`, synchronisées vers Firestore et intégrées aux totaux du rapport SIM.

### Caisse et clôture
- Le total général est affiché en équivalent USD : `USD + CDF / taux CDF par USD`.
- Le taux USD/CDF doit être configuré. Sans taux, l'application affiche les devises non converties au lieu d'inventer un équivalent.
- Le solde théorique de clôture représente l'argent physique (espèces) restant d'après les mouvements. Le solde e-float Airtel est distinct et n'est pas inclus dans le comptage physique.
- La clôture permet de saisir séparément l'argent compté en USD et en CDF et compare leur équivalent USD au solde théorique.
- L'ouverture, les mouvements manuels et la clôture de session ajoutent leurs enregistrements à la file persistante de synchronisation.

### HelpInfo
- Ajout d'un panneau bleu dépliable en haut de chaque page protégée via `AppLayout`.
- Chaque route connue possède une aide sur l'usage, les dépendances et les astuces. Cela évite de recopier le même composant dans chaque page et garantit sa présence dans les modules de l'application.

## Vérifications effectuées
- Transpilation syntaxique TypeScript/TSX de 33 fichiers : zéro diagnostic de syntaxe.
- Contrôle statique des tables, des migrations additives, des mappings Firestore et de l'inclusion dans la réinitialisation des données de test.
- Archive vérifiée avec `unzip -t`.

## Limites et tests encore nécessaires
- La compilation complète (`tsc -b && vite build`) n'a pas été validée dans cet environnement, car les dépendances locales du projet ne sont pas installées.
- Aucun test navigateur, PGlite/IndexedDB réel, Firebase réel ou Netlify n'a été exécuté.
- Il faut tester sur un déploiement de préproduction : définir 10 000 unités, vendre 5 000, vérifier stock restant 5 000 et entrée de caisse correspondant exactement au prix reçu; faire la même chose pour les Megas; annuler une vente et vérifier la restauration; ajouter 500 SIM, vendre une SIM puis un carton, vérifier que le stock baisse de 251; tester USD/CDF avec un taux configuré; passer hors ligne puis reconnecter et vérifier la synchronisation sans doublons.
- Les ventes de cartons SIM sont ajoutées comme une nouvelle méthode de suivi du stock en vrac. Les SIM déjà enregistrées individuellement restent gérées par l'ancien inventaire individuel; ne pas enregistrer deux fois le même lot dans les deux inventaires.
