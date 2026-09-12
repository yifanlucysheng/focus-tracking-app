/** @typedef {import('./friendTypes.js').FriendProfile} FriendProfile */
/** @typedef {import('./friendTypes.js').LeaderboardMode} LeaderboardMode */
/** @typedef {import('./friendTypes.js').LeaderboardEntry} LeaderboardEntry */
/** @typedef {import('./friendTypes.js').LeaderboardView} LeaderboardView */

/**
 * @param {FriendProfile} a
 * @param {FriendProfile} b
 * @param {LeaderboardMode} mode
 * @returns {number}
 */
function compareProfiles(a, b, mode) {
  if (mode === "streak") {
    // Focus Streak mode
    if (b.focusStreak !== a.focusStreak) return b.focusStreak - a.focusStreak;
    return String(a.username).localeCompare(String(b.username));
  }

  // Focus Level mode: level desc, xp tie-breaker
  if (b.focusLevel !== a.focusLevel) return b.focusLevel - a.focusLevel;
  if (b.xp !== a.xp) return b.xp - a.xp;
  return String(a.username).localeCompare(String(b.username));
}

/**
 * @param {FriendProfile[]} profiles
 * @param {LeaderboardMode} mode
 * @returns {LeaderboardEntry[]}
 */
export function rankByMode(profiles, mode) {
  const sorted = [...profiles].sort((a, b) => compareProfiles(a, b, mode));
  return sorted.map((profile, index) => ({
    rank: index + 1,
    profile,
  }));
}

/**
 * @param {LeaderboardEntry[]} entries
 * @param {string} userId
 * @returns {number} 1-based rank, or 0 if missing
 */
export function findUserRank(entries, userId) {
  const found = entries.find((entry) => entry.profile.id === userId);
  return found ? found.rank : 0;
}

/**
 * Highest-ranked friend who is not the current user.
 *
 * @param {LeaderboardEntry[]} entries
 * @param {string} userId
 * @returns {FriendProfile|null}
 */
export function findTopFriend(entries, userId) {
  const top = entries.find((entry) => entry.profile.id !== userId);
  return top ? top.profile : null;
}

/**
 * @param {LeaderboardEntry[]} entries
 * @param {string} userId
 * @param {LeaderboardMode} mode
 * @returns {string}
 */
export function generateComparisonMessage(entries, userId, mode) {
  const you = entries.find((entry) => entry.profile.id === userId);
  if (!you) return "Add some friends to start your leaderboard!";

  const friendsOnly = entries.filter((entry) => entry.profile.id !== userId);
  if (friendsOnly.length === 0) {
    return "Add some friends to start your leaderboard!";
  }

  const yourRank = you.rank;
  const groupSize = entries.length;

  if (mode === "streak") {
    const ahead = friendsOnly.filter(
      (entry) => entry.profile.focusStreak > you.profile.focusStreak
    );
    if (ahead.length === 0) {
      return "You have the hottest Focus Streak in your group.";
    }

    const leader = ahead[0].profile;
    const gap = leader.focusStreak - you.profile.focusStreak;
    if (gap === 1) {
      return `You're 1 day behind ${leader.username}'s Focus Streak.`;
    }
    return `You're ${gap} days behind ${leader.username}'s Focus Streak.`;
  }

  // Level mode
  if (yourRank === 1) {
    return "You have the highest Focus Level in your group.";
  }

  const lowerCount = friendsOnly.filter(
    (entry) =>
      entry.profile.focusLevel < you.profile.focusLevel ||
      (entry.profile.focusLevel === you.profile.focusLevel &&
        entry.profile.xp < you.profile.xp)
  ).length;

  const percent = Math.round((lowerCount / friendsOnly.length) * 100);
  if (percent <= 0) {
    return `You're #${yourRank} out of ${groupSize} friends`;
  }

  return `Your Focus Level is higher than ${percent}% of your friends.`;
}

/**
 * @param {FriendProfile[]} profiles - includes current user
 * @param {string} userId
 * @param {LeaderboardMode} mode
 * @returns {LeaderboardView}
 */
export function buildLeaderboardView(profiles, userId, mode) {
  const friendsOnly = profiles.filter((p) => p.id !== userId && !p.isCurrentUser);
  if (friendsOnly.length === 0) {
    return {
      mode,
      entries: [],
      yourRank: 0,
      totalFriends: 0,
      topFriend: null,
      comparisonMessage: "Add some friends to start your leaderboard!",
    };
  }

  const entries = rankByMode(profiles, mode);
  const yourRank = findUserRank(entries, userId);
  const topFriend = findTopFriend(entries, userId);

  return {
    mode,
    entries,
    yourRank,
    totalFriends: profiles.length,
    topFriend,
    comparisonMessage: generateComparisonMessage(entries, userId, mode),
  };
}

/**
 * Build the current-user FriendProfile from Personal Stats / Supabase profile values.
 *
 * @param {{ id?: string, level: number, xp: number, focusStreakDays: number, characterId?: string, characterHealth?: number, username?: string }} stats
 * @returns {FriendProfile}
 */
export function currentUserAsFriend(stats) {
  return {
    id: stats.id || "current-user",
    username: stats.username || "You",
    focusLevel: stats.level || 1,
    xp: stats.xp || 0,
    focusStreak: stats.focusStreakDays || 0,
    characterId: stats.characterId || "sleepbunny",
    characterHealth: Number.isFinite(Number(stats.characterHealth))
      ? Math.max(0, Math.min(100, Math.floor(Number(stats.characterHealth))))
      : 100,
    isCurrentUser: true,
    isMock: false,
  };
}
