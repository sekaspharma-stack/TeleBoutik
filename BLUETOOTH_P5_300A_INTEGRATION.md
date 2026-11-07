# Intégration Bluetooth thermique — TeleBoutik

## Ce qui a été adapté
- Le service d'impression conserve son chemin natif `window.teleboutikPrinter` et l'impression système/PDF.
- Le sélecteur Web Bluetooth permet maintenant de choisir explicitement le périphérique Android, y compris un appareil nommé P5_300A.
- Après sélection, le code teste les UUID candidats déjà décrits dans les informations de référence : Nordic UART (déjà utilisé auparavant par TeleBoutik), FFE0, FF00 et 18F0.
- Il recherche une caractéristique d'écriture et privilégie la propriété annoncée par le périphérique (`writeWithoutResponse` ou `write`).
- Les données sont envoyées en blocs prudents de 20 octets, avec une pause de 35 ms entre les blocs et 250 ms à la fin.
- Les ventes et leurs montants ne sont pas modifiés par le service d'impression. Une erreur Bluetooth n'annule pas une vente enregistrée.

## Limite importante
Le ZIP AquaFlow n'a pas été fourni dans l'environnement de travail. Cette adaptation suit les détails techniques fournis dans le prompt, mais elle ne constitue pas une comparaison directe avec le code source AquaFlow. Les UUID sont des candidats, pas des UUID confirmés de la P5_300A. La compatibilité matérielle et l'impression réelle doivent être testées sur le téléphone et l'imprimante.

## Utilisation / diagnostic
1. Ouvrir un reçu déjà enregistré dans TeleBoutik.
2. Appuyer sur « Thermique Bluetooth ».
3. Dans le sélecteur Android/Chrome, choisir la P5_300A.
4. Si aucun service reconnu n'est trouvé, noter le message et le modèle exact; ne pas modifier les UUID au hasard.
5. Vérifier le papier physiquement. Une écriture BLE terminée ne garantit pas que le ticket est sorti.

Le Web Bluetooth exige un navigateur compatible, un contexte sécurisé (HTTPS) et une action explicite de l'utilisateur. Le Bluetooth classique SPP n'est pas accessible directement par cette API Web; il nécessite un pont natif compatible.
