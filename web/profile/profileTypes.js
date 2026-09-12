/**
 * @typedef {'on-task' | 'distracted'} FocusStatus
 */

/**
 * A completed (or attempted) focus session.
 * Ready for extension sync later; empty on the website for now.
 *
 * @typedef {Object} FocusSession
 * @property {string} id
 * @property {number} startedAt - epoch ms
 * @property {number} endedAt - epoch ms
 * @property {number} durationMs
 * @property {boolean} completed
 * @property {string} [task]
 * @property {number} [onTaskRatio] - 0–1
 * @property {number} [longestLockInMs] - longest uninterrupted on-task stretch
 * @property {Record<string, number>} [distractionDomains] - domain → hit count
 */

/**
 * Persisted profile bag (localStorage now; chrome.storage.local later).
 *
 * @typedef {Object} ProfileStore
 * @property {FocusSession[]} sessions
 * @property {number} xp - lifetime focused XP
 * @property {number} updatedAt - epoch ms
 */

/**
 * Derived view-model for the Personal Stats UI.
 *
 * @typedef {Object} ProfileStatsView
 * @property {boolean} hasSessions
 * @property {number} characterHealth - 0–100
 * @property {string} characterHealthLabel
 * @property {number} focusStreakDays
 * @property {number} longestSessionMs
 * @property {string} longestSessionLabel
 * @property {number} sessionsCompleted
 * @property {string|null} topDistraction
 * @property {number} level
 * @property {number} xp
 * @property {number} xpIntoLevel
 * @property {number} xpForNextLevel
 * @property {number} xpProgress - 0–1 toward next level
 */

export {};
