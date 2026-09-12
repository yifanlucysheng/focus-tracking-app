import { loadSelectedCharacterId } from "./characters.js";
import { mountSectionDivider, mountSiteNav } from "./layout.js";
import { bootCloudSync } from "./session-sync.js";
import { calculateProfileStats } from "./profile/calculateStats.js";
import { loadProfileStoreAsync } from "./profile/profileStorage.js";
import {
  loadPublicProfileFromSupabase,
  mergePublicProfileIntoStats,
} from "./profile/profileService.js";
import {
  acceptFriendRequest,
  getAcceptedFriends,
  getActiveFriendshipWith,
  getIncomingPendingRequests,
  profileToFriendProfile,
  rejectFriendRequest,
  searchUserByUsername,
  sendFriendRequest,
} from "./friends/friendsService.js";
import {
  buildLeaderboardView,
  currentUserAsFriend,
} from "./friends/calculateLeaderboard.js";
import { renderFriendsLeaderboard } from "./friends/renderFriends.js";
import {
  getCachedProfile,
  setCachedProfile,
} from "./auth/authService.js";
import { currentUid, isCloudConfigured, listenAuth } from "./cloud.js";

const friendsRoot = document.getElementById("friends-root");
/** @type {'level' | 'streak'} */
let leaderboardMode = "level";
let friendsAddInput = "";
/** @type {{ kind: 'idle' | 'error' | 'success' | 'loading', message: string }} */
let friendsAddStatus = { kind: "idle", message: "" };
let friendsAddBusy = false;
/** @type {string|null} */
let friendsRequestActionId = null;
let friendsRequestsError = "";
let friendsLeaderboardLoading = false;
let friendsLeaderboardError = "";
/** @type {import('./friends/friendsService.js').FriendshipWithProfiles[]} */
let incomingFriendRequests = [];
/** @type {Array<{ friendship: import('./friends/friendsService.js').FriendshipRow, friend: import('./auth/authService.js').ProfileRow }>} */
let acceptedFriends = [];

mountSiteNav("friends");
mountSectionDivider("Friends");

async function refresh() {
  if (!friendsRoot) return;

  if (!isCloudConfigured() || !currentUid()) {
    const store = await loadProfileStoreAsync();
    const stats = calculateProfileStats(store);
    const you = currentUserAsFriend({
      level: stats.level,
      xp: stats.xp,
      focusStreakDays: stats.focusStreakDays,
      characterId: loadSelectedCharacterId(),
      username: "You",
    });
    const view = buildLeaderboardView([you], you.id, leaderboardMode);
    renderFriendsLeaderboard(friendsRoot, view, {
      username: "You",
      addInputValue: friendsAddInput,
      addBusy: false,
      addStatus: {
        kind: "error",
        message: isCloudConfigured()
          ? "Sign in on the Settings page to add friends by username."
          : "Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.local to use friends.",
      },
      incomingRequests: [],
      onModeChange: (mode) => {
        leaderboardMode = mode;
        refresh();
      },
      onAddFriend: () => {
        friendsAddStatus = {
          kind: "error",
          message: "Sign in on Settings to add friends.",
        };
        refresh();
      },
    });
    return;
  }

  friendsLeaderboardLoading = true;
  renderShell();

  try {
    let profile = getCachedProfile();
    try {
      profile = (await loadPublicProfileFromSupabase()) || profile;
      if (profile) setCachedProfile(profile);
    } catch {
      // Keep cache.
    }

    const store = await loadProfileStoreAsync();
    const localStats = calculateProfileStats(store);
    const stats = mergePublicProfileIntoStats(localStats, profile);

    const [incoming, accepted] = await Promise.all([
      getIncomingPendingRequests(),
      getAcceptedFriends(),
    ]);
    incomingFriendRequests = incoming;
    acceptedFriends = accepted;
    friendsLeaderboardError = "";
    friendsRequestsError = "";

    const you = profile
      ? profileToFriendProfile(profile, {
          isCurrentUser: true,
          characterId: loadSelectedCharacterId(),
        })
      : currentUserAsFriend({
          level: stats.level,
          xp: stats.xp,
          focusStreakDays: stats.focusStreakDays,
          characterId: loadSelectedCharacterId(),
          username: "You",
        });

    const friendProfiles = acceptedFriends.map(({ friend }) =>
      profileToFriendProfile(friend)
    );
    const group = [you, ...friendProfiles];
    const view = buildLeaderboardView(group, you.id, leaderboardMode);

    renderFriendsLeaderboard(friendsRoot, view, {
      username: profile?.username || "You",
      addInputValue: friendsAddInput,
      addBusy: friendsAddBusy,
      addStatus: friendsAddStatus,
      incomingRequests: incomingFriendRequests,
      requestActionId: friendsRequestActionId,
      requestsError: friendsRequestsError,
      leaderboardLoading: false,
      leaderboardError: friendsLeaderboardError,
      onModeChange: (mode) => {
        leaderboardMode = mode;
        refresh();
      },
      onAddFriend: (username) => {
        void handleAddFriend(username);
      },
      onAcceptRequest: (friendshipId) => {
        void handleAcceptRequest(friendshipId);
      },
      onDeclineRequest: (friendshipId) => {
        void handleDeclineRequest(friendshipId);
      },
    });
  } catch (err) {
    friendsLeaderboardError = err?.message || "Could not load friends.";
    friendsRequestsError = friendsLeaderboardError;
    renderShell();
  } finally {
    friendsLeaderboardLoading = false;
  }
}

function renderShell() {
  if (!friendsRoot) return;
  const store = loadProfileStoreAsync;
  void store().then((localStore) => {
    const stats = calculateProfileStats(localStore);
    const profile = getCachedProfile();
    const you = profile
      ? profileToFriendProfile(profile, {
          isCurrentUser: true,
          characterId: loadSelectedCharacterId(),
        })
      : currentUserAsFriend({
          level: stats.level,
          xp: stats.xp,
          focusStreakDays: stats.focusStreakDays,
          characterId: loadSelectedCharacterId(),
          username: "You",
        });
    const friendProfiles = acceptedFriends.map(({ friend }) =>
      profileToFriendProfile(friend)
    );
    const view = buildLeaderboardView(
      [you, ...friendProfiles],
      you.id,
      leaderboardMode
    );
    renderFriendsLeaderboard(friendsRoot, view, {
      username: profile?.username || "You",
      addInputValue: friendsAddInput,
      addBusy: friendsAddBusy,
      addStatus: friendsAddStatus,
      incomingRequests: incomingFriendRequests,
      requestActionId: friendsRequestActionId,
      requestsError: friendsRequestsError,
      leaderboardLoading: friendsLeaderboardLoading,
      leaderboardError: friendsLeaderboardError,
      onModeChange: (mode) => {
        leaderboardMode = mode;
        refresh();
      },
      onAddFriend: (username) => {
        void handleAddFriend(username);
      },
      onAcceptRequest: (id) => {
        void handleAcceptRequest(id);
      },
      onDeclineRequest: (id) => {
        void handleDeclineRequest(id);
      },
    });
  });
}

async function handleAddFriend(username) {
  friendsAddInput = username;
  if (!username.trim()) {
    friendsAddStatus = { kind: "error", message: "Enter a username." };
    await refresh();
    return;
  }

  friendsAddBusy = true;
  friendsAddStatus = { kind: "loading", message: "Looking up user…" };
  await refresh();

  try {
    const me = getCachedProfile();
    if (!me?.id) throw new Error("You must be signed in.");

    const target = await searchUserByUsername(username);
    if (!target) {
      friendsAddStatus = { kind: "error", message: "User not found" };
      return;
    }
    if (target.id === me.id) {
      friendsAddStatus = { kind: "error", message: "You can't add yourself" };
      return;
    }

    const existing = await getActiveFriendshipWith(target.id);
    if (existing?.status === "accepted") {
      friendsAddStatus = { kind: "error", message: "You're already friends" };
      return;
    }
    if (existing?.status === "pending") {
      friendsAddStatus = {
        kind: "error",
        message: "Friend request already pending",
      };
      return;
    }

    await sendFriendRequest(target.id);
    friendsAddInput = "";
    friendsAddStatus = {
      kind: "success",
      message: `Friend request sent to @${target.username}`,
    };
  } catch (err) {
    friendsAddStatus = {
      kind: "error",
      message: err?.message || "Could not send friend request.",
    };
  } finally {
    friendsAddBusy = false;
    await refresh();
  }
}

async function handleAcceptRequest(friendshipId) {
  if (friendsRequestActionId) return;
  friendsRequestActionId = friendshipId;
  friendsRequestsError = "";
  await refresh();
  try {
    await acceptFriendRequest(friendshipId);
  } catch (err) {
    friendsRequestsError = err?.message || "Could not accept request.";
  } finally {
    friendsRequestActionId = null;
    await refresh();
  }
}

async function handleDeclineRequest(friendshipId) {
  if (friendsRequestActionId) return;
  friendsRequestActionId = friendshipId;
  friendsRequestsError = "";
  await refresh();
  try {
    await rejectFriendRequest(friendshipId);
  } catch (err) {
    friendsRequestsError = err?.message || "Could not decline request.";
  } finally {
    friendsRequestActionId = null;
    await refresh();
  }
}

await bootCloudSync();
if (isCloudConfigured()) {
  await listenAuth(() => refresh());
} else {
  refresh();
}
