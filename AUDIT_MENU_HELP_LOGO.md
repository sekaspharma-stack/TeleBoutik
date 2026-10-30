# Audit des menus, HelpInfo et logo de boutique

## Changements de cette version
- `src/pages/SettingsPage.tsx` : ajout d'un bloc « Logo de la boutique » dans l'onglet Boutique. L'utilisateur autorisé peut choisir une image, la redimensionner côté navigateur à 512 px maximum, enregistrer ou retirer le logo.
- `src/components/AppLayout.tsx` : lecture du logo depuis la table locale `settings` (clé `store_logo_data_url`), affichage dans l'en-tête mobile et l'en-tête du menu latéral. Un événement local met l'aperçu à jour après sauvegarde.
- Le bouton qui contient le logo et le nom TeleBoutik appelle `window.location.reload()` pour actualiser l'application, aussi bien dans l'en-tête mobile que dans le menu latéral.
- `src/components/HelpInfo.tsx` : aide Paramètres mise à jour pour expliquer le logo et l'actualisation; aide Gestion avancée ajoutée et conseil Clients précisé.

## Persistance et limites
Le logo est stocké comme data URL dans la table locale `settings`, pas dans le schéma `stores`. Il persiste dans la base locale de l'appareil et apparaît immédiatement sur cet appareil. La réplication de cette image entre appareils n'est pas garantie par le mécanisme de synchronisation actuel; pour un logo partagé multi-appareils, il faudra le stocker dans Firebase Storage et synchroniser une URL, plutôt que d'envoyer les octets de l'image dans Firestore.

## Audit HelpInfo
Le composant est monté globalement par `AppLayout`, et sélectionne le texte à partir de `useLocation().pathname`. Les routes principales connues dans `App.tsx` sont couvertes par les entrées existantes, avec ajout de `/operations`. Les pages `FirstRunSetup` et `LoginPage` ne sont pas rendues dans `AppLayout`, donc ne nécessitent pas de HelpInfo dans ce composant.

## Dépendances
Aucune nouvelle dépendance npm n'a été ajoutée. L'upload, la réduction d'image et l'aperçu utilisent les API navigateur (`FileReader`, `Image`, `canvas`). Les icônes sont déjà fournies par `lucide-react`.

## Vérifications réalisées
- Archive source d'entrée extraite sans erreur.
- Revue des routes de `App.tsx`, du composant global `HelpInfo`, de `SettingsPage`, de `AppLayout`, de la table `settings` et de `AuthContext`.
- Contrôle manuel des changements et des imports.
- `npm ci --ignore-scripts --no-audit --no-fund` a dépassé le délai disponible et n'a pas fini; les commandes `npm run lint` et `npm run build` ne peuvent donc pas être certifiées dans cet environnement.
- Aucun test sur navigateur/mobile de production n'a été effectué.
