import { loadSelectedCharacterId } from "./characters.js";
import { mountSectionDivider, mountSiteNav } from "./layout.js";
import { bootCloudSync } from "./session-sync.js";
import { calculateProfileStats } from "./profile/calculateStats.js";
import { loadProfileStoreAsync } from "./profile/profileStorage.js";
import {
  acceptFriendRequest,
  currentUid,
  isCloudConfigured,
  listIncomingRequests,
  listenAuth,
  loadFriendsActivity,
  loadOwnPublicStats,
  loadUserDoc,
  rejectFriendRequest,
  sendFriendRequest,
} from "./cloud.js";
import { buildLeaderboardView, currentUserAsFriend } from "./friends/calculateLeaderboard.js";
import { renderFriendsLeaderboard } from "./friends/renderFriends.js";

const friendsRoot = document.getElementById("friends-root");
/** @type {'level' | 'streak'} */
let leaderboardMode = "level";
let friendsAddInput = "";
/** @type {{ kind: 'idle' | 'error' | 'success' | 'loading', message: string }} */
let friendsAddStatus = { kind: "idle", message: "" };
let friendsAddBusy = false;
/** @type {string|null} */
let requestActionId = null;
let requestsError = "";

mountSiteNav("friends");
mountSectionDivider("Friends");

/**
 * @param {string} username
 */
async function handleAddFriend(username) {
  const trimmed = String(username || "").trim();
  friendsAddInput = trimmed;

  if (!trimmed) {
    friendsAddStatus = { kind: "error", message: "Enter a username." };
    await refresh();
    return;
  }

  if (!isCloudConfigured() || !currentUid()) {
    friendsAddStatus = {
      kind: "error",
      message: "Sign in on the Settings page to add friends.",
    };
    await refresh();
    return;
  }

  friendsAddBusy = true;
  friendsAddStatus = { kind: "loading", message: "Sending…" };
  await refresh();

  try {
    await sendFriendRequest(trimmed);
    friendsAddInput = "";
    friendsAddStatus = { kind: "success", message: "Sent!" };
  } catch (error) {
    friendsAddStatus = {
      kind: "error",
      message: error?.message || "Could not send friend request.",
    };
  } finally {
    friendsAddBusy = false;
    await refresh();
  }
}

/**
 * Map Firebase incoming docs into the shape renderFriends expects.
 * @param {Array<{ id: string, fromUid?: string, fromUsername?: string }>} requests
 */
function mapIncomingRequests(requests) {
  return requests.map((req) => {
    const fromUid = req.fromUid || req.id;
    return {
      id: fromUid,
      requester: {
        id: fromUid,
        username: req.fromUsername || "unknown",
      },
    };
  });
}

/**
 * @param {string} fromUid
 * @param {'accept' | 'deny'} action
 */
async function handleRequestAction(fromUid, action) {
  if (!fromUid || requestActionId) return;
  requestActionId = fromUid;
  requestsError = "";
  await refresh();

  try {
    if (action === "accept") {
      await acceptFriendRequest(fromUid);
    } else {
      await rejectFriendRequest(fromUid);
    }
  } catch (error) {
    requestsError =
      error?.message ||
      (action === "accept"
        ? "Could not accept friend request."
        : "Could not deny friend request.");
  } finally {
    requestActionId = null;
    await refresh();
  }
}

/**
 * @param {object} handlers
 */
function renderHandlers(handlers) {
  return {
    addInputValue: friendsAddInput,
    addBusy: friendsAddBusy,
    addStatus: friendsAddStatus,
    requestActionId,
    requestsError,
    onModeChange: (mode) => {
      leaderboardMode = mode;
      refresh();
    },
    onAddFriend: (username) => {
      void handleAddFriend(username);
    },
    onAcceptRequest: (id) => {
      void handleRequestAction(id, "accept");
    },
    onDeclineRequest: (id) => {
      void handleRequestAction(id, "deny");
    },
    ...handlers,
  };
}

async function refresh() {
  if (!friendsRoot) return;
  const bootNote = isCloudConfigured()
    ? ""
    : "Add Firebase keys in web/firebase-config.js to use real friends.";

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
    renderFriendsLeaderboard(
      friendsRoot,
      view,
      renderHandlers({
        username: "You",
        addStatus:
          friendsAddStatus.kind === "idle" && bootNote
            ? { kind: "error", message: bootNote || "Sign in on Settings to add friends." }
            : friendsAddStatus,
        incomingRequests: [],
      })
    );
    return;
  }

  const me = await loadUserDoc();
  const myStats = (await loadOwnPublicStats()) || {};
  const you = currentUserAsFriend({
    level: myStats.level || 1,
    xp: myStats.xp || 0,
    focusStreakDays: myStats.streakDays || 0,
    characterId: me?.characterId || loadSelectedCharacterId(),
    username: me?.username || "You",
  });

  const friends = await loadFriendsActivity();
  const group = [
    you,
    ...friends.map((friend) => ({
      id: friend.id,
      username: friend.username,
      focusLevel: friend.stats?.level || 1,
      xp: friend.stats?.xp || 0,
      focusStreak: friend.stats?.streakDays || 0,
      characterId: friend.characterId,
      isMock: false,
      hiddenStats: !friend.shareStats,
    })),
  ];

  const comparable = group.map((p) =>
    p.hiddenStats ? { ...p, focusLevel: 0, xp: 0, focusStreak: 0 } : p
  );
  const view = buildLeaderboardView(comparable, you.id, leaderboardMode);
  const requests = mapIncomingRequests(await listIncomingRequests());

  renderFriendsLeaderboard(
    friendsRoot,
    view,
    renderHandlers({
      username: me?.username || "You",
      incomingRequests: requests,
    })
  );

  // Keep "Stats hidden" for friends who opted out; otherwise leave the shared label format.
  friendsRoot.querySelectorAll(".friends-leaderboard .friends-row-meta").forEach((meta, index) => {
    const entry = view.entries[index];
    const friend = friends.find((item) => item.id === entry?.profile.id);
    if (!friend) return;
    if (!friend.shareStats) {
      meta.textContent = "Stats hidden";
    }
  });
}

await bootCloudSync();
if (isCloudConfigured()) {
  await listenAuth(() => refresh());
} else {
  refresh();
}
