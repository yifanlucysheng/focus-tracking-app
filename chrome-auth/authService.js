import {
  getFirebaseAuth,
  getFirebaseConfigStatus,
  initFirebaseClient,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  firebaseSignOut,
} from "./firebaseClient.js";
import { doc, getDoc } from "firebase/firestore";
import { getFirebaseDb } from "./firebaseClient.js";

/**
 * @typedef {Object} ExtensionAuthState
 * @property {boolean} configured
 * @property {string} [configMessage]
 * @property {boolean} signedIn
 * @property {{ id: string, email?: string }|null} user
 * @property {{ id: string, username: string, focus_level: number, xp: number, focus_streak: number }|null} profile
 */

/** @type {(() => void)|null} */
let unsubAuth = null;

/**
 * @param {Record<string, string>} config
 */
export async function initExtensionAuth(config) {
  const status = getFirebaseConfigStatus(config);
  if (!status.ok) {
    return {
      configured: false,
      configMessage: status.message,
      signedIn: false,
      user: null,
      profile: null,
    };
  }

  initFirebaseClient(config);
  const auth = getFirebaseAuth();

  // Wait for the first auth state so persistence can restore.
  await new Promise((resolve) => {
    if (unsubAuth) unsubAuth();
    unsubAuth = onAuthStateChanged(auth, () => resolve());
  });

  return getAuthState();
}

/**
 * @returns {Promise<ExtensionAuthState>}
 */
export async function getAuthState() {
  try {
    const auth = getFirebaseAuth();
    const user = auth.currentUser;
    if (!user) {
      return {
        configured: true,
        signedIn: false,
        user: null,
        profile: null,
      };
    }
    const profile = await fetchOwnProfile(user.uid);
    return {
      configured: true,
      signedIn: true,
      user: { id: user.uid, email: user.email || undefined },
      profile,
    };
  } catch (err) {
    return {
      configured: false,
      configMessage: err?.message || "Could not read auth session.",
      signedIn: false,
      user: null,
      profile: null,
    };
  }
}

/**
 * @param {{ email: string, password: string }} input
 */
export async function signIn({ email, password }) {
  if (!email?.trim()) throw new Error("Email is required.");
  if (!password) throw new Error("Password is required.");
  const auth = getFirebaseAuth();
  await signInWithEmailAndPassword(auth, email.trim(), password);
  return getAuthState();
}

export async function signOut() {
  const auth = getFirebaseAuth();
  await firebaseSignOut(auth);
  return getAuthState();
}

/**
 * @param {string} userId
 */
async function fetchOwnProfile(userId) {
  const db = getFirebaseDb();
  const userSnap = await getDoc(doc(db, "users", userId));
  const statsSnap = await getDoc(doc(db, "users", userId, "public", "stats"));
  const user = userSnap.exists() ? userSnap.data() : {};
  const stats = statsSnap.exists() ? statsSnap.data() : {};
  return {
    id: userId,
    username: user.username || "you",
    focus_level: Math.max(1, Math.floor(Number(stats.level) || 1)),
    xp: Math.max(0, Math.floor(Number(stats.xp) || 0)),
    focus_streak: Math.max(0, Math.floor(Number(stats.streakDays) || 0)),
  };
}
