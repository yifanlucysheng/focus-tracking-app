/**
 * FocusBuddy XP + leveling utilities.
 *
 * Storage model: current level + XP toward the next level (not lifetime XP).
 * Legacy lifetime XP used the old curve 100 + (L-1)*50; migrate with migrateLegacyLifetimeXp.
 */

/** XP earned per focused minute. */
export const XP_PER_FOCUSED_MINUTE = 15;

/** Flat bonus when a focus session is marked completed. */
export const XP_SESSION_COMPLETION_BONUS = 25;

/**
 * XP required to advance from the current level to the next.
 * XP_next = 75 + 20L + 5L²
 *
 * @param {number} level - current level (L)
 * @returns {number}
 */
export function xpToNextLevel(level) {
  const L = Math.max(1, Math.floor(Number(level) || 1));
  return 75 + 20 * L + 5 * L * L;
}

/** @deprecated Prefer xpToNextLevel */
export const xpRequiredForLevel = xpToNextLevel;

/**
 * @param {number} focusedMinutes
 * @param {boolean} [completed=true]
 * @returns {number}
 */
export function calculateSessionXp(focusedMinutes, completed = true) {
  const minutes = Math.max(0, Math.floor(Number(focusedMinutes) || 0));
  const base = minutes * XP_PER_FOCUSED_MINUTE;
  const bonus = completed ? XP_SESSION_COMPLETION_BONUS : 0;
  return base + bonus;
}

/**
 * Apply earned XP onto current level progress. Supports multi-level ups.
 *
 * @param {number} currentLevel
 * @param {number} currentXp - XP toward next level
 * @param {number} xpEarned
 * @returns {{ level: number, xp: number, levelsGained: number, xpForNextLevel: number }}
 */
export function applyXp(currentLevel, currentXp, xpEarned) {
  let level = Math.max(1, Math.floor(Number(currentLevel) || 1));
  let xp = Math.max(0, Math.floor(Number(currentXp) || 0));
  const earned = Math.max(0, Math.floor(Number(xpEarned) || 0));
  let levelsGained = 0;

  xp += earned;

  while (xp >= xpToNextLevel(level)) {
    xp -= xpToNextLevel(level);
    level += 1;
    levelsGained += 1;
    if (level > 9999) {
      xp = 0;
      break;
    }
  }

  return {
    level,
    xp,
    levelsGained,
    xpForNextLevel: xpToNextLevel(level),
  };
}

/* -------------------------------------------------------------------------- */
/* Legacy lifetime XP (pre–progress model): 100 + (L-1)*50 per level          */
/* -------------------------------------------------------------------------- */

/**
 * @param {number} level
 * @returns {number}
 */
export function legacyXpRequiredForLevel(level) {
  const safeLevel = Math.max(1, Math.floor(Number(level) || 1));
  return 100 + (safeLevel - 1) * 50;
}

/**
 * Minimum lifetime XP required to have reached `level` under the old curve.
 * @param {number} level
 * @returns {number}
 */
export function legacyLifetimeXpToReachLevel(level) {
  const safeLevel = Math.max(1, Math.floor(Number(level) || 1));
  let total = 0;
  for (let l = 1; l < safeLevel; l += 1) {
    total += legacyXpRequiredForLevel(l);
  }
  return total;
}

/**
 * Convert legacy lifetime XP → { level, xp toward next } using the old curve,
 * then report next-threshold with the new curve.
 *
 * @param {number} totalXp - legacy lifetime XP
 * @returns {{ level: number, xp: number, xpForNextLevel: number }}
 */
export function migrateLegacyLifetimeXp(totalXp) {
  let xp = Math.max(0, Math.floor(Number(totalXp) || 0));
  let level = 1;

  while (xp >= legacyXpRequiredForLevel(level)) {
    xp -= legacyXpRequiredForLevel(level);
    level += 1;
    if (level > 999) break;
  }

  return {
    level,
    xp,
    xpForNextLevel: xpToNextLevel(level),
  };
}

/**
 * Normalize level + xp into the progress model.
 *
 * - `xpModel: "progress"` → trust values (clamp overflow with applyXp)
 * - otherwise, if xp cannot be valid progress for `focusLevel` (xp >= new threshold)
 *   OR xp is at least the old lifetime total to reach that level → migrate as lifetime
 * - else trust as progress
 *
 * Prefer running `supabase/migrate_xp_to_progress.sql` so cloud rows are converted once.
 *
 * @param {number} focusLevel
 * @param {number} xp
 * @param {{ xpModel?: string|null }} [hints]
 * @returns {{ level: number, xp: number, xpForNextLevel: number, migrated: boolean }}
 */
export function normalizeProgressXp(focusLevel, xp, hints = {}) {
  const levelHint = Math.max(1, Math.floor(Number(focusLevel) || 1));
  const rawXp = Math.max(0, Math.floor(Number(xp) || 0));

  if (hints.xpModel === "progress") {
    const applied = applyXp(levelHint, rawXp, 0);
    return {
      level: applied.level,
      xp: applied.xp,
      xpForNextLevel: applied.xpForNextLevel,
      migrated: false,
    };
  }

  const reachNextLevel = legacyLifetimeXpToReachLevel(levelHint + 1);
  const next = xpToNextLevel(levelHint);
  const cannotBeProgress = rawXp >= next;
  // Lifetime totals that clearly exceed this level under the old curve.
  const pastThisLevelAsLifetime = rawXp >= reachNextLevel;

  if (cannotBeProgress || pastThisLevelAsLifetime) {
    const migrated = migrateLegacyLifetimeXp(rawXp);
    return {
      level: migrated.level,
      xp: migrated.xp,
      xpForNextLevel: migrated.xpForNextLevel,
      migrated: true,
    };
  }

  const applied = applyXp(levelHint, rawXp, 0);
  return {
    level: applied.level,
    xp: applied.xp,
    xpForNextLevel: applied.xpForNextLevel,
    migrated: false,
  };
}

/**
 * Compare progress states: true if `a` is strictly ahead of `b`.
 * @param {{ level: number, xp: number }} a
 * @param {{ level: number, xp: number }} b
 */
export function isProgressAhead(a, b) {
  const aLevel = Math.max(1, Math.floor(Number(a?.level) || 1));
  const bLevel = Math.max(1, Math.floor(Number(b?.level) || 1));
  if (aLevel !== bLevel) return aLevel > bLevel;
  return (
    Math.max(0, Math.floor(Number(a?.xp) || 0)) >
    Math.max(0, Math.floor(Number(b?.xp) || 0))
  );
}

/**
 * @param {{ xp?: number }} store
 * @returns {number} XP toward next level
 */
export function resolveProgressXp(store) {
  return Math.max(0, Math.floor(Number(store?.xp) || 0));
}

/** @deprecated Use resolveProgressXp */
export const resolveTotalXp = resolveProgressXp;

/**
 * @deprecated Prefer stored level + applyXp. Interprets value as legacy lifetime XP.
 * @param {number} totalXp
 */
export function deriveLevelFromXp(totalXp) {
  const migrated = migrateLegacyLifetimeXp(totalXp);
  return {
    level: migrated.level,
    xpIntoLevel: migrated.xp,
    xpForNextLevel: migrated.xpForNextLevel,
    xpProgress:
      migrated.xpForNextLevel === 0 ? 0 : migrated.xp / migrated.xpForNextLevel,
  };
}
