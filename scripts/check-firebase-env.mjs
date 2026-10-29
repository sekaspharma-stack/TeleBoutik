const required = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
];

const optional = [
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_MEASUREMENT_ID',
];

const missing = required.filter((name) => !process.env[name]?.trim());
const missingOptional = optional.filter((name) => !process.env[name]?.trim());

console.log('[TeleBoutik] Vérification de la configuration Firebase pour le build.');
for (const name of required) {
  console.log(`- ${name}: ${process.env[name]?.trim() ? 'PRESENTE' : 'ABSENTE'}`);
}
for (const name of optional) {
  console.log(`- ${name}: ${process.env[name]?.trim() ? 'PRESENTE' : 'ABSENTE (facultative)'}`);
}

if (missing.length) {
  console.error('\n[TeleBoutik] Build arrêté : les variables Firebase obligatoires ne sont pas disponibles dans le processus de build.');
  console.error('Dans Cloudflare Pages > Settings > Variables and Secrets, recrée les variables VITE_FIREBASE_* en type Secret (pas Text), puis relance un nouveau déploiement.');
  console.error('Variables obligatoires absentes : ' + missing.join(', '));
  console.error('Aucune valeur n’a été affichée.\n');
  process.exit(1);
}

console.log('[TeleBoutik] Variables Firebase obligatoires accessibles au build.');
