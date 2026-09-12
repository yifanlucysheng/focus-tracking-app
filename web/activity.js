import { mountSectionDivider, mountSiteNav } from "./layout.js";
import { bootCloudSync } from "./session-sync.js";
import { isCloudConfigured, listenAuth, loadFriendsActivity, loadUserDoc } from "./cloud.js";
import { publishNowPlaying } from "./spotify.js";

mountSiteNav("activity");
mountSectionDivider("Friend activity");

const root = document.getElementById("activity-root");
const banner = document.getElementById("activity-banner");

function avatarSrc(characterId) {
  return characterId === "cat" ? "/cat.png" : "/moon1.png";
}

function formatWeekly(ms) {
  const minutes = Math.round((Number(ms) || 0) / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderRows(friends) {
  if (!root) return;
  if (!friends.length) {
    root.innerHTML = `<p class="folders-hint">Add friends from the Friends page. You'll see their status and music here only if they allow it.</p>`;
    return;
  }

  root.innerHTML = `
    <ul class="activity-list" aria-label="Friend activity">
      ${friends
        .map((friend) => {
          const hasStats = Boolean(friend.shareStats && friend.stats);
          const status = friend.customStatus
            ? `<p class="activity-status">${escapeHtml(friend.customStatus)}</p>`
            : `<p class="activity-status is-muted">No status set</p>`;
          const listening =
            friend.shareListening && friend.listening?.isPlaying
              ? `Listening to ${friend.listening.trackName} — ${friend.listening.artistName}`
              : friend.shareListening
                ? "Not playing anything right now"
                : "Listening hidden";

          const statsHtml = hasStats
            ? `
              <div class="activity-stat-chips" aria-label="Focus stats">
                <span class="activity-chip"><strong>${friend.stats.todayFocusPercent ?? 0}%</strong> today</span>
                <span class="activity-chip"><strong>${friend.stats.streakDays ?? 0}</strong> day streak</span>
                <span class="activity-chip"><strong>${formatWeekly(friend.stats.weeklyFocusMs)}</strong> this week</span>
              </div>
            `
            : `<p class="activity-listening is-muted">Stats hidden</p>`;

          return `
            <li class="activity-card">
              <img class="activity-avatar" src="${avatarSrc(friend.characterId)}" alt="" />
              <div class="activity-body">
                <div class="activity-heading">
                  <p class="activity-username">${escapeHtml(friend.username)}</p>
                  ${status}
                </div>
                ${statsHtml}
                <p class="activity-listening">${escapeHtml(listening)}</p>
              </div>
            </li>
          `;
        })
        .join("")}
    </ul>
  `;
}

async function refresh() {
  if (!isCloudConfigured()) {
    if (banner) banner.textContent = "Add Firebase keys in web/firebase-config.js to load friend activity.";
    return;
  }
  const me = await loadUserDoc();
  if (!me) {
    if (banner) banner.textContent = "Sign in on the Settings page to see friend activity.";
    renderRows([]);
    return;
  }
  if (banner) banner.textContent = "";
  if (me.shareListening) {
    await publishNowPlaying().catch(() => {});
  }
  const friends = await loadFriendsActivity();
  renderRows(friends);
}

await bootCloudSync();
if (isCloudConfigured()) {
  await listenAuth(() => refresh());
  setInterval(refresh, 20_000);
} else {
  refresh();
}
