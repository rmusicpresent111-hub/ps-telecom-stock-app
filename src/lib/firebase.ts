/**
 * Firebase core — PS TELECOM cloud database (user's own Firebase project).
 *
 * Client-side only (Firebase JS SDK). Works in the browser and inside the
 * Capacitor Android WebView (https://localhost secure context).
 *
 * Data lives in Cloud Firestore under:  psStock/{userId}/{store}/{recordId}
 * The app itself stays 100% offline-first (IndexedDB) — Firestore is the
 * cloud backup/sync layer the user asked to integrate.
 */

import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getAnalytics, isSupported, type Analytics } from 'firebase/analytics';

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
export const firebaseConfig = {
  apiKey: 'AIzaSyDT79JnT8b7Bc-ZE0ovxeBLe8pI4dF-xC8',
  authDomain: 'ps-stock-menagement.firebaseapp.com',
  projectId: 'ps-stock-menagement',
  storageBucket: 'ps-stock-menagement.firebasestorage.app',
  messagingSenderId: '291985306827',
  appId: '1:291985306827:web:92eb51d939686fdce7574e',
  measurementId: 'G-MYF2CDRB2C',
};

let app: FirebaseApp | null = null;

/** Singleton Firebase app (safe to call repeatedly). */
export function getFirebaseApp(): FirebaseApp {
  if (!app) {
    app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  }
  return app;
}

/**
 * Google Analytics — OPTIONAL. Silently skipped when the environment does not
 * support it (SSR, file://, some WebViews). Never throws.
 */
export function initFirebaseAnalytics(): void {
  if (typeof window === 'undefined') return;
  void (async () => {
    try {
      const supported = await isSupported();
      if (!supported) return;
      getAnalytics(getFirebaseApp());
    } catch (err) {
      console.warn('[firebase] analytics unavailable:', (err as Error)?.message);
    }
  })();
}
