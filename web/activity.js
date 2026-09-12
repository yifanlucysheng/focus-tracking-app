import { mountSiteNav } from "./layout.js";
import { bootCloudSync } from "./session-sync.js";
import {
  currentUid,
  isCloudConfigured,
  listenAuth,
  listenChatMessages,
  loadFriendsActivity,
  loadUserDoc,
  sendChatMessage,
} from "./cloud.js";
import { buddyVisualForHealth } from "./profile/characterHealthVisual.js";
import { publishNowPlaying } from "./spotify.js";

mountSiteNav("activity");

const lounge = document.getElementById("activity-lounge");
const banner = document.getElementById("activity-banner");
const panel = document.getElementById("activity-panel");
const panelBody = document.getElementById("activity-panel-body");
const panelClose = document.getElementById("activity-panel-close");

const SEATS = [
  { left: "14%", bottom: "16%" },
  { left: "68%", bottom: "18%" },
  { left: "40%", bottom: "7%" },
  { left: "28%", bottom: "5%" },
  { left: "52%", bottom: "6%" },
  { left: "6%", bottom: "9%" },
  { left: "82%", bottom: "10%" },
];

/** @type {Array<any>} */
let friendsCache = [];
let selectedId = null;
/** @type {Array<{id: string, fromUid: string, text: string, createdAt: number}>} */
let chatMessages = [];
let chatError = "";
let chatUnsub = null;
let sending = false;

function avatarSrc(friend) {
  const health = friend?.stats?.characterHealth;
  return buddyVisualForHealth(friend?.characterId, health ?? 100).src;
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

function selectedFriend() {
  return friendsCache.find((friend) => friend.id === selectedId) || null;
}

function stopChat() {
  if (typeof chatUnsub === "function") {
    chatUnsub();
  }
  chatUnsub = null;
}

function renderLounge() {
  if (!lounge) return;
  if (!friendsCache.length) {
    lounge.innerHTML = `<p class="activity-lounge-empty">Add friends from the Friends page — they'll hang out on the couches here.</p>`;
    return;
  }

  lounge.innerHTML = friendsCache
    .map((friend, index) => {
      const seat = SEATS[index % SEATS.length];
      const name = escapeHtml(friend.username || "friend");
      const selected = friend.id === selectedId ? " is-selected" : "";
      return `
        <button
          type="button"
          class="activity-seat${selected}"
          data-friend-id="${escapeHtml(friend.id)}"
          style="left:${seat.left};bottom:${seat.bottom}"
          aria-label="Open ${name}'s activity"
        >
          <img src="${avatarSrc(friend)}" alt="" />
        </button>
      `;
    })
    .join("");
}

function listeningLine(friend) {
  if (!friend.shareListening) return "Listening hidden";
  if (friend.listening?.isPlaying) {
    return `Listening to ${friend.listening.trackName || "a track"} — ${
      friend.listening.artistName || "unknown artist"
    }`;
  }
  return "Not playing anything right now";
}

function renderPanel() {
  if (!panel || !panelBody) return;
  const friend = selectedFriend();
  if (!friend) {
    panel.hidden = true;
    document.body.classList.remove("has-activity-panel");
    return;
  }

  panel.hidden = false;
  document.body.classList.add("has-activity-panel");

  const hasStats = Boolean(friend.shareStats && friend.stats);
  const status = friend.customStatus
    ? escapeHtml(friend.customStatus)
    : "No status set";
  const statsHtml = hasStats
    ? `
      <div class="activity-stat-chips" aria-label="Focus stats">
        <span class="activity-chip"><strong>${friend.stats.todayFocusPercent ?? 0}%</strong> today</span>
        <span class="activity-chip"><strong>${friend.stats.streakDays ?? 0}</strong> day streak</span>
        <span class="activity-chip"><strong>${formatWeekly(friend.stats.weeklyFocusMs)}</strong> this week</span>
      </div>
    `
    : `<p class="activity-listening is-muted">Stats hidden</p>`;

  const me = currentUid();
  const thread = chatMessages
    .map((msg) => {
      const mine = msg.fromUid === me;
      return `<li class="activity-chat-bubble ${mine ? "is-mine" : "is-theirs"}">${escapeHtml(
        msg.text
      )}</li>`;
    })
    .join("");

  panelBody.innerHTML = `
    <img class="activity-panel-avatar" src="${avatarSrc(friend)}" alt="" />
    <p class="activity-username">@${escapeHtml(friend.username || "friend")}</p>
    <p class="activity-status ${friend.customStatus ? "" : "is-muted"}">${status}</p>
    ${statsHtml}
    <p class="activity-listening">${escapeHtml(listeningLine(friend))}</p>
    <div class="activity-chat">
      <p class="field-label">Message</p>
      <ul class="activity-chat-thread" id="activity-chat-thread">${
        thread || `<li class="activity-chat-empty">Say hi — they'll see it next time they're here.</li>`
      }</ul>
      ${
        chatError
          ? `<p class="activity-status is-muted">${escapeHtml(chatError)}</p>`
          : ""
      }
      <form id="activity-chat-form" class="activity-chat-form">
        <input
          id="activity-chat-input"
          class="field-input"
          type="text"
          maxlength="400"
          placeholder="Type a message…"
          autocomplete="off"
        />
        <button class="btn btn-secondary btn-small" type="submit"${
          sending ? " disabled" : ""
        }>Send</button>
      </form>
    </div>
  `;

  const threadEl = document.getElementById("activity-chat-thread");
  if (threadEl) threadEl.scrollTop = threadEl.scrollHeight;

  document.getElementById("activity-chat-form")?.addEventListener("submit", onSendMessage);
}

async function openFriend(friendId) {
  if (selectedId === friendId && !panel?.hidden) {
    return;
  }
  selectedId = friendId;
  chatMessages = [];
  chatError = "";
  renderLounge();
  renderPanel();
  stopChat();
  try {
    chatUnsub = await listenChatMessages(friendId, (messages) => {
      chatMessages = messages;
      chatError = "";
      renderPanel();
    });
  } catch (error) {
    const raw = String(error?.message || error || "");
    chatError = /permission|insufficient/i.test(raw)
      ? "Messaging needs updated Firestore rules. Paste firestore.rules in Firebase Console and Publish."
      : raw || "Could not open chat.";
    renderPanel();
  }
}

function closePanel() {
  selectedId = null;
  chatMessages = [];
  chatError = "";
  stopChat();
  renderLounge();
  renderPanel();
}

async function onSendMessage(event) {
  event.preventDefault();
  const friend = selectedFriend();
  const input = document.getElementById("activity-chat-input");
  if (!friend || sending) return;
  sending = true;
  renderPanel();
  try {
    await sendChatMessage(friend.id, input?.value);
    if (input) input.value = "";
  } catch (error) {
    const raw = String(error?.message || error || "");
    chatError = /permission|insufficient/i.test(raw)
      ? "Messaging needs updated Firestore rules. Paste firestore.rules in Firebase Console and Publish."
      : raw;
  } finally {
    sending = false;
    renderPanel();
    document.getElementById("activity-chat-input")?.focus();
  }
}

lounge?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-friend-id]");
  if (!button) return;
  void openFriend(button.getAttribute("data-friend-id"));
});

panelClose?.addEventListener("click", closePanel);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closePanel();
});

async function refresh() {
  if (!isCloudConfigured()) {
    if (banner) banner.textContent = "Add Firebase keys in web/firebase-config.js to load friend activity.";
    return;
  }
  const me = await loadUserDoc();
  if (!me) {
    if (banner) banner.textContent = "Sign in on the Settings page to see friends in the lounge.";
    friendsCache = [];
    closePanel();
    return;
  }
  if (banner) banner.textContent = "";
  if (me.shareListening) {
    await publishNowPlaying().catch(() => {});
  }
  friendsCache = await loadFriendsActivity();
  if (selectedId && !friendsCache.some((friend) => friend.id === selectedId)) {
    closePanel();
    return;
  }
  renderLounge();
  const typing = document.activeElement?.id === "activity-chat-input";
  if (selectedId && !typing) renderPanel();
}

await bootCloudSync();
if (isCloudConfigured()) {
  await listenAuth(() => refresh());
  setInterval(refresh, 20_000);
} else {
  refresh();
}
