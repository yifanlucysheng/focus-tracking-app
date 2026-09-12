import { mountSectionDivider, mountSiteNav } from "./layout.js";
import { bootCloudSync } from "./session-sync.js";
import { isCloudConfigured, listenAuth, loadFriendsActivity, loadUserDoc } from "./cloud.js";
import { publishNowPlaying } from "./spotify.js";

mountSiteNav("activity");
mountSectionDivider("Friend activity");

const root = document.getElementById("activity-root");
const banner = document.getElementById("activity-banner");

function avatarSrc(characterId) {
  return characterId === "cat" ? "../assets/cat.png" : "../assets/sleepbunny.png";
}

function formatWeekly(ms) {
  const minutes = Math.round((Number(ms) || 0) / 60000);
  if (minutes < 60) return `${minutes}m this week`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m this week` : `${hours}h this week`;
}

function renderRows(friends) {
  if (!root) return;
  if (!friends.length) {
    root.innerHTML = `<p class="folders-hint">Add friends from the Friends page. You'll see their status and music here only if they allow it.</p>`;
    return;
  }

  root.innerHTML = `
    <ol class="friends-leaderboard" aria-label="Friend activity">
      ${friends
        .map((friend) => {
          const stats = friend.shareStats && friend.stats
            ? `${friend.stats.todayFocusPercent ?? 0}% today · ${friend.stats.streakDays ?? 0} day streak · ${formatWeekly(friend.stats.weeklyFocusMs)}`
            : "Stats hidden";
          const listening =
            friend.shareListening && friend.listening?.isPlaying
              ? `Listening to ${friend.listening.trackName} — ${friend.listening.artistName}`
              : friend.shareListening
                ? "Not playing anything right now"
                : "Listening hidden";
          const status = friend.customStatus
            ? `<p class="friends-row-meta">${friend.customStatus}</p>`
            : "";
          return `
            <li class="friends-row">
              <img class="friends-avatar" src="${avatarSrc(friend.characterId)}" alt="" />
              <div class="friends-row-main">
                <p class="friends-username">${friend.username}</p>
                ${status}
                <p class="friends-row-meta">${stats}</p>
                <p class="friends-row-meta">${listening}</p>
              </div>
            </li>
          `;
        })
        .join("")}
    </ol>
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
