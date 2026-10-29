const required = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
];

const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length) {
  console.error('\n[TeleBoutik] Build Cloudflare interrompu : variables Firebase obligatoires absentes au moment du build.');
  console.error('Ajoutez-les dans Cloudflare Pages > Settings > Variables and Secrets (environnement Production), puis relancez un nouveau build.');
  console.error('Variables manquantes : ' + missing.join(', '));
  console.error('Aucune valeur de variable n’est affichée.\n');
  process.exit(1);
}

console.log('[TeleBoutik] Variables Firebase obligatoires présentes pour le build Cloudflare.');
