/**
 * DEMO ONLY — fake friend profiles for UI testing.
 * Replace / delete when a real friends backend exists.
 * Nothing here connects to real user accounts.
 */

/** @typedef {import('./friendTypes.js').FriendProfile} FriendProfile */

/** @type {FriendProfile[]} */
export const MOCK_FRIENDS = [
  {
    id: "mock-maya",
    username: "Maya",
    focusLevel: 6,
    xp: 420,
    focusStreak: 9,
    characterId: "cat",
    isMock: true,
  },
  {
    id: "mock-jordan",
    username: "Jordan",
    focusLevel: 4,
    xp: 210,
    focusStreak: 3,
    characterId: "sleepbunny",
    isMock: true,
  },
  {
    id: "mock-sam",
    username: "Sam",
    focusLevel: 5,
    xp: 310,
    focusStreak: 5,
    characterId: "cat",
    isMock: true,
  },
  {
    id: "mock-riley",
    username: "Riley",
    focusLevel: 2,
    xp: 80,
    focusStreak: 1,
    characterId: "sleepbunny",
    isMock: true,
  },
  {
    id: "mock-alex",
    username: "Alex",
    focusLevel: 7,
    xp: 540,
    focusStreak: 4,
    characterId: "cat",
    isMock: true,
  },
];
