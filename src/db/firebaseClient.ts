import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getFirestore, type Firestore } from 'firebase/firestore';

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
export const db: Firestore = getFirestore(app);
export { app };
