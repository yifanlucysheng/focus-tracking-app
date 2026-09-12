import { loadSelectedCharacterId } from "./characters.js";
import { mountSectionDivider, mountSiteNav } from "./layout.js";
import { bootCloudSync, formatSessionClock } from "./session-sync.js";
import {
  calculateProfileStats,
  characterHealthLabel,
} from "./profile/calculateStats.js";
import { loadProfileStoreAsync } from "./profile/profileStorage.js";
import { renderProfileStats } from "./profile/renderProfileStats.js";
import { SESSION_START_HEALTH } from "./profile/characterHealthVisual.js";
import {
  isCloudConfigured,
  listenAuth,
  listenOwnPublicStats,
  loadMySessions,
  loadOwnPublicStats,
  loadUserDoc,
} from "./cloud.js";

mountSiteNav("stats");
mountSectionDivider("Your stats");

const profileRoot = document.getElementById("profile-stats-root");

/** @type {object|null} */
let cachedLocalStore = null;
/** @type {object[]} */
let cachedSessions = [];
/** @type {object|null} */
let cachedUserDoc = null;
/** @type {object|null} */
let cachedPublicStats = null;
/** @type {(() => void)|null} */
let unsubPublicStats = null;
let wasLiveSessionActive = false;
let extensionHealth = null;
let extensionLive = false;
let liveSessionStartedAt = 0;
const STALE_ZERO_GRACE_MS = 2_000;

function renderHistory(sessions) {
  const existing = document.getElementById("stats-history");
  existing?.remove();
  const wrap = document.createElement("section");
  wrap.id = "stats-history";
  wrap.className = "stats-history";
  wrap.innerHTML = `
    <h2 class="stats-history-title">Stats history</h2>
    ${
      sessions.length
        ? `<ol class="stats-history-list">
            ${sessions
              .map((session) => {
                const when = session.endedAt
                  ? new Date(session.endedAt).toLocaleString()
                  : "";
                return `<li>
                  <strong>${session.task || "Untitled session"}</strong>
                  <span>${formatSessionClock(session.durationSeconds || Math.round((session.durationMs || 0) / 1000))} · ${session.onTaskPercent ?? Math.round((session.onTaskRatio || 0) * 100)}% on-task · ${session.distractionSwitches ?? 0} switches</span>
                  <span>${when}</span>
                </li>`;
              })
              .join("")}
          </ol>`
        : `<p class="folders-hint">Finished sessions show up here and are saved to your account when you are signed in.</p>`
    }
  `;
  profileRoot?.after(wrap);
}

function resolveDisplayHealth(incoming) {
  const isLive = Boolean(incoming.liveSessionActive) || extensionLive;
  const cloudHealth = Number(incoming.characterHealth);
  const extHealth = Number(extensionHealth);
  const inStaleZeroGrace =
    isLive &&
    liveSessionStartedAt > 0 &&
    Date.now() - liveSessionStartedAt < STALE_ZERO_GRACE_MS;

  if (isLive && !wasLiveSessionActive) {
    liveSessionStartedAt = Date.now();
    return SESSION_START_HEALTH;
  }

  if (extensionLive && Number.isFinite(extHealth)) {
    if (inStaleZeroGrace && extHealth <= 0) return SESSION_START_HEALTH;
    return extHealth;
  }

  if (isLive) {
    if (!Number.isFinite(cloudHealth) || cloudHealth <= 0) {
      if (Number.isFinite(extHealth) && extHealth > 0) return extHealth;
      return SESSION_START_HEALTH;
    }
    return cloudHealth;
  }

  if (Number.isFinite(cloudHealth) && cloudHealth > 0) return cloudHealth;
  return SESSION_START_HEALTH;
}

function paintStats(publicStats) {
  if (!cachedLocalStore) return;

  const incoming = publicStats || {};
  const isLive = Boolean(incoming.liveSessionActive) || extensionLive;
  const health = resolveDisplayHealth(incoming);

  wasLiveSessionActive = isLive;
  if (!isLive) {
    liveSessionStartedAt = 0;
    extensionLive = false;
    extensionHealth = null;
  }

  cachedPublicStats = {
    ...cachedPublicStats,
    ...incoming,
    characterHealth: Math.max(0, Math.min(100, Math.floor(health))),
    liveSessionActive: isLive,
  };

  const stats = calculateProfileStats({
    ...cachedLocalStore,
    sessions: cachedSessions,
  });
  if (Number.isFinite(Number(cachedPublicStats.characterHealth))) {
    stats.characterHealth = cachedPublicStats.characterHealth;
    stats.characterHealthLabel = characterHealthLabel(stats.characterHealth);
  }
  stats.liveSessionActive = isLive;
  if (cachedPublicStats.level) stats.level = cachedPublicStats.level;
  if (cachedPublicStats.xp != null) {
    stats.xp = cachedPublicStats.xp;
    stats.xpIntoLevel = cachedPublicStats.xp;
  }
  if (cachedPublicStats.streakDays != null) {
    stats.focusStreakDays = cachedPublicStats.streakDays;
  }
  if (cachedPublicStats.topDistraction) {
    stats.topDistraction = cachedPublicStats.topDistraction;
  }
  if (cachedPublicStats.topProductiveSite) {
    stats.topProductiveSite = cachedPublicStats.topProductiveSite;
  }

  renderProfileStats(profileRoot, stats, {
    characterId: loadSelectedCharacterId(),
    username: cachedUserDoc?.username || "You",
  });
  renderHistory(cachedSessions);
}

function onExtensionHealthMessage(event) {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== "focus-buddy-extension") return;
  if (data.type !== "CHARACTER_HEALTH") return;

  const health = Number(data.characterHealth);
  const nextLive = Boolean(data.liveSessionActive);

  if (nextLive && !extensionLive) {
    liveSessionStartedAt = Date.now();
    extensionHealth =
      Number.isFinite(health) && health >= 0 ? health : SESSION_START_HEALTH;
  } else if (nextLive && Number.isFinite(health)) {
    extensionHealth = health;
  } else {
    extensionHealth = Number.isFinite(health) ? health : null;
  }

  extensionLive = nextLive;
  paintStats({
    ...(cachedPublicStats || {}),
    characterHealth: extensionHealth ?? SESSION_START_HEALTH,
    liveSessionActive: extensionLive,
  });
}

async function refresh() {
  const localStore = await loadProfileStoreAsync();
  cachedLocalStore = localStore;
  let sessions = localStore.sessions || [];
  if (isCloudConfigured()) {
    try {
      const cloudSessions = await loadMySessions();
      if (cloudSessions.length) sessions = cloudSessions;
    } catch {
      // Keep local copy if signed out or offline.
    }
  }
  cachedSessions = sessions;

  let publicStats = null;
  let userDoc = null;
  try {
    publicStats = await loadOwnPublicStats();
    userDoc = await loadUserDoc();
  } catch {
    // Use local stats only.
  }
  cachedUserDoc = userDoc;
  paintStats(publicStats);
}

async function bindLivePublicStats() {
  if (unsubPublicStats) {
    unsubPublicStats();
    unsubPublicStats = null;
  }
  if (!isCloudConfigured()) return;
  try {
    unsubPublicStats = await listenOwnPublicStats((publicStats) => {
      if (!cachedLocalStore) return;
      paintStats(publicStats);
    });
  } catch {
    // Live health is optional.
  }
}

window.addEventListener("message", onExtensionHealthMessage);

await bootCloudSync();
try {
  if (isCloudConfigured()) {
    await listenAuth(async () => {
      await refresh();
      await bindLivePublicStats();
    });
  } else {
    await refresh();
  }
} catch {
  await refresh();
}
