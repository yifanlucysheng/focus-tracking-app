/**
 * Extension focus-session → stats → Firebase sync.
 * Reuses website calculation utilities (XP, level, Focus Streak, session summary).
 */
import { doc, getDoc, setDoc } from "firebase/firestore";
import {
  applyXp,
  calculateProfileStats,
  calculateSessionXp,
  characterHealthFromOnTaskRatio,
  normalizeProgressXp,
} from "../web/profile/calculateStats.js";
import {
  calculateFocusStreak,
  latestCompletedFocusDate,
  updateFocusStreakOnSessionComplete,
} from "../web/profile/focusStreak.js";
import { publicSessionSummaryFromStats } from "../web/profile/sessionSummary.js";
import { isProgressAhead } from "../web/profile/xp.js";
import { getFirebaseAuth, getFirebaseDb, onAuthStateChanged } from "./firebaseClient.js";
import {
  loadChromeProfileStore,
  loadPendingPublicSync,
  loadProcessedSessionIds,
  markSessionProcessed,
  saveChromeProfileStore,
  savePendingPublicSync,
} from "./chromeProfileStorage.js";

/**
 * @typedef {Object} CompletedSessionInput
 * @property {string} sessionId
 * @property {number} startedAt
 * @property {number} endedAt
 * @property {number} durationMs
 * @property {number} [onTaskRatio]
 * @property {number} [characterHealth]
 * @property {Record<string, number>} [distractionDomains]
 * @property {Record<string, number>} [productiveDomains]
 */

/**
 * @param {string} userId
 * @param {object} stats
 * @param {string} [sessionId]
 * @param {object} [sessionDoc]
 */
export async function syncProfileStats(userId, stats, sessionId, sessionDoc) {
  const level = Math.max(1, Math.floor(Number(stats.focus_level ?? stats.level) || 1));
  const xp = Math.max(0, Math.floor(Number(stats.xp) || 0));
  const streakDays = Math.max(
    0,
    Math.floor(Number(stats.focus_streak ?? stats.focusStreakDays) || 0)
  );
  const summary = publicSessionSummaryFromStats({
    longestSessionMs: stats.longest_session_ms ?? stats.longestSessionMs,
    sessionsCompleted: stats.sessions_completed ?? stats.sessionsCompleted,
    topDistraction: stats.top_distraction ?? stats.topDistraction,
    topProductiveSite: stats.top_productive_site ?? stats.topProductiveSite,
    characterHealth: stats.character_health ?? stats.characterHealth,
  });

  const payload = {
    level,
    xp,
    xpModel: "progress",
    streakDays,
    sessionsCompleted: summary.sessions_completed ?? 0,
    longestSessionMs: summary.longest_session_ms ?? 0,
    topDistraction: summary.top_distraction ?? null,
    topProductiveSite: summary.top_productive_site ?? null,
    characterHealth: summary.character_health ?? 0,
    liveSessionActive: false,
    updatedAt: Date.now(),
  };

  try {
    const db = getFirebaseDb();
    if (sessionId && sessionDoc) {
      await setDoc(doc(db, "users", userId, "sessions", sessionId), sessionDoc, {
        merge: true,
      });
    }

    // Never clobber an in-progress lock-in health write with a stale completed-session average.
    const existingSnap = await getDoc(doc(db, "users", userId, "public", "stats"));
    const existing = existingSnap.exists() ? existingSnap.data() : null;
    if (existing?.liveSessionActive) {
      delete payload.characterHealth;
      delete payload.liveSessionActive;
    }

    await setDoc(doc(db, "users", userId, "public", "stats"), payload, {
      merge: true,
    });
    await clearPendingSyncForUser(userId);
    return { id: userId, ...payload, ...(existing?.liveSessionActive ? {
      characterHealth: existing.characterHealth,
      liveSessionActive: true,
    } : {}) };
  } catch (err) {
    console.error(
      "[Focus Buddy] Profile sync failed — local progress kept; queued for retry:",
      err
    );
    await enqueuePendingSync({
      userId,
      ...payload,
      sessionId,
      sessionDoc: sessionDoc || null,
      updatedAt: Date.now(),
    });
    return null;
  }
}

/**
 * Push live session character health to Firebase so the website can mirror it mid-session.
 * Health starts at 100 and drops 1 point per 1% of session time spent off-task.
 *
 * @param {number} health 0–100
 * @param {{ liveSessionActive?: boolean }} [options]
 */
export async function syncLiveCharacterHealth(health, options = {}) {
  // Don't stall every HP tick waiting for auth — return fast if signed out.
  let auth;
  try {
    auth = getFirebaseAuth();
  } catch {
    return null;
  }
  if (!auth?.currentUser?.uid) {
    await waitForSignedInUser(400);
    try {
      auth = getFirebaseAuth();
    } catch {
      return null;
    }
  }
  const userId = auth?.currentUser?.uid;
  if (!userId) return null;

  const parsed = Number(health);
  const characterHealth = Math.max(
    0,
    Math.min(100, Math.floor(Number.isFinite(parsed) ? parsed : 0))
  );
  const liveSessionActive = Boolean(options.liveSessionActive);
  const payload = {
    characterHealth,
    liveSessionActive,
    healthUpdatedAt: Date.now(),
    updatedAt: Date.now(),
  };

  try {
    const db = getFirebaseDb();
    await setDoc(doc(db, "users", userId, "public", "stats"), payload, {
      merge: true,
    });
    return payload;
  } catch (err) {
    console.warn("[Focus Buddy] Live character health sync failed:", err);
    return null;
  }
}

/**
 * Wait briefly for Firebase Auth persistence to restore the signed-in user.
 * @param {number} timeoutMs
 */
async function waitForSignedInUser(timeoutMs = 5000) {
  let auth;
  try {
    auth = getFirebaseAuth();
  } catch {
    return null;
  }
  if (auth.currentUser?.uid) return auth.currentUser;

  return new Promise((resolve) => {
    /** @type {(() => void)|null} */
    let unsub = null;
    const timer = setTimeout(() => {
      unsub?.();
      resolve(auth.currentUser);
    }, timeoutMs);
    unsub = onAuthStateChanged(auth, (user) => {
      if (user?.uid) {
        clearTimeout(timer);
        unsub?.();
        resolve(user);
      }
    });
  });
}

/**
 * @param {number} onTaskRatio
 * @param {{ liveSessionActive?: boolean }} [options]
 */
export async function syncLiveCharacterHealthFromRatio(onTaskRatio, options = {}) {
  return syncLiveCharacterHealth(
    characterHealthFromOnTaskRatio(onTaskRatio),
    options
  );
}

/**
 * @param {CompletedSessionInput} sessionInput
 */
export async function recordCompletedSession(sessionInput) {
  const sessionId = String(sessionInput.sessionId || "").trim();
  if (!sessionId) throw new Error("sessionId is required for idempotent completion.");

  const processed = await loadProcessedSessionIds();
  if (processed.includes(sessionId)) {
    await flushPendingPublicSync();
    const store = await loadChromeProfileStore();
    return {
      store,
      stats: calculateProfileStats(store),
      profile: null,
      skippedDuplicate: true,
    };
  }

  const store = await loadChromeProfileStore();
  await hydratePublicTotalsFromFirebase(store);

  const alreadyLocal = store.sessions.some((s) => s && s.id === sessionId);
  if (alreadyLocal) {
    await markSessionProcessed(sessionId);
    const stats = calculateProfileStats(store);
    const profile = await syncAfterLocalSave(store, stats, sessionId, null);
    return { store, stats, profile, skippedDuplicate: true };
  }

  const durationMs = Math.max(0, Number(sessionInput.durationMs) || 0);
  const onTaskRatio =
    typeof sessionInput.onTaskRatio === "number"
      ? Math.min(1, Math.max(0, sessionInput.onTaskRatio))
      : 1;
  const endedAt = sessionInput.endedAt;
  const focusedMinutes = Math.floor((durationMs * onTaskRatio) / 60000);
  const earnedXp = calculateSessionXp(focusedMinutes, true);

  const streakUpdate = updateFocusStreakOnSessionComplete({
    previousStreak:
      store.focusStreak || store.focusFlame || calculateFocusStreak(store.sessions),
    lastCompletedFocusDate:
      store.lastCompletedFocusDate || latestCompletedFocusDate(store.sessions),
    completedAt: endedAt,
  });

  const before = normalizeProgressXp(store.level, store.xp, {
    xpModel: store.xpModel,
  });
  const after = applyXp(before.level, before.xp, earnedXp);

  /** @type {import('../web/profile/profileTypes.js').FocusSession} */
  const session = {
    id: sessionId,
    startedAt: sessionInput.startedAt,
    endedAt,
    durationMs,
    completed: true,
    onTaskRatio,
  };
  if (typeof sessionInput.characterHealth === "number") {
    session.characterHealth = Math.max(
      0,
      Math.min(100, Math.floor(sessionInput.characterHealth))
    );
  }
  if (sessionInput.distractionDomains) {
    session.distractionDomains = sessionInput.distractionDomains;
  }
  if (sessionInput.productiveDomains) {
    session.productiveDomains = sessionInput.productiveDomains;
  }

  store.sessions = [...store.sessions, session];
  store.level = after.level;
  store.xp = after.xp;
  store.xpModel = "progress";
  store.focusStreak = streakUpdate.focusStreak;
  store.lastCompletedFocusDate = streakUpdate.lastCompletedFocusDate;

  const reconciledStreak = calculateFocusStreak(store.sessions, endedAt);
  store.focusStreak = reconciledStreak;
  store.lastCompletedFocusDate =
    latestCompletedFocusDate(store.sessions) || streakUpdate.lastCompletedFocusDate;

  const saved = await saveChromeProfileStore(store);
  await markSessionProcessed(sessionId);

  const stats = calculateProfileStats(saved, endedAt);
  const profile = await syncAfterLocalSave(saved, stats, sessionId, {
    ...session,
    durationSeconds: Math.round(durationMs / 1000),
    onTaskPercent: Math.round(onTaskRatio * 100),
  });

  return { store: saved, stats, profile, skippedDuplicate: false };
}

export async function flushPendingPublicSync() {
  const queue = await loadPendingPublicSync();
  if (queue.length === 0) return;

  const remaining = [];
  for (const item of queue) {
    try {
      const db = getFirebaseDb();
      if (item.sessionId && item.sessionDoc) {
        await setDoc(
          doc(db, "users", item.userId, "sessions", item.sessionId),
          item.sessionDoc,
          { merge: true }
        );
      }
      const liveSnap = await getDoc(doc(db, "users", item.userId, "public", "stats"));
      const liveActive = Boolean(liveSnap.exists() && liveSnap.data()?.liveSessionActive);
      /** @type {Record<string, unknown>} */
      const publicPayload = {
        level: item.level ?? item.focus_level,
        xp: item.xp,
        xpModel: "progress",
        streakDays: item.streakDays ?? item.focus_streak,
        sessionsCompleted: item.sessionsCompleted ?? item.sessions_completed ?? 0,
        longestSessionMs: item.longestSessionMs ?? item.longest_session_ms ?? 0,
        topDistraction: item.topDistraction ?? item.top_distraction ?? null,
        topProductiveSite:
          item.topProductiveSite ?? item.top_productive_site ?? null,
        updatedAt: Date.now(),
      };
      if (!liveActive) {
        publicPayload.characterHealth =
          item.characterHealth ?? item.character_health ?? 0;
        publicPayload.liveSessionActive = false;
      }
      await setDoc(
        doc(db, "users", item.userId, "public", "stats"),
        publicPayload,
        { merge: true }
      );
    } catch (err) {
      console.error("[Focus Buddy] Pending sync retry failed:", err);
      remaining.push(item);
    }
  }
  await savePendingPublicSync(remaining);
}

/**
 * @param {import('../web/profile/profileTypes.js').ProfileStore} store
 */
async function hydratePublicTotalsFromFirebase(store) {
  try {
    const auth = getFirebaseAuth();
    const userId = auth.currentUser?.uid;
    if (!userId) return;

    const db = getFirebaseDb();
    const snap = await getDoc(doc(db, "users", userId, "public", "stats"));
    if (!snap.exists()) return;
    const data = snap.data();

    const remote = normalizeProgressXp(data.level, data.xp, {
      xpModel: data.xpModel === "progress" ? "progress" : null,
    });
    const local = normalizeProgressXp(store.level, store.xp, {
      xpModel: store.xpModel,
    });

    const best = isProgressAhead(local, remote) ? local : remote;
    store.level = best.level;
    store.xp = best.xp;
    store.xpModel = "progress";
    store.focusStreak = Math.max(
      store.focusStreak || 0,
      Math.floor(Number(data.streakDays) || 0)
    );
  } catch (err) {
    console.warn(
      "[Focus Buddy] Could not hydrate public totals from Firebase (continuing locally):",
      err?.message || err
    );
  }
}

/**
 * @param {import('../web/profile/profileTypes.js').ProfileStore} store
 * @param {import('../web/profile/profileTypes.js').ProfileStatsView} stats
 * @param {string} sessionId
 * @param {object|null} sessionDoc
 */
async function syncAfterLocalSave(store, stats, sessionId, sessionDoc) {
  try {
    const auth = getFirebaseAuth();
    const userId = auth.currentUser?.uid;
    if (!userId) {
      console.warn(
        "[Focus Buddy] Session completed locally, but no signed-in user — cloud sync skipped."
      );
      return null;
    }

    return syncProfileStats(
      userId,
      {
        focus_level: stats.level,
        xp: stats.xp,
        focus_streak: stats.focusStreakDays,
        ...publicSessionSummaryFromStats(stats),
      },
      sessionId,
      sessionDoc
    );
  } catch (err) {
    console.error("[Focus Buddy] Sync after session save failed:", err);
    return null;
  }
}

async function enqueuePendingSync(item) {
  const queue = await loadPendingPublicSync();
  const withoutUser = queue.filter((q) => q.userId !== item.userId);
  withoutUser.push(item);
  await savePendingPublicSync(withoutUser.slice(-20));
}

async function clearPendingSyncForUser(userId) {
  const queue = await loadPendingPublicSync();
  await savePendingPublicSync(queue.filter((q) => q.userId !== userId));
}
