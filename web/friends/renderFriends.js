/** @typedef {import('./friendTypes.js').FriendProfile} FriendProfile */
/** @typedef {import('./friendTypes.js').LeaderboardMode} LeaderboardMode */
/** @typedef {import('./friendTypes.js').LeaderboardView} LeaderboardView */
/** @typedef {import('./friendsService.js').FriendshipWithProfiles} FriendshipWithProfiles */

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
 * @param {string} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * @param {HTMLElement} root
 * @param {LeaderboardView} view
 * @param {{
 *   onModeChange?: (mode: LeaderboardMode) => void,
 *   onAddFriend?: (username: string) => void | Promise<void>,
 *   onAcceptRequest?: (friendshipId: string) => void | Promise<void>,
 *   onDeclineRequest?: (friendshipId: string) => void | Promise<void>,
 *   username?: string,
 *   addInputValue?: string,
 *   addBusy?: boolean,
 *   addStatus?: { kind?: 'idle' | 'error' | 'success' | 'loading', message?: string },
 *   incomingRequests?: FriendshipWithProfiles[],
 *   requestActionId?: string|null,
 *   requestsError?: string,
 *   leaderboardLoading?: boolean,
 *   leaderboardError?: string,
 * }} [handlers]
 */
export function renderFriendsLeaderboard(root, view, handlers = {}) {
  if (!root) return;

  const top = view.topFriend;
  const mode = view.mode;
  const who = (handlers.username || "You").trim() || "You";
  const whose = `${who}'s`;
  const addStatus = handlers.addStatus || { kind: "idle", message: "" };
  const addBusy = Boolean(handlers.addBusy);
  const incoming = handlers.incomingRequests || [];
  const requestActionId = handlers.requestActionId || null;
  const addInputValue = handlers.addInputValue ?? "";
  const leaderboardLoading = Boolean(handlers.leaderboardLoading);
  const leaderboardError = handlers.leaderboardError || "";
  const hasFriends = view.entries.length > 0;
  const rankLabel = hasFriends
    ? `You're #${view.yourRank} out of ${view.totalFriends} friends`
    : "Add some friends to start your leaderboard!";

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
              value="${escapeHtml(addInputValue)}"
              ${addBusy ? "disabled" : ""}
            />
            <button id="add-friend-btn" class="btn btn-secondary btn-small" type="button" ${addBusy ? "disabled" : ""}>
              ${addBusy ? "Adding…" : "Add"}
            </button>
          </div>
          <p class="friends-add-status ${statusClass(addStatus.kind)}" aria-live="polite">
            ${escapeHtml(addStatus.message || "")}
          </p>
        </div>

        <div class="friends-requests-card">
          <p class="field-label">Friend Requests</p>
          ${
            handlers.requestsError
              ? `<p class="friends-add-status is-error">${escapeHtml(handlers.requestsError)}</p>`
              : ""
          }
          ${
            incoming.length === 0
              ? `<p class="friends-requests-empty">No pending requests</p>`
              : `<ul class="friends-requests-list" aria-label="Incoming friend requests">
                  ${incoming
                    .map((req) => {
                      const from = req.requester?.username || "unknown";
                      const busy = requestActionId === req.id;
                      return `
                        <li class="friends-request-row" data-request-id="${escapeHtml(req.id)}">
                          <p class="friends-request-username">@${escapeHtml(from)}</p>
                          <div class="friends-request-actions">
                            <button
                              type="button"
                              class="btn btn-secondary btn-small"
                              data-accept-request="${escapeHtml(req.id)}"
                              ${busy || requestActionId ? "disabled" : ""}
                            >
                              ${busy ? "…" : "Accept"}
                            </button>
                            <button
                              type="button"
                              class="btn btn-small friends-decline-btn"
                              data-decline-request="${escapeHtml(req.id)}"
                              ${busy || requestActionId ? "disabled" : ""}
                            >
                              Deny
                            </button>
                          </div>
                        </li>
                      `;
                    })
                    .join("")}
                </ul>`
          }
        </div>

        <div class="friends-summary-grid">
          <article class="friends-summary-card">
            <p class="profile-kicker">${whose} Rank</p>
            <p class="friends-summary-value ${hasFriends ? "" : "is-muted"}">
              ${escapeHtml(rankLabel)}
            </p>
          </article>

          <article class="friends-summary-card">
            <p class="profile-kicker">Top Focus Friend</p>
            <p class="friends-summary-value ${top ? "" : "is-muted"}">
              ${top ? escapeHtml(top.username) : "No friends yet"}
            </p>
          </article>
        </div>
      </div>

      <div class="friends-leaderboard-block">
        <p class="friends-leaderboard-heading">Leaderboard</p>
        ${
          leaderboardLoading
            ? `<p class="friends-leaderboard-status" aria-live="polite">Loading leaderboard…</p>`
            : leaderboardError
              ? `<p class="friends-leaderboard-status is-error" aria-live="polite">${escapeHtml(leaderboardError)}</p>`
              : !hasFriends
                ? `<p class="friends-leaderboard-empty">Add some friends to start your leaderboard!</p>`
                : `
        <p class="friends-compare-msg">${escapeHtml(view.comparisonMessage)}</p>

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
                    ${escapeHtml(p.username)}${you ? " <span class='friends-you-tag'>(you)</span>" : ""}
                  </p>
                  <p class="friends-row-meta">
                    level ${p.focusLevel} · ${p.focusStreak} day streak · ${p.xp} xp
                  </p>
                </div>
              </li>
            `;
          })
          .join("")}
      </ol>`
        }
      </div>
    </div>
  `;

  if (!leaderboardLoading && !leaderboardError && hasFriends) {
    root.querySelectorAll(".friends-mode-btn").forEach((button) => {
      button.addEventListener("click", () => {
        const next = /** @type {LeaderboardMode} */ (button.getAttribute("data-mode"));
        if (next && handlers.onModeChange) handlers.onModeChange(next);
      });
    });
  }

  const addBtn = root.querySelector("#add-friend-btn");
  const input = /** @type {HTMLInputElement|null} */ (root.querySelector("#friend-username-input"));

  const submitAdd = () => {
    if (addBusy) return;
    const username = input?.value?.trim() || "";
    handlers.onAddFriend?.(username);
  };

  addBtn?.addEventListener("click", submitAdd);
  input?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitAdd();
    }
  });

  root.querySelectorAll("[data-accept-request]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.getAttribute("data-accept-request");
      if (id) handlers.onAcceptRequest?.(id);
    });
  });

  root.querySelectorAll("[data-decline-request]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.getAttribute("data-decline-request");
      if (id) handlers.onDeclineRequest?.(id);
    });
  });
}

/**
 * @param {string} [kind]
 * @returns {string}
 */
function statusClass(kind) {
  if (kind === "error") return "is-error";
  if (kind === "success") return "is-success";
  if (kind === "loading") return "is-loading";
  return "";
}
