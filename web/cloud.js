import { firebaseConfig } from "./firebase-config.js";
import {
  applyXp,
  calculateFocusStreakDays,
  calculateProfileStats,
  calculateSessionXp,
  normalizeProgressXp,
} from "./profile/calculateStats.js";
import { publicSessionSummaryFromStats } from "./profile/sessionSummary.js";

let app = null;
let auth = null;
let db = null;
let initPromise = null;
let firestoreFns = null;
let authFns = null;

export function isCloudConfigured() {
  return Boolean(
    firebaseConfig?.apiKey &&
      firebaseConfig.apiKey !== "YOUR_FIREBASE_API_KEY" &&
      firebaseConfig.projectId &&
      firebaseConfig.projectId !== "YOUR_PROJECT_ID"
  );
}

async function loadSdk() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (!isCloudConfigured()) {
      throw new Error("Add your Firebase keys to web/firebase-config.js");
    }
    const firebaseSdk = await import("./vendor/firebase.js");
    app = firebaseSdk.initializeApp(firebaseConfig);
    auth = firebaseSdk.getAuth(app);
    db = firebaseSdk.getFirestore(app);
    authFns = firebaseSdk;
    firestoreFns = firebaseSdk;
    return { app, auth, db };
  })();
  return initPromise;
}

export async function getCloud() {
  return loadSdk();
}

export function currentUid() {
  return auth?.currentUser?.uid ?? null;
}

export async function listenAuth(callback) {
  await loadSdk();
  return authFns.onAuthStateChanged(auth, callback);
}

function usernameKey(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "")
    .slice(0, 24);
}

export async function signUpWithEmail({ email, password, username }) {
  await loadSdk();
  const key = usernameKey(username);
  if (key.length < 3) throw new Error("Username must be at least 3 letters or numbers.");

  const { doc, getDoc, setDoc, serverTimestamp } = firestoreFns;
  const nameRef = doc(db, "usernames", key);
  const existing = await getDoc(nameRef);
  if (existing.exists()) throw new Error("That username is taken.");

  const cred = await authFns.createUserWithEmailAndPassword(auth, email, password);
  const uid = cred.user.uid;
  await setDoc(doc(db, "users", uid), {
    username: key,
    displayName: String(username).trim(),
    characterId: "sleepbunny",
    customStatus: "",
    shareStats: false,
    shareListening: false,
    createdAt: serverTimestamp(),
  });
  await setDoc(nameRef, { uid, username: key });
  return cred.user;
}

export async function signInWithEmail(email, password) {
  await loadSdk();
  const cred = await authFns.signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function signOutUser() {
  await loadSdk();
  await authFns.signOut(auth);
}

export async function loadUserDoc(uid = currentUid()) {
  if (!uid) return null;
  await loadSdk();
  const { doc, getDoc } = firestoreFns;
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function updateUserDoc(patch) {
  const uid = currentUid();
  if (!uid) throw new Error("Sign in first.");
  await loadSdk();
  const { doc, updateDoc } = firestoreFns;
  await updateDoc(doc(db, "users", uid), patch);
}

export async function savePrivacy({ shareStats, shareListening }) {
  await updateUserDoc({
    shareStats: Boolean(shareStats),
    shareListening: Boolean(shareListening),
  });
  if (!shareListening) {
    await clearNowPlaying();
  }
}

function weekStartMs(now = Date.now()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d.getTime();
}

function dayStartMs(now = Date.now()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function summarizeSessionsForPublic(sessions, now = Date.now()) {
  const completed = sessions
    .filter((s) => s.completed)
    .slice()
    .sort((a, b) => (a.endedAt || 0) - (b.endedAt || 0));

  const todayStart = dayStartMs(now);
  const weekStart = weekStartMs(now);
  const today = completed.filter((s) => s.endedAt >= todayStart);
  const week = completed.filter((s) => s.endedAt >= weekStart);

  const todayOnTaskMs = today.reduce(
    (sum, s) => sum + (s.durationMs || 0) * (s.onTaskRatio ?? 0),
    0
  );
  const todayMs = today.reduce((sum, s) => sum + (s.durationMs || 0), 0);
  const weeklyFocusMs = week.reduce((sum, s) => sum + (s.durationMs || 0), 0);

  // Replay sessions with Iris progress XP (level + XP toward next).
  let level = 1;
  let xp = 0;
  for (const session of completed) {
    const durationMs = Math.max(0, Number(session.durationMs) || 0);
    const onTaskRatio =
      typeof session.onTaskRatio === "number"
        ? Math.min(1, Math.max(0, session.onTaskRatio))
        : (Number(session.onTaskPercent) || 100) / 100;
    const focusedMinutes = Math.floor((durationMs * onTaskRatio) / 60000);
    const earned = calculateSessionXp(focusedMinutes, true);
    const after = applyXp(level, xp, earned);
    level = after.level;
    xp = after.xp;
  }
  const progress = normalizeProgressXp(level, xp, { xpModel: "progress" });
  const streakDays = calculateFocusStreakDays(completed, now);
  const localView = calculateProfileStats(
    {
      sessions: completed,
      level: progress.level,
      xp: progress.xp,
      xpModel: "progress",
      focusStreak: streakDays,
      lastCompletedFocusDate: null,
      updatedAt: now,
    },
    now
  );
  const summary = publicSessionSummaryFromStats(localView);

  return {
    todayFocusPercent: todayMs ? Math.round((todayOnTaskMs / todayMs) * 100) : 0,
    weeklyFocusMs,
    streakDays,
    sessionsCompleted: summary.sessions_completed ?? completed.length,
    xp: progress.xp,
    level: progress.level,
    xpModel: "progress",
    longestSessionMs: summary.longest_session_ms ?? 0,
    topDistraction: summary.top_distraction ?? null,
    topProductiveSite: summary.top_productive_site ?? null,
    characterHealth: summary.character_health ?? 0,
    liveSessionActive: false,
    updatedAt: now,
  };
}

export async function saveSession(session) {
  const uid = currentUid();
  if (!uid) return null;
  await loadSdk();
  const { doc, setDoc, getDoc, collection, getDocs, query, orderBy } = firestoreFns;
  const ref = doc(db, "users", uid, "sessions", session.id);
  await setDoc(ref, session);
  const snaps = await getDocs(query(collection(db, "users", uid, "sessions"), orderBy("endedAt", "desc")));
  const sessions = snaps.docs.map((item) => item.data());
  const publicStats = summarizeSessionsForPublic(sessions);

  const existingSnap = await getDoc(doc(db, "users", uid, "public", "stats"));
  const existing = existingSnap.exists() ? existingSnap.data() : null;
  if (existing?.liveSessionActive) {
    delete publicStats.characterHealth;
    delete publicStats.liveSessionActive;
  }

  await setDoc(doc(db, "users", uid, "public", "stats"), publicStats, { merge: true });
  return session;
}

export async function loadMySessions() {
  const uid = currentUid();
  if (!uid) return [];
  await loadSdk();
  const { collection, getDocs, query, orderBy } = firestoreFns;
  const snaps = await getDocs(query(collection(db, "users", uid, "sessions"), orderBy("endedAt", "desc")));
  return snaps.docs.map((item) => ({ id: item.id, ...item.data() }));
}

export async function syncPendingSessions(pending = []) {
  if (!currentUid() || !pending.length) return [];
  const remaining = [];
  for (const session of pending) {
    try {
      await saveSession(session);
    } catch {
      remaining.push(session);
    }
  }
  return remaining;
}

export async function findUidByUsername(username) {
  await loadSdk();
  const key = usernameKey(username);
  if (!key) return null;
  const { doc, getDoc } = firestoreFns;
  const snap = await getDoc(doc(db, "usernames", key));
  return snap.exists() ? snap.data().uid : null;
}

export async function sendFriendRequest(username) {
  const uid = currentUid();
  if (!uid) throw new Error("Sign in first.");
  const otherUid = await findUidByUsername(username);
  if (!otherUid) throw new Error("No account with that username.");
  if (otherUid === uid) throw new Error("You cannot add yourself.");

  const incoming = await listIncomingRequests();
  const alreadyAsked = incoming.find((req) => (req.fromUid || req.id) === otherUid);
  if (alreadyAsked) {
    await acceptFriendRequest(alreadyAsked.fromUid || alreadyAsked.id);
    return { accepted: true };
  }

  const me = await loadUserDoc(uid);
  await loadSdk();
  const { doc, setDoc } = firestoreFns;
  await setDoc(doc(db, "friendRequests", otherUid, "incoming", uid), {
    fromUid: uid,
    fromUsername: me?.username || "friend",
    createdAt: Date.now(),
  });
}

export async function listIncomingRequests() {
  const uid = currentUid();
  if (!uid) return [];
  await loadSdk();
  const { collection, getDocs } = firestoreFns;
  const snaps = await getDocs(collection(db, "friendRequests", uid, "incoming"));
  return snaps.docs.map((item) => ({ id: item.id, ...item.data() }));
}

export async function acceptFriendRequest(fromUid) {
  const uid = currentUid();
  if (!uid) throw new Error("Sign in first.");
  await loadSdk();
  const { doc, setDoc, deleteDoc } = firestoreFns;
  await setDoc(doc(db, "friends", uid, "accepted", fromUid), { uid: fromUid, since: Date.now() });
  await setDoc(doc(db, "friends", fromUid, "accepted", uid), { uid, since: Date.now() });
  await deleteDoc(doc(db, "friendRequests", uid, "incoming", fromUid));
}

export async function rejectFriendRequest(fromUid) {
  const uid = currentUid();
  if (!uid) throw new Error("Sign in first.");
  await loadSdk();
  const { doc, deleteDoc } = firestoreFns;
  await deleteDoc(doc(db, "friendRequests", uid, "incoming", fromUid));
}

export async function listFriendIds() {
  const uid = currentUid();
  if (!uid) return [];
  await loadSdk();
  const { collection, getDocs } = firestoreFns;
  const snaps = await getDocs(collection(db, "friends", uid, "accepted"));
  return snaps.docs.map((item) => item.id);
}

async function readFriendFacing(uid) {
  await loadSdk();
  const { doc, getDoc } = firestoreFns;
  const userSnap = await getDoc(doc(db, "users", uid));
  if (!userSnap.exists()) return null;
  const user = { id: uid, ...userSnap.data() };
  const view = {
    id: uid,
    username: user.username || "friend",
    characterId: user.characterId || "sleepbunny",
    customStatus: user.customStatus || "",
    shareStats: Boolean(user.shareStats),
    shareListening: Boolean(user.shareListening),
    stats: null,
    listening: null,
  };

  if (user.shareStats) {
    try {
      const statsSnap = await getDoc(doc(db, "users", uid, "public", "stats"));
      view.stats = statsSnap.exists() ? statsSnap.data() : null;
    } catch {
      view.stats = null;
    }
  }

  if (user.shareListening) {
    try {
      const listenSnap = await getDoc(doc(db, "users", uid, "public", "nowPlaying"));
      view.listening = listenSnap.exists() ? listenSnap.data() : null;
    } catch {
      view.listening = null;
    }
  }

  return view;
}

export async function loadFriendsActivity() {
  const ids = await listFriendIds();
  const rows = [];
  for (const id of ids) {
    try {
      const row = await readFriendFacing(id);
      if (row) rows.push(row);
    } catch {
      // Permission denied if the friendship docs are incomplete.
    }
  }
  return rows;
}

export async function loadOwnPublicStats() {
  const uid = currentUid();
  if (!uid) return null;
  await loadSdk();
  const { doc, getDoc } = firestoreFns;
  const snap = await getDoc(doc(db, "users", uid, "public", "stats"));
  if (snap.exists()) return snap.data();
  const sessions = await loadMySessions();
  return summarizeSessionsForPublic(sessions);
}

/**
 * Live-listen to the signed-in user's public stats (e.g. mid-session character health).
 * @param {(stats: object|null) => void} callback
 * @returns {Promise<() => void>} unsubscribe
 */
export async function listenOwnPublicStats(callback) {
  const uid = currentUid();
  if (!uid) {
    callback(null);
    return () => {};
  }
  await loadSdk();
  const { doc, onSnapshot } = firestoreFns;
  if (typeof onSnapshot !== "function") {
    const stats = await loadOwnPublicStats();
    callback(stats);
    return () => {};
  }
  return onSnapshot(
    doc(db, "users", uid, "public", "stats"),
    (snap) => {
      callback(snap.exists() ? snap.data() : null);
    },
    (err) => {
      console.warn("[Focus Buddy] Public stats listener failed:", err);
      callback(null);
    }
  );
}

export async function saveNowPlaying(payload) {
  const uid = currentUid();
  if (!uid) return;
  const me = await loadUserDoc(uid);
  if (!me?.shareListening) {
    await clearNowPlaying();
    return;
  }
  await loadSdk();
  const { doc, setDoc } = firestoreFns;
  await setDoc(doc(db, "users", uid, "public", "nowPlaying"), {
    ...payload,
    updatedAt: Date.now(),
  });
}

export async function clearNowPlaying() {
  const uid = currentUid();
  if (!uid) return;
  await loadSdk();
  const { doc, deleteDoc } = firestoreFns;
  try {
    await deleteDoc(doc(db, "users", uid, "public", "nowPlaying"));
  } catch {
    // Already gone.
  }
}

export async function saveSpotifyTokens(tokens) {
  const uid = currentUid();
  if (!uid) throw new Error("Sign in first.");
  await loadSdk();
  const { doc, setDoc } = firestoreFns;
  await setDoc(doc(db, "users", uid, "private", "spotify"), {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken || "",
    expiresAt: tokens.expiresAt || 0,
    tokenType: tokens.tokenType || "Bearer",
    updatedAt: Date.now(),
  });
}

export async function loadSpotifyTokens() {
  const uid = currentUid();
  if (!uid) return null;
  await loadSdk();
  const { doc, getDoc } = firestoreFns;
  const snap = await getDoc(doc(db, "users", uid, "private", "spotify"));
  return snap.exists() ? snap.data() : null;
}

export async function clearSpotifyTokens() {
  const uid = currentUid();
  if (!uid) return;
  await loadSdk();
  const { doc, deleteDoc } = firestoreFns;
  await deleteDoc(doc(db, "users", uid, "private", "spotify"));
  await clearNowPlaying();
}
