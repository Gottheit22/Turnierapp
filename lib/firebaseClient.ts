import { getApps, getApp, initializeApp } from 'firebase/app';
import { doc, getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
};

if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  // Wird nur im Browser sichtbar; hilft beim schnellen Erkennen fehlender env vars.
  console.warn(
    'Firebase-Umgebungsvariablen fehlen. Bitte die NEXT_PUBLIC_FIREBASE_* Werte setzen.'
  );
}

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const db = getFirestore(app);

// Ein einziges Dokument hält den kompletten Turnierstand.
export const stateDocRef = doc(db, 'tournament', 'default');
