import { getApps, getApp, initializeApp } from 'firebase/app';
import { collection, getFirestore, doc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
};

if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  console.warn(
    'Firebase-Umgebungsvariablen fehlen. Bitte die NEXT_PUBLIC_FIREBASE_* Werte setzen.'
  );
}

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const db = getFirestore(app);

export const TOURNAMENTS_COLLECTION = 'tournaments';
export const tournamentsCollectionRef = collection(db, TOURNAMENTS_COLLECTION);

export function tournamentDocRef(id: string) {
  return doc(db, TOURNAMENTS_COLLECTION, id);
}
