# Correctifs sécurité : PIN, journal d'audit, SQL

## 1. Connexion et PIN
- **Connexion en deux temps** : choix du compte, puis PIN à 4 chiffres (`LoginPage.tsx`). Le PIN n'est plus testé sur tous les comptes : deux personnes ayant le même PIN ne peuvent plus se retrouver sous le mauvais compte.
- **PBKDF2-SHA256 avec sel aléatoire** (210 000 itérations) au lieu de SHA-256 sans sel (`lib/pin.ts`). Format : `pbkdf2-sha256$itérations$sel$empreinte`. Comparaison en temps constant.
- **Blocage après 5 essais** (`db/pinGuard.ts`) : 15 min, puis 30 min, 1 h… jusqu'à 24 h en cas de blocages répétés. Compteur remis à zéro après une connexion réussie. Stocké dans `app_meta` (local, non synchronisé), il survit au rechargement de la page. Les échecs et blocages sont écrits dans le journal d'audit.
- **Déblocage manuel** : bouton « Débloquer » dans Réglages → Utilisateurs.
- **Validations gérant/propriétaire** (`db/operations.ts`) : elles utilisent le même blocage (compteur commun). Sans cela, on pouvait deviner un PIN de gérant depuis la fenêtre de validation.
- **Migration** :
  - PIN en clair : convertis au démarrage et avant chaque vérification (y compris pour un compte récupéré du cloud). Un PIN en clair n'est plus accepté par `verifyPin`.
  - `sha256:` et `legacy:` : acceptés une dernière fois, puis remplacés par PBKDF2 à la prochaine connexion réussie.
- L'empreinte du PIN n'est plus gardée en mémoire dans la session, ni écrite dans le journal d'audit (activation/désactivation d'un utilisateur).

**Important** : mettre à jour tous les appareils ensemble. Une ancienne version de l'application ne sait pas lire le format PBKDF2.

## 2. Journal d'audit chaîné
- `hash = SHA-256(prev_hash + contenu)` (id, utilisateur, rôle, entité, action, avant, après, date), 64 caractères hexadécimaux (`db/audit.ts`).
- Connexions et déconnexions passent par la même fonction `addAuditLog` (elles avaient un `prev_hash` vide et un hash 32 bits).
- La lecture du dernier maillon et l'insertion se font dans une même transaction.
- Le JSON `avant/après` est normalisé (clés triées) avant hachage : le cloud peut réordonner les clés sans fausser la vérification.
- Nouveau bouton **« Vérifier l'intégrité »** dans Piste d'Audit : signale les entrées modifiées et les liens rompus. Les anciennes entrées (hash 32 bits) sont comptées comme « non vérifiables ».

## 3. SQL
`db/saleService.ts` : le numéro de ticket est maintenant un paramètre (`$n`) et non plus injecté dans le texte SQL. Deux requêtes concernées : mouvement de stock (« Vente ticket … ») et encaissement (« Encaissement vente … »).

## Limites connues
- Un PIN à 4 chiffres reste faible face à quelqu'un qui copie la base locale ou Firestore : PBKDF2 ralentit l'attaque, il ne l'empêche pas. Le blocage ne protège que contre les essais via l'application. Pour aller plus loin : restreindre les règles Firestore et ne pas synchroniser `users.pin`.
- Le blocage s'appuie sur l'horloge de l'appareil.
- La chaîne SHA-256 détecte une modification ou une suppression isolée, mais quelqu'un qui peut écrire dans la base et recalculer toute la chaîne n'est pas détecté sans ancrage externe (par exemple l'export CSV conservé ailleurs).
