import { loadProfileStore } from "./profile/profileStorage.js";
import { calculateProfileStats } from "./profile/calculateStats.js";
import { renderProfileStats } from "./profile/renderProfileStats.js";
import { MOCK_FRIENDS } from "./friends/mockFriends.js";
import {
  buildLeaderboardView,
  currentUserAsFriend,
} from "./friends/calculateLeaderboard.js";
import { renderFriendsLeaderboard } from "./friends/renderFriends.js";

const CHARACTERS = {
  cat: {
    src: "../assets/cat.png",
    alt: "Cat buddy",
  },
  sleepbunny: {
    src: "../assets/sleepbunny.png",
    alt: "Sleep bunny buddy",
  },
};

const preview = document.getElementById("character-preview");
const options = Array.from(document.querySelectorAll(".buddy-option"));
const profileRoot = document.getElementById("profile-stats-root");
const friendsRoot = document.getElementById("friends-root");

const STORAGE_KEY = "focusBuddy.selectedCharacter";
const BLOCK_SITES_KEY = "focusBuddy.blockSites";
const ALLOW_SITES_KEY = "focusBuddy.alwaysAllowSites";
const LEGACY_SITES_KEY = "focusBuddy.allowedSites";
const TASK_KEY = "focusBuddy.task";
const DEMO_FRIENDS_KEY = "focusBuddy.demoFriends";

let selectedCharacterId = "sleepbunny";
/** @type {'level' | 'streak'} */
let leaderboardMode = "level";
/** @type {import('./friends/friendTypes.js').FriendProfile[]} */
let demoExtraFriends = [];

function loadDemoExtras() {
  try {
    const raw = localStorage.getItem(DEMO_FRIENDS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    demoExtraFriends = Array.isArray(parsed) ? parsed : [];
  } catch {
    demoExtraFriends = [];
  }
}

function saveDemoExtras() {
  try {
    localStorage.setItem(DEMO_FRIENDS_KEY, JSON.stringify(demoExtraFriends));
  } catch {
    // Ignore.
  }
}

function refreshProfileStats() {
  const store = loadProfileStore();
  const stats = calculateProfileStats(store);
  renderProfileStats(profileRoot, stats, { characterId: selectedCharacterId });
  refreshFriendsLeaderboard(stats);
}

function refreshFriendsLeaderboard(stats) {
  if (!friendsRoot) return;

  const profileStats = stats || calculateProfileStats(loadProfileStore());
  const you = currentUserAsFriend({
    level: profileStats.level,
    xp: profileStats.xp,
    focusStreakDays: profileStats.focusStreakDays,
    characterId: selectedCharacterId,
    username: "You",
  });

  const group = [you, ...MOCK_FRIENDS, ...demoExtraFriends];
  const view = buildLeaderboardView(group, you.id, leaderboardMode);

  renderFriendsLeaderboard(friendsRoot, view, {
    onModeChange: (mode) => {
      leaderboardMode = mode;
      refreshFriendsLeaderboard(profileStats);
    },
    onAddFriend: (username) => {
      if (!username) {
        refreshFriendsLeaderboard(profileStats);
        const note = friendsRoot.querySelector(".friends-demo-note");
        if (note) note.textContent = "Enter a username to add a demo friend.";
        return;
      }

      const exists = [...MOCK_FRIENDS, ...demoExtraFriends].some(
        (f) => f.username.toLowerCase() === username.toLowerCase()
      );
      if (exists) {
        const note = friendsRoot.querySelector(".friends-demo-note");
        if (note) note.textContent = "That demo friend is already on your list.";
        return;
      }

      demoExtraFriends.push({
        id: `demo-${Date.now()}`,
        username,
        focusLevel: 1 + Math.floor(Math.random() * 4),
        xp: 40 + Math.floor(Math.random() * 200),
        focusStreak: Math.floor(Math.random() * 6),
        characterId: Math.random() > 0.5 ? "cat" : "sleepbunny",
        isMock: true,
      });
      saveDemoExtras();
      refreshFriendsLeaderboard(profileStats);

      const note = friendsRoot.querySelector(".friends-demo-note");
      if (note) {
        note.textContent =
          "Added as a local demo friend only — this does not connect to a real account.";
      }
    },
  });
}

function applyCharacter(id) {
  const character = CHARACTERS[id];
  if (!character || !preview) return;

  selectedCharacterId = id;
  preview.classList.add("is-switching");

  window.setTimeout(() => {
    preview.src = character.src;
    preview.alt = character.alt;
    preview.classList.remove("is-switching");
  }, 120);

  options.forEach((button) => {
    const selected = button.dataset.character === id;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-selected", selected ? "true" : "false");
  });

  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Ignore storage errors in private browsing contexts.
  }

  refreshProfileStats();
}

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

/* —— Dashboard: task + sites —— */

const taskInput = document.getElementById("task-input");
const blockSiteInput = document.getElementById("block-site-input");
const addBlockSiteBtn = document.getElementById("add-block-site-btn");
const blockSiteList = document.getElementById("block-site-list");
const allowSiteInput = document.getElementById("allow-site-input");
const addAllowSiteBtn = document.getElementById("add-allow-site-btn");
const allowSiteList = document.getElementById("allow-site-list");
const sitesStatus = document.getElementById("sites-status");

let blockSites = [];
let allowSites = [];

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
    // Migrate older single-list data into the block list once.
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
loadDemoExtras();
refreshProfileStats();
