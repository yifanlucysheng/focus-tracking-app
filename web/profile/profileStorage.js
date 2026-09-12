/** @typedef {import('./profileTypes.js').FocusSession} FocusSession */
/** @typedef {import('./profileTypes.js').ProfileStore} ProfileStore */

export const PROFILE_STORAGE_KEY = "focusBuddy.profileStats";

/** @returns {ProfileStore} */
export function createEmptyProfileStore() {
  return {
    sessions: [],
    xp: 0,
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

  const raw = /** @type {Partial<ProfileStore>} */ (value);
  const sessions = Array.isArray(raw.sessions)
    ? raw.sessions.filter((s) => s && typeof s === "object")
    : [];

  return {
    sessions: /** @type {FocusSession[]} */ (sessions),
    xp: typeof raw.xp === "number" && Number.isFinite(raw.xp) ? Math.max(0, raw.xp) : 0,
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
    return normalizeStore(JSON.parse(raw));
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
