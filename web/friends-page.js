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
  sendFriendRequest,
} from "./cloud.js";
import { buildLeaderboardView, currentUserAsFriend } from "./friends/calculateLeaderboard.js";
import { renderFriendsLeaderboard } from "./friends/renderFriends.js";

const friendsRoot = document.getElementById("friends-root");
/** @type {'level' | 'streak'} */
let leaderboardMode = "level";

mountSiteNav("friends");
mountSectionDivider("Friends");

function formatWeekly(ms) {
  const minutes = Math.round((Number(ms) || 0) / 60000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
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
    renderFriendsLeaderboard(friendsRoot, view, {
      demoNotice: bootNote || "Sign in on the Settings page to add friends by username.",
      onModeChange: (mode) => {
        leaderboardMode = mode;
        refresh();
      },
      onAddFriend: async (username) => {
        try {
          await sendFriendRequest(username);
          refresh();
        } catch (error) {
          const note = friendsRoot.querySelector(".friends-demo-note");
          if (note) note.textContent = error.message;
        }
      },
    });
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

  const requests = await listIncomingRequests();
  const requestNote = requests.length
    ? `Requests: ${requests.map((r) => r.fromUsername).join(", ")}`
    : "";

  renderFriendsLeaderboard(friendsRoot, view, {
    demoNotice:
      requestNote ||
      "Friends only see stats you allow in Settings. Hidden stats stay hidden on the server too.",
    onModeChange: (mode) => {
      leaderboardMode = mode;
      refresh();
    },
    onAddFriend: async (username) => {
      try {
        await sendFriendRequest(username);
        const note = friendsRoot.querySelector(".friends-demo-note");
        if (note) note.textContent = "Friend request sent.";
      } catch (error) {
        const note = friendsRoot.querySelector(".friends-demo-note");
        if (note) note.textContent = error.message;
      }
    },
  });

  if (requests.length) {
    const extra = document.createElement("div");
    extra.className = "dash-panel";
    extra.innerHTML = requests
      .map(
        (req) =>
          `<p class="friends-row-meta">${req.fromUsername} wants to be friends.
           <button type="button" class="btn btn-secondary btn-small" data-accept="${req.fromUid || req.id}">Accept</button></p>`
      )
      .join("");
    friendsRoot.prepend(extra);
    extra.querySelectorAll("[data-accept]").forEach((button) => {
      button.addEventListener("click", async () => {
        await acceptFriendRequest(button.getAttribute("data-accept"));
        refresh();
      });
    });
  }

  friendsRoot.querySelectorAll(".friends-row-meta").forEach((meta, index) => {
    const entry = view.entries[index];
    const friend = friends.find((item) => item.id === entry?.profile.id);
    if (!friend) return;
    if (!friend.shareStats) {
      meta.textContent = "Stats hidden";
    } else if (friend.stats) {
      meta.textContent = `Level ${friend.stats.level} · ${friend.stats.streakDays} day streak · ${friend.stats.todayFocusPercent}% today · ${formatWeekly(friend.stats.weeklyFocusMs)} this week`;
    }
  });
}

await bootCloudSync();
if (isCloudConfigured()) {
  await listenAuth(() => refresh());
} else {
  refresh();
}
