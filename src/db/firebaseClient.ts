import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getFirestore, type Firestore } from 'firebase/firestore';

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

export const db: Firestore = getFirestore(app);

export { app };
