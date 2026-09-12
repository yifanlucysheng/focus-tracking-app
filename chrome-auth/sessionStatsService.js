/**
 * Extension focus-session → stats → Supabase sync.
 * Reuses website calculation utilities (XP, level, Focus Streak).
 */
import {
  applyXp,
  calculateProfileStats,
  calculateSessionXp,
  normalizeProgressXp,
} from "../web/profile/calculateStats.js";
import {
  calculateFocusStreak,
  latestCompletedFocusDate,
  updateFocusStreakOnSessionComplete,
} from "../web/profile/focusStreak.js";
import { isProgressAhead } from "../web/profile/xp.js";
import { getSupabase } from "./supabaseClient.js";
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
 */

/**
 * Sync public fields only. Queues for retry on failure.
 *
 * @param {string} userId
 * @param {{ focus_level: number, xp: number, focus_streak: number }} stats
 * @param {string} [sessionId]
 */
export async function syncProfileStats(userId, stats, sessionId) {
  const focus_level = Math.max(1, Math.floor(Number(stats.focus_level) || 1));
  const xp = Math.max(0, Math.floor(Number(stats.xp) || 0));
  const focus_streak = Math.max(0, Math.floor(Number(stats.focus_streak) || 0));
  const payload = { focus_level, xp, focus_streak };

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("profiles")
      .update(payload)
      .eq("id", userId)
      .select("id, username, focus_level, xp, focus_streak, created_at")
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error("No profiles row returned for sync.");

    await clearPendingSyncForUser(userId);
    return data;
  } catch (err) {
    console.error(
      "[Focus Buddy] Profile sync failed — local progress kept; queued for retry:",
      err
    );
    await enqueuePendingSync({
      userId,
      ...payload,
      sessionId,
      updatedAt: Date.now(),
    });
    return null;
  }
}

/**
 * Record a completed focus session using the same XP / level / streak rules as the website.
 * Idempotent on sessionId. Does not upload task text, sites, or browsing history.
 *
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
  await hydratePublicTotalsFromSupabase(store);

  const alreadyLocal = store.sessions.some((s) => s && s.id === sessionId);
  if (alreadyLocal) {
    await markSessionProcessed(sessionId);
    const stats = calculateProfileStats(store);
    const profile = await syncAfterLocalSave(store, stats, sessionId);
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

  store.sessions = [
    ...store.sessions,
    {
      id: sessionId,
      startedAt: sessionInput.startedAt,
      endedAt,
      durationMs,
      completed: true,
      onTaskRatio,
    },
  ];
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
  const profile = await syncAfterLocalSave(saved, stats, sessionId);

  return { store: saved, stats, profile, skippedDuplicate: false };
}

/**
 * Retry any queued public-stat syncs (e.g. after earlier network failure).
 */
export async function flushPendingPublicSync() {
  const queue = await loadPendingPublicSync();
  if (queue.length === 0) return;

  const remaining = [];
  for (const item of queue) {
    try {
      const supabase = getSupabase();
      const { error } = await supabase
        .from("profiles")
        .update({
          focus_level: item.focus_level,
          xp: item.xp,
          focus_streak: item.focus_streak ?? item.focus_flame,
        })
        .eq("id", item.userId);
      if (error) throw error;
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
async function hydratePublicTotalsFromSupabase(store) {
  try {
    const supabase = getSupabase();
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user?.id;
    if (!userId) return;

    const { data, error } = await supabase
      .from("profiles")
      .select("xp, focus_level, focus_streak")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return;

    const remote = normalizeProgressXp(data.focus_level, data.xp, {});
    const local = normalizeProgressXp(store.level, store.xp, {
      xpModel: store.xpModel,
    });

    const best = isProgressAhead(local, remote) ? local : remote;
    store.level = best.level;
    store.xp = best.xp;
    store.xpModel = "progress";

    store.focusStreak = Math.max(
      store.focusStreak || 0,
      Math.floor(Number(data.focus_streak) || 0)
    );

    if (
      remote.migrated &&
      (remote.level !== data.focus_level || remote.xp !== data.xp)
    ) {
      const toSync = isProgressAhead(local, remote) ? local : remote;
      await syncProfileStats(userId, {
        focus_level: toSync.level,
        xp: toSync.xp,
        focus_streak: store.focusStreak,
      });
    }
  } catch (err) {
    console.warn(
      "[Focus Buddy] Could not hydrate public totals from Supabase (continuing locally):",
      err?.message || err
    );
  }
}

/**
 * @param {import('../web/profile/profileTypes.js').ProfileStore} store
 * @param {import('../web/profile/profileTypes.js').ProfileStatsView} stats
 * @param {string} sessionId
 */
async function syncAfterLocalSave(store, stats, sessionId) {
  try {
    const supabase = getSupabase();
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user?.id;
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
      },
      sessionId
    );
  } catch (err) {
    console.error("[Focus Buddy] Sync after session save failed:", err);
    return null;
  }
}

/**
 * @param {import('./chromeProfileStorage.js').PendingPublicSync} item
 */
async function enqueuePendingSync(item) {
  const queue = await loadPendingPublicSync();
  const withoutUser = queue.filter((q) => q.userId !== item.userId);
  withoutUser.push(item);
  await savePendingPublicSync(withoutUser.slice(-20));
}

/**
 * @param {string} userId
 */
async function clearPendingSyncForUser(userId) {
  const queue = await loadPendingPublicSync();
  await savePendingPublicSync(queue.filter((q) => q.userId !== userId));
}
