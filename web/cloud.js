/**
 * Website cloud adapter: Supabase (Iris) behind the multi-page UI API.
 * Extension sessions sync XP / level / streak / summary via profileService.
 */
import {
  ensureProfileForUser,
  getCachedProfile,
  getSession,
  loadCurrentProfile,
  onAuthStateChange,
  setCachedProfile,
  signIn,
  signOut,
  signUp,
} from "./auth/authService.js";
import { getSupabaseConfigStatus } from "./auth/supabaseClient.js";
import {
  acceptFriendRequest as acceptFriendshipById,
  getAcceptedFriends,
  getActiveFriendshipWith,
  getIncomingPendingRequests,
  searchUserByUsername,
  sendFriendRequest as sendFriendRequestById,
} from "./friends/friendsService.js";
import {
  loadPublicProfileFromSupabase,
  recordCompletedSession,
} from "./profile/profileService.js";
import { loadProfileStore } from "./profile/profileStorage.js";

const PREFS_KEY = "focusBuddy.userPrefs";

/** @type {string|null} */
let cachedUid = null;

export function isCloudConfigured() {
  return getSupabaseConfigStatus().ok;
}

export function currentUid() {
  return cachedUid || getCachedProfile()?.id || null;
}

/**
 * @param {(user: { uid: string } | null) => void | Promise<void>} callback
 */
export async function listenAuth(callback) {
  if (!isCloudConfigured()) {
    await callback(null);
    return () => {};
  }

  const session = await getSession();
  if (session?.user) {
    cachedUid = session.user.id;
    try {
      await ensureProfileForUser(session.user);
    } catch {
      // Profile may still be missing until signup completes.
    }
    await callback({ uid: session.user.id });
  } else {
    cachedUid = null;
    await callback(null);
  }

  return onAuthStateChange(async (next) => {
    if (!next?.user) {
      cachedUid = null;
      setCachedProfile(null);
      await callback(null);
      return;
    }
    cachedUid = next.user.id;
    try {
      await ensureProfileForUser(next.user);
    } catch {
      // Ignore ensure errors in listener.
    }
    await callback({ uid: next.user.id });
  });
}

/**
 * @param {{ email: string, password: string, username: string }} input
 */
export async function signUpWithEmail(input) {
  const result = await signUp(input);
  if (result.session?.user) {
    cachedUid = result.session.user.id;
  }
  if (result.needsEmailConfirmation) {
    throw new Error("Check your email to confirm your account, then sign in.");
  }
  return result.user;
}

/**
 * @param {string} email
 * @param {string} password
 */
export async function signInWithEmail(email, password) {
  const result = await signIn({ email, password });
  cachedUid = result.session.user.id;
  return result.session.user;
}

export async function signOutUser() {
  cachedUid = null;
  await signOut();
}

function loadPrefs(uid) {
  try {
    const raw = localStorage.getItem(`${PREFS_KEY}.${uid}`);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      customStatus: String(parsed.customStatus || ""),
      shareStats: parsed.shareStats !== false,
      shareListening: Boolean(parsed.shareListening),
      characterId: parsed.characterId || "sleepbunny",
    };
  } catch {
    return {
      customStatus: "",
      shareStats: true,
      shareListening: false,
      characterId: "sleepbunny",
    };
  }
}

function savePrefs(uid, patch) {
  const next = { ...loadPrefs(uid), ...patch };
  localStorage.setItem(`${PREFS_KEY}.${uid}`, JSON.stringify(next));
  return next;
}

/**
 * User-facing doc shaped like the Firebase users/{uid} document.
 * @param {string} [uid]
 */
export async function loadUserDoc(uid = currentUid()) {
  if (!uid) return null;
  let profile = getCachedProfile();
  if (!profile || profile.id !== uid) {
    profile = await loadCurrentProfile();
  }
  if (!profile || profile.id !== uid) return null;
  const prefs = loadPrefs(uid);
  return {
    id: profile.id,
    username: profile.username,
    displayName: profile.username,
    characterId: prefs.characterId,
    customStatus: prefs.customStatus,
    shareStats: prefs.shareStats,
    shareListening: prefs.shareListening,
  };
}

/**
 * @param {Record<string, unknown>} patch
 */
export async function updateUserDoc(patch) {
  const uid = currentUid();
  if (!uid) throw new Error("Sign in first.");
  const allowed = {};
  if ("customStatus" in patch) allowed.customStatus = String(patch.customStatus || "");
  if ("characterId" in patch) allowed.characterId = String(patch.characterId || "sleepbunny");
  if ("shareStats" in patch) allowed.shareStats = Boolean(patch.shareStats);
  if ("shareListening" in patch) allowed.shareListening = Boolean(patch.shareListening);
  savePrefs(uid, allowed);
}

/**
 * @param {{ shareStats: boolean, shareListening: boolean }} privacy
 */
export async function savePrivacy(privacy) {
  await updateUserDoc({
    shareStats: Boolean(privacy.shareStats),
    shareListening: Boolean(privacy.shareListening),
  });
}

/**
 * Public stats from Supabase profile (authoritative for XP / level / streak).
 */
export async function loadOwnPublicStats() {
  const profile = await loadPublicProfileFromSupabase();
  if (!profile) return null;
  return {
    level: profile.focus_level ?? 1,
    xp: profile.xp ?? 0,
    streakDays: profile.focus_streak ?? 0,
    sessionsCompleted: profile.sessions_completed ?? 0,
    todayFocusPercent: 0,
    weeklyFocusMs: 0,
    updatedAt: Date.now(),
  };
}

/**
 * Local session history only (full browse logs stay private).
 * @returns {Promise<object[]>}
 */
export async function loadMySessions() {
  return loadProfileStore().sessions || [];
}

/**
 * Persist a completed session via Iris XP + Supabase public sync.
 * @param {object} session
 */
export async function saveSession(session) {
  if (!currentUid()) return null;
  const durationMs = Number(session.durationMs) || 0;
  const durationSeconds =
    Number(session.durationSeconds) || Math.round(durationMs / 1000);
  const onTaskRatio =
    typeof session.onTaskRatio === "number"
      ? session.onTaskRatio
      : (Number(session.onTaskPercent) || 100) / 100;
  const focusedMinutes = Math.max(
    0,
    Math.floor((durationMs * Math.max(0, Math.min(1, onTaskRatio))) / 60000)
  );

  await recordCompletedSession({
    id: session.id || `session_${Date.now()}`,
    startedAt: session.startedAt || Date.now() - durationMs,
    endedAt: session.endedAt || Date.now(),
    durationMs,
    durationSeconds,
    completed: session.completed !== false,
    focusedMinutes,
    distractionDomains: session.distractionDomains || {},
    productiveDomains: session.productiveDomains || {},
    task: session.task || "",
  });
  return session;
}

/**
 * @param {object[]} pending
 */
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

/**
 * @param {string} username
 */
export async function sendFriendRequest(username) {
  const me = currentUid();
  if (!me) throw new Error("Sign in first.");
  const target = await searchUserByUsername(username);
  if (!target) throw new Error("No account with that username.");
  if (target.id === me) throw new Error("You cannot add yourself.");
  const existing = await getActiveFriendshipWith(target.id);
  if (existing?.status === "accepted") {
    throw new Error("You're already friends.");
  }
  if (existing?.status === "pending") {
    throw new Error("Friend request already pending.");
  }
  await sendFriendRequestById(target.id);
}

export async function listIncomingRequests() {
  const rows = await getIncomingPendingRequests();
  return rows.map((row) => ({
    id: row.id,
    fromUid: row.requester_id,
    fromUsername: row.requester?.username || "friend",
    createdAt: row.created_at,
  }));
}

/**
 * Accept by friendship id (preferred) or requester uid.
 * @param {string} friendshipIdOrFromUid
 */
export async function acceptFriendRequest(friendshipIdOrFromUid) {
  const incoming = await getIncomingPendingRequests();
  const match =
    incoming.find((r) => r.id === friendshipIdOrFromUid) ||
    incoming.find((r) => r.requester_id === friendshipIdOrFromUid);
  if (!match) throw new Error("Pending request not found.");
  await acceptFriendshipById(match.id);
}

export async function loadFriendsActivity() {
  const accepted = await getAcceptedFriends();
  return accepted.map(({ friend }) => {
    const prefs = loadPrefs(friend.id);
    // Friends see public XP fields from profiles (privacy prefs are local for now).
    const shareStats = prefs.shareStats !== false;
    return {
      id: friend.id,
      username: friend.username,
      characterId: prefs.characterId || "sleepbunny",
      customStatus: prefs.customStatus || "",
      shareStats,
      shareListening: Boolean(prefs.shareListening),
      stats: shareStats
        ? {
            level: friend.focus_level ?? 1,
            xp: friend.xp ?? 0,
            streakDays: friend.focus_streak ?? 0,
            sessionsCompleted: friend.sessions_completed ?? 0,
            todayFocusPercent: 0,
            weeklyFocusMs: 0,
          }
        : null,
      listening: null,
    };
  });
}

/** Spotify stubs — not backed by Supabase yet. */
export async function saveSpotifyTokens() {}
export async function loadSpotifyTokens() {
  return null;
}
export async function clearSpotifyTokens() {}
export async function saveNowPlaying() {}
export async function clearNowPlaying() {}
