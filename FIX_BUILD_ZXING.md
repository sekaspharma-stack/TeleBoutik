# Correction du build du scanner ZXing

Le build Vite échouait parce que `@zxing/library@0.21.3` importe `ts-custom-error` sans que ce paquet soit déclaré dans ses dépendances publiées.

Correction appliquée : ajout explicite de `ts-custom-error@^3.3.1` dans `dependencies` et dans `package-lock.json`. Le build CI doit installer cette dépendance avec `npm ci`.

Après extraction, poussez les fichiers `package.json` et `package-lock.json` (ainsi que ce fichier de note si souhaité) vers GitHub, puis relancez le workflow. La compilation complète n'a pas pu être exécutée ici, car l'installation npm a dépassé le délai disponible ; le correctif cible directement l'import manquant signalé par Rollup.
