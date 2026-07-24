import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

const firebaseConfig = {
  apiKey: "AIzaSyAqzv5eieP1Y5zYIQt5vk5oOvG8vDzHDKc",
  authDomain: "foodyzz-27b3e.firebaseapp.com",
  projectId: "foodyzz-27b3e",
  storageBucket: "foodyzz-27b3e.firebasestorage.app",
  messagingSenderId: "392804438663",
  appId: "1:392804438663:web:2bd559e3f803b497e75e22",
  measurementId: "G-JNE8S0HBK0"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
// Cloud Functions live in us-central1 (see functions/src/index.ts).
export const functions = getFunctions(app, 'us-central1');
export const callable = <T = any, R = any>(name: string) => httpsCallable<T, R>(functions, name);

export const subscribeToGlobalConfig = (callback: (config: any) => void) => {
  return onSnapshot(doc(db, 'apiConfig', 'global'), (snapshot) => {
    if (snapshot.exists()) { callback(snapshot.data()); }
  });
};