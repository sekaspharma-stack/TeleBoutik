import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyBzByqXqavZfPlu-koX9gEJRGb3koiN7gU',
  authDomain: 'teleboutik-c4903.firebaseapp.com',
  projectId: 'teleboutik-c4903',
  storageBucket: 'teleboutik-c4903.firebasestorage.app',
  messagingSenderId: '681143733329',
  appId: '1:681143733329:web:379f1710f5a7e13432fc70',
  measurementId: 'G-4K6KHTRK0T',
};

export const isFirebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

if (!isFirebaseConfigured) {
  console.warn('Firebase config missing — cloud sync disabled.');
}

const app: FirebaseApp = initializeApp(firebaseConfig);

// Prefer Firestore's own IndexedDB cache so cached reads remain available offline
// and writes are queued by the SDK until the network is restored. Some browsers
// (or older app sessions) may not support persistent cache; fall back safely.
function createFirestore(): Firestore {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });
  } catch (error) {
    console.warn('Firestore persistent cache unavailable; using default Firestore instance.', error);
    return getFirestore(app);
  }
}

export const db: Firestore = createFirestore();

export { app };
