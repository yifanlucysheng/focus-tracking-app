/** @typedef {import('./friendTypes.js').FriendProfile} FriendProfile */
/** @typedef {import('./friendTypes.js').LeaderboardMode} LeaderboardMode */
/** @typedef {import('./friendTypes.js').LeaderboardView} LeaderboardView */

/**
 * @param {string} [characterId]
 * @returns {string}
 */
function avatarSrc(characterId) {
  return characterId === "cat" ? "/cat.png" : "/sleepbunny.png";
}

/**
 * @param {number} rank
 * @returns {string}
 */
function rankClass(rank) {
  if (rank === 1) return "is-gold";
  if (rank === 2) return "is-silver";
  if (rank === 3) return "is-bronze";
  return "";
}

/**
 * @param {HTMLElement} root
 * @param {LeaderboardView} view
 * @param {{
 *   onModeChange?: (mode: LeaderboardMode) => void,
 *   onAddFriend?: (username: string) => void,
 *   demoNotice?: string,
 *   username?: string,
 * }} [handlers]
 */
export function renderFriendsLeaderboard(root, view, handlers = {}) {
  if (!root) return;

  const top = view.topFriend;
  const mode = view.mode;
  const who = (handlers.username || "You").trim() || "You";
  const whose = `${who}'s`;

  root.innerHTML = `
    <div class="friends-layout">
      <div class="friends-upper">
        <div class="friends-add-card">
          <label class="field-label" for="friend-username-input">Add Friend</label>
          <div class="friends-add-row">
            <input
              id="friend-username-input"
              class="field-input"
              type="text"
              placeholder="Friend's username"
              autocomplete="off"
            />
            <button id="add-friend-btn" class="btn btn-secondary btn-small" type="button">Add</button>
          </div>
          <p class="friends-demo-note">
            ${
              handlers.demoNotice ||
              "Demo mode: friends are mock profiles for UI testing — this does not connect to real accounts yet."
            }
          </p>
        </div>

        <div class="friends-summary-grid">
          <article class="friends-summary-card">
            <p class="profile-kicker">${whose} Rank</p>
            <p class="friends-summary-value">
              #${view.yourRank || "—"} out of ${view.totalFriends} friends
            </p>
          </article>

          <article class="friends-summary-card">
            <p class="profile-kicker">Top Focus Friend</p>
            <p class="friends-summary-value">
              ${top ? top.username : "No friends yet"}
            </p>
          </article>
        </div>
      </div>

      <div class="friends-leaderboard-block">
        <p class="friends-leaderboard-heading">Leaderboard</p>
        <p class="friends-compare-msg">${view.comparisonMessage}</p>

        <div class="friends-mode-toggle" role="tablist" aria-label="Leaderboard mode">
        <button
          type="button"
          class="friends-mode-btn ${mode === "level" ? "is-active" : ""}"
          data-mode="level"
          role="tab"
          aria-selected="${mode === "level"}"
        >
          Focus Level
        </button>
        <button
          type="button"
          class="friends-mode-btn ${mode === "streak" ? "is-active" : ""}"
          data-mode="streak"
          role="tab"
          aria-selected="${mode === "streak"}"
        >
          Focus Streak
        </button>
      </div>

      <ol class="friends-leaderboard" aria-label="Friends leaderboard">
        ${view.entries
          .map((entry) => {
            const p = entry.profile;
            const you = Boolean(p.isCurrentUser);
            return `
              <li class="friends-row ${rankClass(entry.rank)} ${you ? "is-you" : ""}">
                <span class="friends-rank">#${entry.rank}</span>
                <img class="friends-avatar" src="${avatarSrc(p.characterId)}" alt="" />
                <div class="friends-row-main">
                  <p class="friends-username">
                    ${p.username}${you ? " <span class='friends-you-tag'>(you)</span>" : ""}
                    ${p.isMock ? "<span class='friends-mock-tag'>demo</span>" : ""}
                  </p>
                  <p class="friends-row-meta">
                    Level ${p.focusLevel} · ${p.focusStreak} day streak · ${p.xp} XP
                  </p>
                </div>
              </li>
            `;
          })
          .join("")}
      </ol>
      </div>
    </div>
  `;

  root.querySelectorAll(".friends-mode-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const next = /** @type {LeaderboardMode} */ (button.getAttribute("data-mode"));
      if (next && handlers.onModeChange) handlers.onModeChange(next);
    });
  });

  const addBtn = root.querySelector("#add-friend-btn");
  const input = /** @type {HTMLInputElement|null} */ (root.querySelector("#friend-username-input"));

  addBtn?.addEventListener("click", () => {
    const username = input?.value?.trim() || "";
    if (handlers.onAddFriend) handlers.onAddFriend(username);
  });

  input?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const username = input.value.trim();
      if (handlers.onAddFriend) handlers.onAddFriend(username);
    }
  });
}
