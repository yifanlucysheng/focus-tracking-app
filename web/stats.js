import { loadSelectedCharacterId } from "./characters.js";
import { mountSectionDivider, mountSiteNav } from "./layout.js";
import { bootCloudSync, formatSessionClock } from "./session-sync.js";
import { calculateProfileStats } from "./profile/calculateStats.js";
import { loadProfileStoreAsync } from "./profile/profileStorage.js";
import { renderProfileStats } from "./profile/renderProfileStats.js";
import { isCloudConfigured, listenAuth, loadMySessions } from "./cloud.js";

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
        : `<p class="folders-hint">Finished sessions show up here and are saved to your account when you are signed in.</p>`
    }
  `;
  profileRoot?.after(wrap);
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
  const stats = calculateProfileStats({
    ...localStore,
    sessions,
  });
  renderProfileStats(profileRoot, stats, { characterId: loadSelectedCharacterId() });
  renderHistory(sessions);
}

await bootCloudSync();
if (isCloudConfigured()) {
  await listenAuth(() => refresh());
} else {
  refresh();
}
