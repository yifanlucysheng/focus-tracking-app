/**
 * Focus Streak = consecutive calendar days with ≥1 completed focus session.
 * Uses local calendar dates (YYYY-MM-DD), not a rolling 24-hour window.
 */

/**
 * @param {number} epochMs
 * @returns {string} local calendar day YYYY-MM-DD
 */
export function calendarDayKey(epochMs) {
  const d = new Date(epochMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * @param {string} dayKey YYYY-MM-DD
 * @returns {string} previous local calendar day
 */
export function previousCalendarDay(dayKey) {
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() - 1);
  return calendarDayKey(date.getTime());
}

/**
 * @param {string} a YYYY-MM-DD
 * @param {string} b YYYY-MM-DD
 * @returns {number} whole calendar days from a → b (can be negative)
 */
export function calendarDaysBetween(a, b) {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const start = Date.UTC(ay, am - 1, ad);
  const end = Date.UTC(by, bm - 1, bd);
  return Math.round((end - start) / 86_400_000);
}

/**
 * Apply Focus Streak rules when a focus session completes on a calendar day.
 *
 * - Multiple sessions the same day → same streak
 * - Session yesterday + session today → streak + 1
 * - Last completed day more than one calendar day ago → reset to 1
 *
 * @param {{
 *   previousStreak: number,
 *   lastCompletedFocusDate: string|null|undefined,
 *   completedAt: number,
 * }} input
 * @returns {{ focusStreak: number, lastCompletedFocusDate: string }}
 */
export function updateFocusStreakOnSessionComplete({
  previousStreak,
  lastCompletedFocusDate,
  completedAt,
}) {
  const completedDay = calendarDayKey(completedAt);
  const prev = Math.max(0, Math.floor(Number(previousStreak) || 0));
  const last = lastCompletedFocusDate || null;

  if (last === completedDay) {
    return {
      focusStreak: Math.max(1, prev),
      lastCompletedFocusDate: completedDay,
    };
  }

  if (last && last === previousCalendarDay(completedDay)) {
    return {
      focusStreak: prev + 1,
      lastCompletedFocusDate: completedDay,
    };
  }

  return {
    focusStreak: 1,
    lastCompletedFocusDate: completedDay,
  };
}

/**
 * Recompute Focus Streak from completed sessions (source of truth for display / sync).
 * Counts consecutive local calendar days ending today, or yesterday if nothing today yet.
 *
 * @param {Array<{ completed?: boolean, endedAt?: number }>} sessions
 * @param {number} [now]
 * @returns {number}
 */
export function calculateFocusStreak(sessions, now = Date.now()) {
  const completedDays = new Set(
    (sessions || [])
      .filter((s) => s && s.completed && typeof s.endedAt === "number")
      .map((s) => calendarDayKey(s.endedAt))
  );

  if (completedDays.size === 0) return 0;

  let cursor = new Date(now);
  let key = calendarDayKey(cursor.getTime());

  if (!completedDays.has(key)) {
    cursor.setDate(cursor.getDate() - 1);
    key = calendarDayKey(cursor.getTime());
    if (!completedDays.has(key)) return 0;
  }

  let streak = 0;
  while (completedDays.has(key)) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
    key = calendarDayKey(cursor.getTime());
  }

  return streak;
}

/**
 * Latest completed focus calendar day from sessions, or null.
 *
 * @param {Array<{ completed?: boolean, endedAt?: number }>} sessions
 * @returns {string|null}
 */
export function latestCompletedFocusDate(sessions) {
  let latest = null;
  for (const session of sessions || []) {
    if (!session?.completed || typeof session.endedAt !== "number") continue;
    const key = calendarDayKey(session.endedAt);
    if (!latest || key > latest) latest = key;
  }
  return latest;
}
