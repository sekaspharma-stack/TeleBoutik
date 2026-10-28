import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';

// Firebase Web config is supplied by the hosting environment. Never commit project keys here.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || '',
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId
);

if (!isFirebaseConfigured) {
  console.warn('Firebase configuration is incomplete. TeleBoutik will work locally; cloud sync is disabled until VITE_FIREBASE_* variables are configured.');
}

const appConfig = isFirebaseConfigured ? firebaseConfig : {
  ...firebaseConfig,
  apiKey: 'local-only-disabled',
  authDomain: 'local-only.invalid',
  projectId: 'local-only-disabled',
  appId: '1:0:web:local-only-disabled',
};
const app: FirebaseApp = initializeApp(appConfig);

/**
 * Persistance hors-ligne native de Firestore (IndexedDB).
 * `persistentLocalCache` est le successeur officiel de `enableIndexedDbPersistence()` (déprécié) :
 * même fonctionnalité, mais compatible multi-onglets. Les lectures sont servies instantanément
 * depuis le cache, les écritures hors-ligne sont mises en file puis envoyées automatiquement
 * au retour du réseau. L'auto-détection du long-polling aide sur les réseaux mobiles/proxy instables.
 */
function createFirestore(): Firestore {
  try {
    return initializeFirestore(app, {
      localCache: isFirebaseConfigured
        ? persistentLocalCache({ tabManager: persistentMultipleTabManager() })
        : memoryLocalCache(),
      experimentalAutoDetectLongPolling: true,
    });
  } catch (error) {
    // Firestore déjà initialisé (rechargement à chaud) ou IndexedDB indisponible (navigation privée).
    console.warn('Persistance Firestore indisponible, repli sur le cache mémoire :', error);
    try {
      return getFirestore(app);
    } catch {
      return initializeFirestore(app, { localCache: memoryLocalCache() });
    }
  }
}

export const db: Firestore = createFirestore();
export { app };
