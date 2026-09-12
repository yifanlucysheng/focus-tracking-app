import { loadSelectedCharacterId } from "./characters.js";
import { mountSectionDivider, mountSiteNav } from "./layout.js";
import { bootCloudSync, formatSessionClock } from "./session-sync.js";
import { calculateProfileStats } from "./profile/calculateStats.js";
import { loadProfileStoreAsync } from "./profile/profileStorage.js";
import { mergePublicProfileIntoStats } from "./profile/profileService.js";
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
/** @type {number|null} */
let publicStatsPollTimer = null;
let wasLiveSessionActive = false;
/** Health from the extension bridge — preferred over stale Firebase 0 during lock-in. */
let extensionHealth = null;
let extensionLive = false;
/** When the current live lock-in was first observed on this page. */
let liveSessionStartedAt = 0;
const HEALTH_DROP_GRACE_MS = 20_000;

function renderHistory(sessions) {
  const existing = document.getElementById("stats-history");
  existing?.remove();
  const wrap = document.createElement("section");
  wrap.id = "stats-history";
  wrap.className = "stats-history";
  wrap.innerHTML = `
    <h2 class="stats-history-title">history</h2>
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
        : `<p class="folders-hint">Finished sessions show up here and sync to Firebase when you are signed in.</p>`
    }
  `;
  profileRoot?.after(wrap);
}

/**
 * Map Firestore public/stats into the shape mergePublicProfileIntoStats expects.
 * @param {object|null} publicStats
 * @param {object|null} userDoc
 */
function asProfileRow(publicStats, userDoc) {
  if (!publicStats && !userDoc) return null;
  const healthRaw = publicStats?.characterHealth;
  const healthNum = Number(healthRaw);
  return {
    id: userDoc?.id || "firebase",
    username: userDoc?.username || "You",
    focus_level: publicStats?.level ?? 1,
    xp: publicStats?.xp ?? 0,
    focus_streak: publicStats?.streakDays ?? 0,
    longest_session_ms: publicStats?.longestSessionMs ?? 0,
    sessions_completed: publicStats?.sessionsCompleted ?? 0,
    top_distraction: publicStats?.topDistraction ?? null,
    top_productive_site: publicStats?.topProductiveSite ?? null,
    character_health: Number.isFinite(healthNum) ? healthNum : undefined,
    live_session_active: Boolean(publicStats?.liveSessionActive),
    created_at: "",
  };
}

/**
 * Resolve displayed health. Never keep a stale 0/cat7 at live session start.
 * @param {object} incoming
 * @returns {number}
 */
function resolveDisplayHealth(incoming) {
  const isLive = Boolean(incoming.liveSessionActive) || extensionLive;
  const cloudHealth = Number(incoming.characterHealth);
  const extHealth = Number(extensionHealth);
  const inGrace =
    isLive &&
    liveSessionStartedAt > 0 &&
    Date.now() - liveSessionStartedAt < HEALTH_DROP_GRACE_MS;

  if (isLive && !wasLiveSessionActive) {
    liveSessionStartedAt = Date.now();
    return SESSION_START_HEALTH;
  }

  if (extensionLive && Number.isFinite(extHealth)) {
    // Stale bridge value of 0 from before lock-in must not win during grace.
    if (inGrace && extHealth <= 0) return SESSION_START_HEALTH;
    if (inGrace) return Math.max(extHealth, SESSION_START_HEALTH);
    return extHealth;
  }

  if (isLive) {
    if (!Number.isFinite(cloudHealth) || cloudHealth <= 0) {
      return SESSION_START_HEALTH;
    }
    if (inGrace) return Math.max(cloudHealth, SESSION_START_HEALTH);
    return cloudHealth;
  }

  return Number.isFinite(cloudHealth) ? cloudHealth : 0;
}

/**
 * @param {object|null} publicStats
 */
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

  const statsPayload = {
    ...cachedPublicStats,
    ...incoming,
    characterHealth: Math.max(0, Math.min(100, Math.floor(health))),
    liveSessionActive: isLive,
  };
  cachedPublicStats = statsPayload;

  const localStats = calculateProfileStats({
    ...cachedLocalStore,
    sessions: cachedSessions,
  });
  const stats = mergePublicProfileIntoStats(
    localStats,
    asProfileRow(statsPayload, cachedUserDoc)
  );
  renderProfileStats(profileRoot, stats, {
    characterId: loadSelectedCharacterId(),
    username: cachedUserDoc?.username || "You",
  });
  renderHistory(cachedSessions);
}

/**
 * Live health updates from the extension content script (instant, no Firebase wait).
 * @param {MessageEvent} event
 */
function onExtensionHealthMessage(event) {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== "focus-buddy-extension") return;
  if (data.type !== "CHARACTER_HEALTH") return;

  const health = Number(data.characterHealth);
  const nextLive = Boolean(data.liveSessionActive);

  if (nextLive && !extensionLive) {
    liveSessionStartedAt = Date.now();
    extensionHealth = SESSION_START_HEALTH;
  } else if (nextLive) {
    if (!Number.isFinite(health) || health <= 0) {
      // Ignore stale 0 while lock-in is active (unless past grace and intentionally dead).
      if (Date.now() - liveSessionStartedAt < HEALTH_DROP_GRACE_MS) {
        extensionHealth = SESSION_START_HEALTH;
      } else {
        extensionHealth = health;
      }
    } else {
      extensionHealth = health;
    }
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
  if (publicStatsPollTimer !== null) {
    clearInterval(publicStatsPollTimer);
    publicStatsPollTimer = null;
  }
  if (!isCloudConfigured()) return;

  try {
    unsubPublicStats = await listenOwnPublicStats((publicStats) => {
      if (!cachedLocalStore) return;
      paintStats(publicStats);
    });
  } catch (err) {
    console.warn("[Focus Buddy] Could not listen for live character health:", err);
  }

  // Backup poll in case the snapshot listener misses a mid-session write.
  publicStatsPollTimer = window.setInterval(() => {
    void loadOwnPublicStats()
      .then((publicStats) => {
        if (!cachedLocalStore || !publicStats) return;
        paintStats(publicStats);
      })
      .catch(() => {});
  }, 2000);
}

window.addEventListener("message", onExtensionHealthMessage);

await bootCloudSync();
if (isCloudConfigured()) {
  await listenAuth(async () => {
    await refresh();
    await bindLivePublicStats();
  });
} else {
  refresh();
}
