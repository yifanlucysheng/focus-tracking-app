/** @typedef {import('./profileTypes.js').ProfileStatsView} ProfileStatsView */

import { buddyVisualForHealth } from "./characterHealthVisual.js";

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
 * @param {ProfileStatsView} stats
 * @param {{ characterId?: string, username?: string }} [options]
 */
export function renderProfileStats(root, stats, options = {}) {
  if (!root) return;

  const characterId = options.characterId || "sleepbunny";
  const emptyPrivate = !stats.hasSessions;
  const username = (options.username || "You").trim() || "You";
  const who = escapeHtml(username);
  const whose = `${who}'s`;

  const streakHeadline =
    stats.focusStreakDays <= 0
      ? `No Focus Streak yet`
      : `${stats.focusStreakDays} day Focus Streak`;

  const showHealth = Boolean(stats.hasSessions || stats.liveSessionActive);
  const healthPct = Math.max(
    0,
    Math.min(100, Math.floor(Number(stats.characterHealth) || 0))
  );
  const buddy = buddyVisualForHealth(
    characterId,
    showHealth ? healthPct : 95
  );
  const xpPct = Math.round(Math.min(1, Math.max(0, stats.xpProgress)) * 100);

  root.innerHTML = `
    <div class="profile-layout">
      <div class="profile-hero-card">
        <div class="profile-buddy-wrap">
          <img
            class="profile-buddy-img"
            data-buddy-visual
            src="${buddy.src}"
            alt="${buddy.alt}"
          />
        </div>
        <div class="profile-buddy-meta">
          <p class="profile-kicker">${whose} companion</p>
          <h3 class="profile-buddy-name">${buddy.name}</h3>
          <p class="profile-health-note">Make sure to stay on task to keep your companion healthy!</p>
          <p class="profile-health-label">
            Character Health
            <span data-health-label>${
              showHealth
                ? `${healthPct}/100 · ${stats.characterHealthLabel}`
                : "—"
            }</span>
          </p>
          <div
            class="profile-bar"
            role="progressbar"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow="${showHealth ? healthPct : 0}"
            aria-label="Character health"
            data-health-bar
          >
            <div
              class="profile-bar-fill profile-bar-health"
              data-health-fill
              style="width: ${showHealth ? healthPct : 0}%"
            ></div>
          </div>
        </div>
      </div>

      <div class="profile-streak-card profile-card-tone-a ${stats.focusStreakDays <= 0 ? "is-empty" : ""}">
        <p class="profile-stat-label">${whose} Focus Streak</p>
        <p class="profile-streak-text">${streakHeadline}</p>
        <p class="profile-streak-sub">
          ${
            stats.focusStreakDays <= 0
              ? "Complete at least one session a day to keep your streak going."
              : "Consecutive days with at least one completed session."
          }
        </p>
      </div>

      <div class="profile-level-card profile-card-tone-a">
        <div class="profile-level-head">
          <p class="profile-kicker">${whose} Focus Level</p>
          <p class="profile-level-value">Level ${stats.level}</p>
        </div>
        <div
          class="profile-bar"
          role="progressbar"
          aria-valuemin="0"
          aria-valuemax="${stats.xpForNextLevel}"
          aria-valuenow="${stats.xpIntoLevel}"
          aria-label="XP progress to next level"
        >
          <div class="profile-bar-fill profile-bar-xp" style="width: ${xpPct}%"></div>
        </div>
        <p class="profile-level-sub">
          ${stats.xpIntoLevel} / ${stats.xpForNextLevel} XP
        </p>
      </div>

      <div class="profile-stat-grid">
        <article class="profile-stat-tile profile-card-tone-b">
          <p class="profile-stat-label">${whose} Longest Focus Session</p>
          <p class="profile-stat-value">${emptyPrivate ? "—" : stats.longestSessionLabel}</p>
          <p class="profile-stat-hint">${
            emptyPrivate ? "No focus sessions yet" : "Longest completed session"
          }</p>
        </article>

        <article class="profile-stat-tile profile-card-tone-b">
          <p class="profile-stat-label">${whose} Sessions Completed</p>
          <p class="profile-stat-value">${emptyPrivate ? "0" : String(stats.sessionsCompleted)}</p>
          <p class="profile-stat-hint">${emptyPrivate ? "No focus sessions yet" : "All-time completed sessions"}</p>
        </article>

        <article class="profile-stat-tile profile-card-tone-b">
          <p class="profile-stat-label">${whose} Top Distraction</p>
          <p class="profile-stat-value profile-stat-domain">${
            emptyPrivate || !stats.topDistraction ? "—" : escapeHtml(stats.topDistraction)
          }</p>
          <p class="profile-stat-hint">${
            emptyPrivate || !stats.topDistraction
              ? "No focus sessions yet"
              : "Site that pulled you away most"
          }</p>
        </article>

        <article class="profile-stat-tile profile-card-tone-b">
          <p class="profile-stat-label">${whose} Top Productive Site</p>
          <p class="profile-stat-value profile-stat-domain">${
            emptyPrivate || !stats.topProductiveSite ? "—" : escapeHtml(stats.topProductiveSite)
          }</p>
          <p class="profile-stat-hint">${
            emptyPrivate || !stats.topProductiveSite
              ? "No focus sessions yet"
              : "Site you stayed on-task with most"
          }</p>
        </article>
      </div>
    </div>
  `;
}
