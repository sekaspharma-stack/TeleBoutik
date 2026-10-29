# Module Airtel Money — checkpoint technique

Cette étape ajoute uniquement le premier module opérationnel Cash In / Cash Out.

## Fonctions présentes
- Écran Shop Airtel Money accessible aux rôles propriétaire, gérant et vendeur.
- Dépôt et retrait en USD ou CDF.
- Référence de transaction obligatoire et unique.
- Contrôle du solde e-float avant un dépôt et du cash avant un retrait, à partir de la session de caisse active de l'agent.
- Enregistrement atomique de la transaction et des deux mouvements cash/e-float.
- Historique de l'agent, et historique de la cabine pour propriétaire/gérant.
- Annulation propriétaire/gérant avec motif et écritures inverses; l'opération initiale n'est pas supprimée.
- Audit et synchronisation Firebase pour les nouvelles écritures.
- La commission est conservée sur la transaction mais n'altère pas automatiquement le cash ou l'e-float.

## Validation
- Contrôle de syntaxe TypeScript/TSX par transpilation locale : aucune erreur syntaxique détectée.
- Intégrité du ZIP : à vérifier après packaging.
- Compilation complète `npm run build` : non validée dans l'environnement de préparation, car l'installation des dépendances a expiré et le cache npm ne contient pas tous les paquets. Ne pas considérer ce checkpoint comme une version de production avant une compilation complète.

## Périmètre non traité dans cette étape
La gestion complète multi-cabines/agents, le catalogue d'unités/Megas/SIM, les approvisionnements, les commissions détaillées et les rapports avancés restent pour les étapes suivantes. Aucun de ces modules n'est présenté comme terminé.
