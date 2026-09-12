import { loadProfileStore } from "./profile/profileStorage.js";
import { calculateProfileStats } from "./profile/calculateStats.js";
import {
  loadPublicProfileFromSupabase,
  mergePublicProfileIntoStats,
  recordCompletedSession,
} from "./profile/profileService.js";
import { renderProfileStats } from "./profile/renderProfileStats.js";
import {
  buildLeaderboardView,
  currentUserAsFriend,
} from "./friends/calculateLeaderboard.js";
import { renderFriendsLeaderboard } from "./friends/renderFriends.js";
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
  ensureProfileForUser,
  getCachedProfile,
  loadCurrentProfile,
  onAuthStateChange,
  setCachedProfile,
  signOut,
} from "./auth/authService.js";
import { mountAuthPage } from "./auth/renderAuth.js";

const CHARACTERS = {
  cat: { src: "/cat.png", alt: "" },
  sleepbunny: { src: "/sleepbunny.png", alt: "" },
};

const authPage = document.getElementById("auth-page");
const appDashboard = document.getElementById("app-dashboard");
const authRoot = document.getElementById("auth-root");
const signOutBtn = document.getElementById("sign-out-btn");
const preview = document.getElementById("character-preview");
const options = Array.from(document.querySelectorAll(".buddy-option"));
const profileRoot = document.getElementById("profile-stats-root");
const friendsRoot = document.getElementById("friends-root");

const taskInput = document.getElementById("task-input");
const blockSiteInput = document.getElementById("block-site-input");
const addBlockSiteBtn = document.getElementById("add-block-site-btn");
const blockSiteList = document.getElementById("block-site-list");
const allowSiteInput = document.getElementById("allow-site-input");
const addAllowSiteBtn = document.getElementById("add-allow-site-btn");
const allowSiteList = document.getElementById("allow-site-list");
const sitesStatus = document.getElementById("sites-status");

/** @type {import('./auth/authService.js').ProfileRow|null} */
let signedInProfile = null;
let dashboardInitialized = false;

/**
 * @returns {import('./auth/authService.js').ProfileRow|null}
 */
function getSignedInProfile() {
  return signedInProfile || getCachedProfile();
}

const STORAGE_KEY = "focusBuddy.selectedCharacter";
const BLOCK_SITES_KEY = "focusBuddy.blockSites";
const ALLOW_SITES_KEY = "focusBuddy.alwaysAllowSites";
const LEGACY_SITES_KEY = "focusBuddy.allowedSites";
const TASK_KEY = "focusBuddy.task";

let selectedCharacterId = "sleepbunny";
/** @type {'level' | 'streak'} */
let leaderboardMode = "level";
let blockSites = [];
let allowSites = [];

/** @type {import('./friends/friendsService.js').FriendshipWithProfiles[]} */
let incomingFriendRequests = [];
/** @type {Array<{ friendship: import('./friends/friendsService.js').FriendshipRow, friend: import('./auth/authService.js').ProfileRow }>} */
let acceptedFriends = [];
let friendsAddInput = "";
/** @type {{ kind: 'idle' | 'error' | 'success' | 'loading', message: string }} */
let friendsAddStatus = { kind: "idle", message: "" };
let friendsAddBusy = false;
/** @type {string|null} */
let friendsRequestActionId = null;
let friendsRequestsError = "";
let friendsLeaderboardLoading = false;
let friendsLeaderboardError = "";
/** @type {Promise<void>|null} */
let friendsLoadInFlight = null;
let friendsSectionWasVisible = false;
/** @type {IntersectionObserver|null} */
let friendsSectionObserver = null;

function applyCharacter(id) {
  const character = CHARACTERS[id];
  if (!character) return;

  selectedCharacterId = id;

  if (preview) {
    preview.classList.add("is-switching");
    window.setTimeout(() => {
      preview.src = character.src;
      preview.alt = character.alt;
      preview.classList.remove("is-switching");
    }, 120);
  }

  options.forEach((button) => {
    const selected = button.dataset.character === id;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-selected", selected ? "true" : "false");
  });

  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Ignore.
  }

  if (dashboardInitialized) refreshProfileStats();
}

function refreshProfileStats() {
  const store = loadProfileStore();
  const localStats = calculateProfileStats(store);
  const profile = getSignedInProfile();
  // Public fields (xp / level / streak / username) come from Supabase profile.
  const stats = mergePublicProfileIntoStats(localStats, profile);
  const username = profile?.username || "You";
  renderProfileStats(profileRoot, stats, {
    characterId: selectedCharacterId,
    username,
  });
  refreshFriendsLeaderboard(stats);
  updateSectionLabels(username);
}

/**
 * @param {string} username
 */
function updateSectionLabels(username) {
  const who = (username || "You").trim() || "You";
  const whose = `${who}'s`;
  const focusLabel = document.getElementById("focus-session-label");
  const statsLabel = document.getElementById("stats-section-label");
  if (focusLabel) focusLabel.textContent = `${whose} focus session`;
  if (statsLabel) statsLabel.textContent = `${whose} stats`;
}

function refreshFriendsLeaderboard(stats) {
  if (!friendsRoot) return;

  const profileStats = stats || calculateProfileStats(loadProfileStore());
  const profile = getSignedInProfile();
  const you = profile
    ? profileToFriendProfile(profile, {
        isCurrentUser: true,
        characterId: selectedCharacterId,
      })
    : currentUserAsFriend({
        level: profileStats.level,
        xp: profileStats.xp,
        focusStreakDays: profileStats.focusStreakDays,
        characterId: selectedCharacterId,
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
    leaderboardLoading: friendsLeaderboardLoading,
    leaderboardError: friendsLeaderboardError,
    onModeChange: (mode) => {
      leaderboardMode = mode;
      refreshFriendsLeaderboard(profileStats);
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
}

/**
 * @param {string} username
 */
async function handleAddFriend(username) {
  friendsAddInput = username;
  if (!username.trim()) {
    friendsAddStatus = { kind: "error", message: "Enter a username." };
    refreshFriendsLeaderboard();
    return;
  }

  friendsAddBusy = true;
  friendsAddStatus = { kind: "loading", message: "Looking up user…" };
  refreshFriendsLeaderboard();

  try {
    const me = getSignedInProfile();
    if (!me?.id) throw new Error("You must be signed in.");

    let target;
    try {
      target = await searchUserByUsername(username);
    } catch (err) {
      const msg = err?.message || "";
      if (/username/i.test(msg)) {
        friendsAddStatus = { kind: "error", message: "User not found" };
        return;
      }
      throw err;
    }

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
      if (existing.requester_id === me.id) {
        friendsAddStatus = {
          kind: "error",
          message: "Friend request already pending",
        };
      } else {
        friendsAddStatus = {
          kind: "error",
          message: "Friend request already pending — check Friend Requests",
        };
      }
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
    refreshFriendsLeaderboard();
  }
}

/**
 * @param {string} friendshipId
 */
async function handleAcceptRequest(friendshipId) {
  if (friendsRequestActionId) return;
  friendsRequestActionId = friendshipId;
  friendsRequestsError = "";
  refreshFriendsLeaderboard();

  try {
    await acceptFriendRequest(friendshipId);
    incomingFriendRequests = incomingFriendRequests.filter((r) => r.id !== friendshipId);
    acceptedFriends = await getAcceptedFriends();
  } catch (err) {
    friendsRequestsError = err?.message || "Could not accept request.";
  } finally {
    friendsRequestActionId = null;
    refreshFriendsLeaderboard();
  }
}

/**
 * @param {string} friendshipId
 */
async function handleDeclineRequest(friendshipId) {
  if (friendsRequestActionId) return;
  friendsRequestActionId = friendshipId;
  friendsRequestsError = "";
  refreshFriendsLeaderboard();

  try {
    await rejectFriendRequest(friendshipId);
    incomingFriendRequests = incomingFriendRequests.filter((r) => r.id !== friendshipId);
  } catch (err) {
    friendsRequestsError = err?.message || "Could not decline request.";
  } finally {
    friendsRequestActionId = null;
    refreshFriendsLeaderboard();
  }
}

async function loadFriendsData() {
  if (friendsLoadInFlight) return friendsLoadInFlight;

  friendsRequestsError = "";
  friendsLeaderboardError = "";
  friendsLeaderboardLoading = true;
  refreshFriendsLeaderboard();

  friendsLoadInFlight = (async () => {
    try {
      const [incoming, accepted] = await Promise.all([
        getIncomingPendingRequests(),
        getAcceptedFriends(),
      ]);
      incomingFriendRequests = incoming;
      acceptedFriends = accepted;
    } catch (err) {
      const message = err?.message || "Could not load friends.";
      friendsRequestsError = message;
      friendsLeaderboardError = message;
      console.error("[Focus Buddy] Friends load failed:", err);
    } finally {
      friendsLeaderboardLoading = false;
      friendsLoadInFlight = null;
      refreshFriendsLeaderboard();
    }
  })();

  return friendsLoadInFlight;
}

/**
 * Refresh only the current user's row on the leaderboard after a successful
 * public-stats sync (no extra Supabase friends fetch).
 */
function refreshCurrentUserOnLeaderboard() {
  refreshFriendsLeaderboard();
}

/**
 * Fetch latest accepted-friend profiles when the Friends section is opened
 * or navigated to. Does not poll.
 */
function initFriendsSectionRefresh() {
  const section = document.getElementById("friends");
  if (!section || friendsSectionObserver) return;

  friendsSectionObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          if (!friendsSectionWasVisible) {
            friendsSectionWasVisible = true;
            void loadFriendsData();
          }
        } else {
          friendsSectionWasVisible = false;
        }
      }
    },
    { root: null, threshold: 0.15 }
  );
  friendsSectionObserver.observe(section);

  const maybeLoadFromHash = () => {
    if (location.hash === "#friends") void loadFriendsData();
  };
  window.addEventListener("hashchange", maybeLoadFromHash);

  document.querySelectorAll('a[href="#friends"]').forEach((link) => {
    link.addEventListener("click", () => {
      void loadFriendsData();
    });
  });
}

function resetFriendsUiState() {
  incomingFriendRequests = [];
  acceptedFriends = [];
  friendsAddInput = "";
  friendsAddStatus = { kind: "idle", message: "" };
  friendsAddBusy = false;
  friendsRequestActionId = null;
  friendsRequestsError = "";
  friendsLeaderboardLoading = false;
  friendsLeaderboardError = "";
  friendsSectionWasVisible = false;
  friendsLoadInFlight = null;
}

function loadTask() {
  try {
    const saved = localStorage.getItem(TASK_KEY);
    if (saved && taskInput) taskInput.value = saved;
  } catch {
    // Ignore.
  }
}

function saveTask() {
  try {
    localStorage.setItem(TASK_KEY, taskInput?.value?.trim() ?? "");
  } catch {
    // Ignore.
  }
}

function readStoredList(key) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadSites() {
  blockSites = readStoredList(BLOCK_SITES_KEY);
  if (blockSites.length === 0) {
    blockSites = readStoredList(LEGACY_SITES_KEY);
  }
  allowSites = readStoredList(ALLOW_SITES_KEY);
  renderSiteList(blockSiteList, blockSites, "block");
  renderSiteList(allowSiteList, allowSites, "allow");
}

function saveSiteLists() {
  try {
    localStorage.setItem(BLOCK_SITES_KEY, JSON.stringify(blockSites));
    localStorage.setItem(ALLOW_SITES_KEY, JSON.stringify(allowSites));
  } catch {
    // Ignore.
  }
}

function normalizeSite(value) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(withProtocol);
    if (!url.hostname) return null;
    return url.href.replace(/\/$/, "");
  } catch {
    return null;
  }
}

function renderSiteList(listEl, sites, kind) {
  if (!listEl) return;
  listEl.innerHTML = "";

  sites.forEach((site, index) => {
    const li = document.createElement("li");
    li.className = "site-chip";

    const label = document.createElement("span");
    label.textContent = site;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove ${site}`);
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      sites.splice(index, 1);
      saveSiteLists();
      renderSiteList(listEl, sites, kind);
    });

    li.append(label, remove);
    listEl.appendChild(li);
  });
}

function addSiteToList({ input, sites, otherSites, listEl, kind }) {
  const site = normalizeSite(input?.value ?? "");
  if (!site) {
    if (sitesStatus) sitesStatus.textContent = "Enter a valid website URL.";
    return;
  }

  if (sites.includes(site)) {
    if (sitesStatus) sitesStatus.textContent = "That site is already on this list.";
    return;
  }

  if (otherSites.includes(site)) {
    if (sitesStatus) {
      sitesStatus.textContent =
        kind === "block"
          ? "That site is already in Always Allow."
          : "That site is already in your block list.";
    }
    return;
  }

  sites.push(site);
  saveSiteLists();
  renderSiteList(listEl, sites, kind);
  if (input) input.value = "";
  if (sitesStatus) sitesStatus.textContent = "";
}

function addBlockSite() {
  addSiteToList({
    input: blockSiteInput,
    sites: blockSites,
    otherSites: allowSites,
    listEl: blockSiteList,
    kind: "block",
  });
}

function addAllowSite() {
  addSiteToList({
    input: allowSiteInput,
    sites: allowSites,
    otherSites: blockSites,
    listEl: allowSiteList,
    kind: "allow",
  });
}

function initDashboardOnce() {
  if (dashboardInitialized) return;
  dashboardInitialized = true;

  options.forEach((button) => {
    button.addEventListener("click", () => {
      applyCharacter(button.dataset.character);
    });
  });

  let initial = "sleepbunny";
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && CHARACTERS[saved]) initial = saved;
  } catch {
    // Keep default.
  }
  applyCharacter(initial);

  taskInput?.addEventListener("change", saveTask);
  taskInput?.addEventListener("blur", saveTask);
  addBlockSiteBtn?.addEventListener("click", addBlockSite);
  addAllowSiteBtn?.addEventListener("click", addAllowSite);
  blockSiteInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addBlockSite();
    }
  });
  allowSiteInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addAllowSite();
    }
  });

  loadTask();
  loadSites();
  refreshProfileStats();
  initFriendsSectionRefresh();
}

function showAuthScreen() {
  signedInProfile = null;
  setCachedProfile(null);
  resetFriendsUiState();
  document.body.classList.remove("is-booting", "is-dashboard");
  document.body.classList.add("is-auth-screen");
  if (authPage) authPage.hidden = false;
  if (appDashboard) appDashboard.hidden = true;

  if (authRoot) {
    mountAuthPage(authRoot, {
      onAuthenticated(profile) {
        showDashboard(profile);
      },
    });
  }
}

/**
 * @param {import('./auth/authService.js').ProfileRow} profile
 */
function showDashboard(profile) {
  signedInProfile = profile;
  setCachedProfile(profile);
  document.body.classList.remove("is-booting", "is-auth-screen");
  document.body.classList.add("is-dashboard");
  if (authPage) authPage.hidden = true;
  if (appDashboard) appDashboard.hidden = false;

  initDashboardOnce();
  refreshProfileStats();
  void loadFriendsData();
  // Fetch authoritative public stats FROM Supabase — never push local on load.
  void hydratePublicStatsFromSupabase();
}

/**
 * Load public profile stats FROM Supabase and refresh the UI.
 * Does not write to Supabase (avoids overwriting newer extension-written values).
 */
async function hydratePublicStatsFromSupabase() {
  try {
    const profile = await loadPublicProfileFromSupabase();
    if (!profile) return;
    signedInProfile = profile;
    refreshProfileStats();
    refreshCurrentUserOnLeaderboard();
  } catch (err) {
    console.error("[Focus Buddy] Failed to load public stats from Supabase:", err);
  }
}

/**
 * Call when a focus session ends. Updates local stats, syncs public fields,
 * then refreshes the current user's leaderboard entry on success.
 *
 * @param {Parameters<typeof recordCompletedSession>[0]} sessionInput
 */
async function onFocusSessionCompleted(sessionInput) {
  try {
    const { profile } = await recordCompletedSession(sessionInput);
    if (profile) {
      signedInProfile = profile;
      setCachedProfile(profile);
    }
    refreshProfileStats();
    refreshCurrentUserOnLeaderboard();
  } catch (err) {
    console.error("[Focus Buddy] Session complete / sync failed:", err);
    // Local stats may still have been saved inside recordCompletedSession.
    refreshProfileStats();
  }
}

async function bootApp() {
  try {
    const profile = await loadCurrentProfile();
    if (profile) showDashboard(profile);
    else showAuthScreen();
  } catch (err) {
    console.error("[Focus Buddy] Auth boot failed:", err);
    showAuthScreen();
  }

  onAuthStateChange(async (session) => {
    if (!session?.user) {
      showAuthScreen();
      return;
    }
    try {
      // Use session.user directly — do not call getSession() inside this callback.
      const profile = await ensureProfileForUser(session.user);
      showDashboard(profile);
    } catch (err) {
      console.error("[Focus Buddy] Profile ensure failed:", err);
      showAuthScreen();
    }
  });
}

signOutBtn?.addEventListener("click", async () => {
  try {
    await signOut();
    showAuthScreen();
  } catch (err) {
    console.error("[Focus Buddy] Sign out failed:", err);
  }
});

bootApp();
