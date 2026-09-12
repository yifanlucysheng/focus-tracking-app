/**
 * Firebase client for the Chrome extension (FocusBuddyAuth).
 */
import { initializeApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";

/** @type {import('firebase/app').FirebaseApp|null} */
let app = null;
/** @type {import('firebase/auth').Auth|null} */
let auth = null;
/** @type {import('firebase/firestore').Firestore|null} */
let db = null;

/**
 * @param {Record<string, string>} config
 */
export function initFirebaseClient(config) {
  if (app) return { app, auth, db };
  if (!config?.apiKey || !config?.projectId) {
    throw new Error("Missing Firebase config for the extension.");
  }
  app = initializeApp(config);
  auth = getAuth(app);
  db = getFirestore(app);
  return { app, auth, db };
}

export function getFirebaseAuth() {
  if (!auth) throw new Error("Firebase auth not initialized.");
  return auth;
}

export function getFirebaseDb() {
  if (!db) throw new Error("Firebase Firestore not initialized.");
  return db;
}

export function getFirebaseConfigStatus(config) {
  if (
    !config?.apiKey ||
    config.apiKey.includes("YOUR_FIREBASE") ||
    !config?.projectId ||
    config.projectId.includes("YOUR_PROJECT")
  ) {
    return {
      ok: false,
      message:
        "Add Firebase web app keys to secrets.local.js (same project as web/firebase-config.js).",
    };
  }
  return { ok: true };
}

export { onAuthStateChanged, signInWithEmailAndPassword, firebaseSignOut };
