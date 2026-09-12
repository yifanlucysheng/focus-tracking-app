/** @typedef {import('../web/profile/profileTypes.js').FocusSession} FocusSession */
/** @typedef {import('../web/profile/profileTypes.js').ProfileStore} ProfileStore */

import { normalizeProgressXp } from "../web/profile/xp.js";

export const PROFILE_STORAGE_KEY = "focusBuddy.profileStats";
export const PENDING_SYNC_KEY = "focusBuddy.pendingPublicSync";
export const PROCESSED_SESSIONS_KEY = "focusBuddy.processedSessionIds";

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
export function normalizeStore(value) {
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
 * Extension profile store in chrome.storage.local (service-worker safe).
 * @returns {Promise<ProfileStore>}
 */
export async function loadChromeProfileStore() {
  const result = await chrome.storage.local.get(PROFILE_STORAGE_KEY);
  const raw = result[PROFILE_STORAGE_KEY];
  const normalized = normalizeStore(raw);
  const hadModel =
    raw &&
    typeof raw === "object" &&
    /** @type {{ xpModel?: string }} */ (raw).xpModel === "progress";
  if (!hadModel && raw) {
    await chrome.storage.local.set({
      [PROFILE_STORAGE_KEY]: { ...normalized, updatedAt: Date.now() },
    });
  }
  return normalized;
}

/**
 * @param {ProfileStore} store
 * @returns {Promise<ProfileStore>}
 */
export async function saveChromeProfileStore(store) {
  const next = {
    ...normalizeStore(store),
    updatedAt: Date.now(),
  };
  await chrome.storage.local.set({ [PROFILE_STORAGE_KEY]: next });
  return next;
}

/**
 * @returns {Promise<string[]>}
 */
export async function loadProcessedSessionIds() {
  const result = await chrome.storage.local.get(PROCESSED_SESSIONS_KEY);
  const list = result[PROCESSED_SESSIONS_KEY];
  return Array.isArray(list) ? list.map(String) : [];
}

/**
 * @param {string} sessionId
 */
export async function markSessionProcessed(sessionId) {
  const ids = await loadProcessedSessionIds();
  if (ids.includes(sessionId)) return;
  const next = [...ids, sessionId].slice(-200);
  await chrome.storage.local.set({ [PROCESSED_SESSIONS_KEY]: next });
}

/**
 * @typedef {Object} PendingPublicSync
 * @property {string} userId
 * @property {number} xp
 * @property {number} focus_level
 * @property {number} [focus_streak]
 * @property {number} [focus_flame]
 * @property {number} [longest_session_ms]
 * @property {number} [sessions_completed]
 * @property {string|null} [top_distraction]
 * @property {string|null} [top_productive_site]
 * @property {number} [character_health]
 * @property {string} [sessionId]
 * @property {number} updatedAt
 */

/**
 * @returns {Promise<PendingPublicSync[]>}
 */
export async function loadPendingPublicSync() {
  const result = await chrome.storage.local.get(PENDING_SYNC_KEY);
  const list = result[PENDING_SYNC_KEY];
  return Array.isArray(list) ? list : [];
}

/**
 * @param {PendingPublicSync[]} queue
 */
export async function savePendingPublicSync(queue) {
  await chrome.storage.local.set({ [PENDING_SYNC_KEY]: queue });
}
