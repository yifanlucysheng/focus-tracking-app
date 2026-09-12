import { loadSelectedCharacterId } from "./characters.js";
import { mountSectionDivider, mountSiteNav } from "./layout.js";
import { bootCloudSync, formatSessionClock } from "./session-sync.js";
import { calculateProfileStats } from "./profile/calculateStats.js";
import { loadProfileStoreAsync } from "./profile/profileStorage.js";
import { mergePublicProfileIntoStats } from "./profile/profileService.js";
import { renderProfileStats } from "./profile/renderProfileStats.js";
import {
  isCloudConfigured,
  listenAuth,
  loadMySessions,
  loadOwnPublicStats,
  loadUserDoc,
} from "./cloud.js";

mountSiteNav("stats");
mountSectionDivider("Your stats");

const profileRoot = document.getElementById("profile-stats-root");

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
    character_health: publicStats?.characterHealth ?? 0,
    created_at: "",
  };
}

async function refresh() {
  const localStore = await loadProfileStoreAsync();
  let sessions = localStore.sessions || [];
  if (isCloudConfigured()) {
    try {
      const cloudSessions = await loadMySessions();
      if (cloudSessions.length) sessions = cloudSessions;
    } catch {
      // Keep local copy if signed out or offline.
    }
  }

  const localStats = calculateProfileStats({
    ...localStore,
    sessions,
  });

  let publicStats = null;
  let userDoc = null;
  try {
    publicStats = await loadOwnPublicStats();
    userDoc = await loadUserDoc();
  } catch {
    // Use local stats only.
  }

  const stats = mergePublicProfileIntoStats(
    localStats,
    asProfileRow(publicStats, userDoc)
  );
  renderProfileStats(profileRoot, stats, {
    characterId: loadSelectedCharacterId(),
    username: userDoc?.username || "You",
  });
  renderHistory(sessions);
}

await bootCloudSync();
if (isCloudConfigured()) {
  await listenAuth(() => refresh());
} else {
  refresh();
}
