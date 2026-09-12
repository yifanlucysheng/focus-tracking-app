import {
  getCachedProfile,
  getCurrentProfile,
  setCachedProfile,
} from "../auth/authService.js";
import { getSupabaseConfigStatus, supabase } from "../auth/supabaseClient.js";
import {
  applyXp,
  calculateProfileStats,
  calculateSessionXp,
  characterHealthLabel,
  formatDurationShort,
  normalizeProgressXp,
} from "./calculateStats.js";
import {
  calculateFocusStreak,
  latestCompletedFocusDate,
  updateFocusStreakOnSessionComplete,
} from "./focusStreak.js";
import { loadProfileStore, saveProfileStore } from "./profileStorage.js";
import { publicSessionSummaryFromStats } from "./sessionSummary.js";

/**
 * @typedef {import('../auth/authService.js').ProfileRow} ProfileRow
 * @typedef {import('./profileTypes.js').FocusSession} FocusSession
 * @typedef {import('./profileTypes.js').ProfileStatsView} ProfileStatsView
 */

/**
 * Public profile fields synced to Supabase (no full browsing history / task text).
 *
 * @typedef {Object} PublicProfileStats
 * @property {number} focus_level
 * @property {number} xp - XP toward next level
 * @property {number} focus_streak
 * @property {number} [longest_session_ms]
 * @property {number} [sessions_completed]
 * @property {string|null} [top_distraction]
 * @property {string|null} [top_productive_site]
 * @property {number} [character_health]
 */

/**
 * Merge Supabase-authoritative public fields onto a local stats view.
 *
 * @param {ProfileStatsView} localStats
 * @param {ProfileRow|null|undefined} publicProfile
 * @returns {ProfileStatsView}
 */
export function mergePublicProfileIntoStats(localStats, publicProfile) {
  if (!publicProfile) return localStats;

  const use = normalizeProgressXp(publicProfile.focus_level, publicProfile.xp, {});
  const focus_streak = Math.max(
    0,
    Math.floor(
      Number(publicProfile.focus_streak ?? publicProfile.focus_flame) || 0
    )
  );

  const remoteSessions = Math.max(
    0,
    Math.floor(Number(publicProfile.sessions_completed) || 0)
  );
  const remoteLongest = Math.max(
    0,
    Math.floor(Number(publicProfile.longest_session_ms) || 0)
  );
  const sessionsCompleted = Math.max(
    localStats.sessionsCompleted || 0,
    remoteSessions
  );
  const longestSessionMs = Math.max(
    localStats.longestSessionMs || 0,
    remoteLongest
  );
  const preferRemoteSummary = remoteSessions >= (localStats.sessionsCompleted || 0);
  const topDistraction = preferRemoteSummary
    ? publicProfile.top_distraction ?? localStats.topDistraction
    : localStats.topDistraction ?? publicProfile.top_distraction ?? null;
  const topProductiveSite = preferRemoteSummary
    ? publicProfile.top_productive_site ?? localStats.topProductiveSite
    : localStats.topProductiveSite ?? publicProfile.top_productive_site ?? null;
  const characterHealth = preferRemoteSummary
    ? Math.max(
        0,
        Math.min(
          100,
          Math.floor(
            Number(publicProfile.character_health ?? localStats.characterHealth) ||
              0
          )
        )
      )
    : localStats.characterHealth;

  const hasSessions = Boolean(localStats.hasSessions || sessionsCompleted > 0);

  return {
    ...localStats,
    hasSessions,
    level: use.level,
    xp: use.xp,
    focusStreakDays: focus_streak,
    xpIntoLevel: use.xp,
    xpForNextLevel: use.xpForNextLevel,
    xpProgress: use.xpForNextLevel === 0 ? 0 : use.xp / use.xpForNextLevel,
    longestSessionMs,
    longestSessionLabel: formatDurationShort(longestSessionMs),
    sessionsCompleted,
    topDistraction: topDistraction || null,
    topProductiveSite: topProductiveSite || null,
    characterHealth,
    characterHealthLabel: characterHealthLabel(characterHealth),
    lastCompletedFocusDate: localStats.lastCompletedFocusDate ?? null,
  };
}

/**
 * Optionally mirror public Supabase fields into the local cache (not authoritative).
 * Does not touch private session arrays.
 *
 * @param {ProfileRow} profile
 */
export function cachePublicProfileLocally(profile) {
  if (!profile?.id) return;

  const store = loadProfileStore();
  const progress = normalizeProgressXp(profile.focus_level, profile.xp, {});
  store.level = progress.level;
  store.xp = progress.xp;
  store.xpModel = "progress";
  store.focusStreak = Math.max(
    0,
    Math.floor(Number(profile.focus_streak ?? profile.focus_flame) || 0)
  );
  saveProfileStore(store);
}

/**
 * Fetch the signed-in user's public profile FROM Supabase (authoritative read).
 * Updates in-memory cache and optionally localStorage public fields.
 * Never writes to Supabase unless a legacy lifetime row is detected (one-time migrate).
 *
 * @returns {Promise<ProfileRow|null>}
 */
export async function loadPublicProfileFromSupabase() {
  const profile = await getCurrentProfile();
  if (!profile) {
    setCachedProfile(null);
    return null;
  }

  const normalized = normalizeProgressXp(profile.focus_level, profile.xp, {});
  if (
    normalized.migrated &&
    (normalized.level !== profile.focus_level || normalized.xp !== profile.xp)
  ) {
    const migrated = await syncProfileStats(profile.id, {
      focus_level: normalized.level,
      xp: normalized.xp,
      focus_streak: profile.focus_streak ?? profile.focus_flame ?? 0,
    });
    if (migrated) {
      setCachedProfile(migrated);
      cachePublicProfileLocally(migrated);
      return migrated;
    }
  }

  setCachedProfile(profile);
  cachePublicProfileLocally(profile);
  return profile;
}

/**
 * Update the current user's profiles row with public stats only.
 * Call only when an event changes stats (e.g. completed focus session).
 * Returns null on failure so local data can remain intact.
 *
 * @param {string} userId
 * @param {PublicProfileStats | ProfileStatsView | { focus_level?: number, level?: number, xp: number, focus_streak?: number, focus_flame?: number, focusStreakDays?: number }} stats
 * @returns {Promise<ProfileRow|null>}
 */
export async function syncProfileStats(userId, stats) {
  const config = getSupabaseConfigStatus();
  if (!config.ok) {
    console.warn("[Focus Buddy] Skipping profile sync:", config.message);
    return null;
  }

  if (!userId) {
    console.warn("[Focus Buddy] Skipping profile sync: missing user id.");
    return null;
  }

  const focus_level = Math.max(
    1,
    Math.floor(Number(stats.focus_level ?? stats.level) || 1)
  );
  const xp = Math.max(0, Math.floor(Number(stats.xp) || 0));
  const focus_streak = Math.max(
    0,
    Math.floor(
      Number(stats.focus_streak ?? stats.focus_flame ?? stats.focusStreakDays) ||
        0
    )
  );
  const summary = publicSessionSummaryFromStats({
    longestSessionMs: stats.longest_session_ms ?? stats.longestSessionMs,
    sessionsCompleted: stats.sessions_completed ?? stats.sessionsCompleted,
    topDistraction: stats.top_distraction ?? stats.topDistraction,
    topProductiveSite: stats.top_productive_site ?? stats.topProductiveSite,
    characterHealth: stats.character_health ?? stats.characterHealth,
  });
  const payload = {
    focus_level,
    xp,
    focus_streak,
    ...summary,
  };

  try {
    const { data, error } = await supabase
      .from("profiles")
      .update(payload)
      .eq("id", userId)
      .select(
        "id, username, focus_level, xp, focus_streak, longest_session_ms, sessions_completed, top_distraction, top_productive_site, character_health, created_at"
      )
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      console.warn("[Focus Buddy] Profile sync found no row for user:", userId);
      return null;
    }

    setCachedProfile(data);
    cachePublicProfileLocally(data);
    return data;
  } catch (err) {
    console.error("[Focus Buddy] Profile sync failed (local stats unchanged):", err);
    return null;
  }
}

/**
 * @deprecated Do not call on page load — would overwrite newer Supabase values.
 * Prefer event-driven syncProfileStats / recordCompletedSession only.
 *
 * @returns {Promise<{ stats: ProfileStatsView, profile: ProfileRow|null }>}
 */
export async function syncPublicStatsFromLocalStore() {
  console.warn(
    "[Focus Buddy] syncPublicStatsFromLocalStore is event-only; prefer recordCompletedSession."
  );
  const store = loadProfileStore();
  const streak = calculateFocusStreak(store.sessions);
  const lastDay = latestCompletedFocusDate(store.sessions);

  store.focusStreak = streak;
  store.lastCompletedFocusDate = lastDay;
  const saved = saveProfileStore(store);
  const stats = calculateProfileStats(saved);
  const cached = getCachedProfile();

  if (!cached?.id) {
    return { stats, profile: null };
  }

  const profile = await syncProfileStats(cached.id, {
    focus_level: stats.level,
    xp: stats.xp,
    focus_streak: stats.focusStreakDays,
    ...publicSessionSummaryFromStats(stats),
  });

  return { stats, profile };
}

/**
 * Record a completed focus session locally, update Focus Streak with calendar-day
 * rules, recalculate XP / level, then sync public fields to Supabase.
 *
 * Local persistence always succeeds even if Supabase sync fails.
 *
 * @param {Partial<FocusSession> & { startedAt: number, endedAt: number, durationMs: number }} sessionInput
 * @returns {Promise<{ store: import('./profileTypes.js').ProfileStore, stats: ProfileStatsView, profile: ProfileRow|null }>}
 */
export async function recordCompletedSession(sessionInput) {
  const store = loadProfileStore();
  const durationMs = Math.max(0, Number(sessionInput.durationMs) || 0);
  const onTaskRatio =
    typeof sessionInput.onTaskRatio === "number"
      ? Math.min(1, Math.max(0, sessionInput.onTaskRatio))
      : 1;

  const focusedMinutes = Math.floor((durationMs * onTaskRatio) / 60000);
  const earnedXp = calculateSessionXp(focusedMinutes, true);
  const endedAt = sessionInput.endedAt;

  /** @type {FocusSession} */
  const session = {
    id: sessionInput.id || `session-${Date.now()}`,
    startedAt: sessionInput.startedAt,
    endedAt,
    durationMs,
    completed: true,
    onTaskRatio,
  };

  if (sessionInput.task) session.task = sessionInput.task;
  if (sessionInput.longestLockInMs != null) {
    session.longestLockInMs = sessionInput.longestLockInMs;
  }
  if (sessionInput.distractionDomains) {
    session.distractionDomains = sessionInput.distractionDomains;
  }
  if (sessionInput.productiveDomains) {
    session.productiveDomains = sessionInput.productiveDomains;
  }

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

  const saved = saveProfileStore(store);
  const stats = calculateProfileStats(saved, endedAt);

  const cached = getCachedProfile();
  const profile = cached?.id
    ? await syncProfileStats(cached.id, {
        focus_level: stats.level,
        xp: stats.xp,
        focus_streak: stats.focusStreakDays,
        ...publicSessionSummaryFromStats(stats),
      })
    : null;

  return { store: saved, stats, profile };
}
