/** @typedef {import('./profileTypes.js').FocusSession} FocusSession */
/** @typedef {import('./profileTypes.js').ProfileStore} ProfileStore */
/** @typedef {import('./profileTypes.js').ProfileStatsView} ProfileStatsView */

import {
  calculateFocusStreak,
  latestCompletedFocusDate,
} from "./focusStreak.js";
import {
  XP_PER_FOCUSED_MINUTE,
  XP_SESSION_COMPLETION_BONUS,
  applyXp,
  calculateSessionXp,
  deriveLevelFromXp,
  normalizeProgressXp,
  resolveProgressXp,
  resolveTotalXp,
  xpRequiredForLevel,
  xpToNextLevel,
} from "./xp.js";

export {
  XP_PER_FOCUSED_MINUTE,
  XP_SESSION_COMPLETION_BONUS,
  applyXp,
  calculateSessionXp,
  deriveLevelFromXp,
  normalizeProgressXp,
  resolveProgressXp,
  resolveTotalXp,
  xpRequiredForLevel,
  xpToNextLevel,
};

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

/** @deprecated Prefer calculateFocusStreak from focusStreak.js */
export { calculateFocusStreak as calculateFocusStreakDays } from "./focusStreak.js";

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
 * @param {'distractionDomains' | 'productiveDomains'} field
 * @returns {string|null}
 */
function calculateTopDomain(sessions, field) {
  /** @type {Record<string, number>} */
  const totals = {};

  for (const session of sessions) {
    const domains = session[field] || {};
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
 * @param {FocusSession[]} sessions
 * @returns {string|null}
 */
export function calculateTopDistraction(sessions) {
  return calculateTopDomain(sessions, "distractionDomains");
}

/**
 * @param {FocusSession[]} sessions
 * @returns {string|null}
 */
export function calculateTopProductiveSite(sessions) {
  return calculateTopDomain(sessions, "productiveDomains");
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
 * Resolve stored level + progress XP (migrates legacy lifetime when needed).
 *
 * @param {ProfileStore} store
 * @returns {{ level: number, xp: number, xpForNextLevel: number, xpProgress: number }}
 */
export function resolveLevelProgress(store) {
  const normalized = normalizeProgressXp(store.level, store.xp, {
    xpModel: store.xpModel,
  });
  return {
    level: normalized.level,
    xp: normalized.xp,
    xpForNextLevel: normalized.xpForNextLevel,
    xpProgress:
      normalized.xpForNextLevel === 0
        ? 0
        : normalized.xp / normalized.xpForNextLevel,
  };
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
  const levelInfo = resolveLevelProgress(store);
  const focusStreak = calculateFocusStreak(sessions, now);
  const lastDay = latestCompletedFocusDate(sessions);

  return {
    hasSessions,
    characterHealth: health,
    characterHealthLabel: characterHealthLabel(health),
    focusStreakDays: focusStreak,
    lastCompletedFocusDate: lastDay,
    longestSessionMs,
    longestSessionLabel: formatDurationShort(longestSessionMs),
    sessionsCompleted: completed.length,
    topDistraction: calculateTopDistraction(sessions),
    topProductiveSite: calculateTopProductiveSite(sessions),
    level: levelInfo.level,
    xp: levelInfo.xp,
    xpIntoLevel: levelInfo.xp,
    xpForNextLevel: levelInfo.xpForNextLevel,
    xpProgress: levelInfo.xpProgress,
  };
}
