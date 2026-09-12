/**
 * @typedef {Object} FriendProfile
 * @property {string} id
 * @property {string} username
 * @property {number} focusLevel
 * @property {number} xp
 * @property {number} focusStreak - Focus Flame value (from profiles.focus_flame)
 * @property {string} [characterId] - optional buddy icon: "cat" | "sleepbunny"
 * @property {boolean} [isCurrentUser]
 * @property {boolean} [isMock] - true for demo friends (easy to strip later)
 */

/**
 * @typedef {'level' | 'streak'} LeaderboardMode
 */

/**
 * @typedef {Object} LeaderboardEntry
 * @property {number} rank
 * @property {FriendProfile} profile
 */

/**
 * @typedef {Object} LeaderboardView
 * @property {LeaderboardMode} mode
 * @property {LeaderboardEntry[]} entries
 * @property {number} yourRank
 * @property {number} totalFriends - includes current user in the group size
 * @property {FriendProfile|null} topFriend - highest-ranked friend (not you)
 * @property {string} comparisonMessage
 */

export {};
