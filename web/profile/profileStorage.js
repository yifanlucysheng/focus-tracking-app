/** @typedef {import('./profileTypes.js').FocusSession} FocusSession */
/** @typedef {import('./profileTypes.js').ProfileStore} ProfileStore */

import { normalizeProgressXp } from "./xp.js";

export const PROFILE_STORAGE_KEY = "focusBuddy.profileStats";

/** @returns {ProfileStore} */
export function createEmptyProfileStore() {
  return {
    sessions: [],
    level: 1,
    xp: 0,
    xpModel: "progress",
    focusStreak: 0,
    lastCompletedFocusDate: null,
    updatedAt: Date.now(),
  };
}

/**
 * @param {unknown} value
 * @returns {ProfileStore}
 */
function normalizeStore(value) {
  const empty = createEmptyProfileStore();
  if (!value || typeof value !== "object") return empty;

  const raw = /** @type {Partial<ProfileStore> & { focusFlame?: number }} */ (value);
  const sessions = Array.isArray(raw.sessions)
    ? raw.sessions.filter((s) => s && typeof s === "object")
    : [];

  const lastCompletedFocusDate =
    typeof raw.lastCompletedFocusDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(raw.lastCompletedFocusDate)
      ? raw.lastCompletedFocusDate
      : null;

  const legacyFlame =
    typeof raw.focusFlame === "number" && Number.isFinite(raw.focusFlame)
      ? Math.max(0, Math.floor(raw.focusFlame))
      : 0;
  const focusStreak =
    typeof raw.focusStreak === "number" && Number.isFinite(raw.focusStreak)
      ? Math.max(0, Math.floor(raw.focusStreak))
      : legacyFlame;

  const rawXp =
    typeof raw.xp === "number" && Number.isFinite(raw.xp) ? Math.max(0, raw.xp) : 0;
  const rawLevel =
    typeof raw.level === "number" && Number.isFinite(raw.level)
      ? Math.max(1, Math.floor(raw.level))
      : 1;
  const xpModel = raw.xpModel === "progress" ? "progress" : null;
  const progress = normalizeProgressXp(rawLevel, rawXp, { xpModel });

  return {
    sessions: /** @type {FocusSession[]} */ (sessions),
    level: progress.level,
    xp: progress.xp,
    xpModel: "progress",
    focusStreak,
    lastCompletedFocusDate,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now(),
  };
}

/**
 * Website uses localStorage today.
 * Later: swap this to chrome.storage.local when syncing with the extension.
 *
 * @returns {ProfileStore}
 */
export function loadProfileStore() {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return createEmptyProfileStore();
    const parsed = JSON.parse(raw);
    const normalized = normalizeStore(parsed);
    // Persist one-time legacy → progress migration so xpModel sticks.
    const hadModel =
      parsed &&
      typeof parsed === "object" &&
      /** @type {{ xpModel?: string }} */ (parsed).xpModel === "progress";
    if (!hadModel) {
      try {
        localStorage.setItem(
          PROFILE_STORAGE_KEY,
          JSON.stringify({ ...normalized, updatedAt: Date.now() })
        );
      } catch {
        // Ignore quota / private mode errors.
      }
    }
    return normalized;
  } catch {
    return createEmptyProfileStore();
  }
}

/**
 * @param {ProfileStore} store
 */
export function saveProfileStore(store) {
  const next = {
    ...normalizeStore(store),
    updatedAt: Date.now(),
  };

  try {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore quota / private mode errors.
  }

  return next;
}
