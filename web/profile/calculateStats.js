/** @typedef {import('./profileTypes.js').FocusSession} FocusSession */
/** @typedef {import('./profileTypes.js').ProfileStore} ProfileStore */
/** @typedef {import('./profileTypes.js').ProfileStatsView} ProfileStatsView */

/** XP earned per focused minute — easy to tune later. */
export const XP_PER_FOCUSED_MINUTE = 1;

/** XP required for level n → n+1 grows gently. */
export function xpRequiredForLevel(level) {
  const safeLevel = Math.max(1, Math.floor(level));
  return 100 + (safeLevel - 1) * 50;
}

/**
 * @param {number} totalXp
 * @returns {{ level: number, xpIntoLevel: number, xpForNextLevel: number, xpProgress: number }}
 */
export function deriveLevelFromXp(totalXp) {
  let xp = Math.max(0, Math.floor(totalXp));
  let level = 1;

  while (xp >= xpRequiredForLevel(level)) {
    xp -= xpRequiredForLevel(level);
    level += 1;
    if (level > 999) break;
  }

  const xpForNextLevel = xpRequiredForLevel(level);
  return {
    level,
    xpIntoLevel: xp,
    xpForNextLevel,
    xpProgress: xpForNextLevel === 0 ? 0 : xp / xpForNextLevel,
  };
}

/**
 * @param {number} ms
 * @returns {string}
 */
export function formatDurationShort(ms) {
  if (!ms || ms <= 0) return "0m";

  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  if (totalMinutes > 0) return `${minutes}m`;

  const seconds = Math.floor(ms / 1000);
  return `${Math.max(1, seconds)}s`;
}

/**
 * Local calendar day key YYYY-MM-DD.
 * @param {number} epochMs
 * @returns {string}
 */
function dayKey(epochMs) {
  const d = new Date(epochMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Consecutive days ending today (or yesterday if no session today yet)
 * with ≥1 completed session.
 *
 * @param {FocusSession[]} sessions
 * @param {number} [now]
 * @returns {number}
 */
export function calculateFocusStreakDays(sessions, now = Date.now()) {
  const completedDays = new Set(
    sessions
      .filter((s) => s.completed && typeof s.endedAt === "number")
      .map((s) => dayKey(s.endedAt))
  );

  if (completedDays.size === 0) return 0;

  let cursor = new Date(now);
  let key = dayKey(cursor.getTime());

  // If nothing today, start streak from yesterday.
  if (!completedDays.has(key)) {
    cursor.setDate(cursor.getDate() - 1);
    key = dayKey(cursor.getTime());
    if (!completedDays.has(key)) return 0;
  }

  let streak = 0;
  while (completedDays.has(key)) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
    key = dayKey(cursor.getTime());
  }

  return streak;
}

/**
 * @param {FocusSession[]} sessions
 * @returns {number}
 */
export function calculateLongestSessionMs(sessions) {
  return sessions.reduce((max, s) => {
    if (!s.completed) return max;
    const value = typeof s.durationMs === "number" ? s.durationMs : 0;
    return Math.max(max, value);
  }, 0);
}

/**
 * @param {FocusSession[]} sessions
 * @returns {string|null}
 */
export function calculateTopDistraction(sessions) {
  /** @type {Record<string, number>} */
  const totals = {};

  for (const session of sessions) {
    const domains = session.distractionDomains || {};
    for (const [domain, count] of Object.entries(domains)) {
      if (!domain) continue;
      totals[domain] = (totals[domain] || 0) + (Number(count) || 0);
    }
  }

  let top = null;
  let topCount = 0;
  for (const [domain, count] of Object.entries(totals)) {
    if (count > topCount) {
      top = domain;
      topCount = count;
    }
  }

  return top;
}

/**
 * Simple health: average on-task ratio of last few completed sessions.
 * Defaults to a calm resting value when empty (UI will still show empty copy).
 *
 * @param {FocusSession[]} sessions
 * @returns {number} 0–100
 */
export function calculateCharacterHealth(sessions) {
  const recent = sessions.filter((s) => s.completed).slice(-5);
  if (recent.length === 0) return 0;

  const ratios = recent.map((s) => {
    if (typeof s.onTaskRatio === "number") return Math.min(1, Math.max(0, s.onTaskRatio));
    return 0.5;
  });

  const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  return Math.round(avg * 100);
}

/**
 * @param {number} health
 * @returns {string}
 */
export function characterHealthLabel(health) {
  if (health <= 0) return "Resting";
  if (health < 35) return "Needs care";
  if (health < 70) return "Okay";
  if (health < 90) return "Happy";
  return "Thriving";
}

/**
 * Prefer stored XP; if zero, derive a baseline from completed focused minutes.
 *
 * @param {ProfileStore} store
 * @returns {number}
 */
export function resolveTotalXp(store) {
  if (store.xp > 0) return store.xp;

  const focusedMs = store.sessions
    .filter((s) => s.completed)
    .reduce((sum, s) => sum + (s.durationMs || 0), 0);

  const focusedMinutes = Math.floor(focusedMs / 60000);
  return focusedMinutes * XP_PER_FOCUSED_MINUTE;
}

/**
 * @param {ProfileStore} store
 * @param {number} [now]
 * @returns {ProfileStatsView}
 */
export function calculateProfileStats(store, now = Date.now()) {
  const sessions = Array.isArray(store.sessions) ? store.sessions : [];
  const completed = sessions.filter((s) => s.completed);
  const hasSessions = completed.length > 0;

  const health = calculateCharacterHealth(sessions);
  const longestSessionMs = calculateLongestSessionMs(sessions);
  const totalXp = resolveTotalXp(store);
  const levelInfo = deriveLevelFromXp(totalXp);

  return {
    hasSessions,
    characterHealth: health,
    characterHealthLabel: characterHealthLabel(health),
    focusStreakDays: calculateFocusStreakDays(sessions, now),
    longestSessionMs,
    longestSessionLabel: formatDurationShort(longestSessionMs),
    sessionsCompleted: completed.length,
    topDistraction: calculateTopDistraction(sessions),
    level: levelInfo.level,
    xp: totalXp,
    xpIntoLevel: levelInfo.xpIntoLevel,
    xpForNextLevel: levelInfo.xpForNextLevel,
    xpProgress: levelInfo.xpProgress,
  };
}
