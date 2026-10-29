
const required = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
];

console.log('[Diagnostic] Vérification des variables Firebase :');

for (const name of required) {
  const value = process.env[name];
  console.log(`${name}: ${value?.trim() ? 'PRESENTE' : 'ABSENTE'}`);
}

const missing = required.filter((name) => !process.env[name]?.trim());

if (missing.length) {
  console.error('[Diagnostic] Variables absentes :', missing.join(', '));
  process.exit(1);
}

console.log('[Diagnostic] Toutes les variables obligatoires sont présentes.');
