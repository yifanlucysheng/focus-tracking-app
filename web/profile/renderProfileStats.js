/** @typedef {import('./profileTypes.js').ProfileStatsView} ProfileStatsView */

/**
 * @param {string} characterId
 * @returns {{ src: string, alt: string, name: string }}
 */
function characterMeta(characterId) {
  if (characterId === "cat") {
    return {
      src: "../assets/cat.png",
      alt: "Cat buddy",
      name: "Cat Buddy",
    };
  }

  return {
    src: "../assets/sleepbunny.png",
    alt: "Sleep bunny buddy",
    name: "Moon Buddy",
  };
}

/**
 * @param {HTMLElement} root
 * @param {ProfileStatsView} stats
 * @param {{ characterId?: string }} [options]
 */
export function renderProfileStats(root, stats, options = {}) {
  if (!root) return;

  const characterId = options.characterId || "sleepbunny";
  const buddy = characterMeta(characterId);
  const empty = !stats.hasSessions;

  const streakText = empty
    ? "No Focus Streak yet"
    : stats.focusStreakDays <= 0
      ? "Start your Focus Streak today"
      : `${stats.focusStreakDays} day Focus Streak`;

  const healthPct = empty ? 0 : stats.characterHealth;
  const xpPct = Math.round(Math.min(1, Math.max(0, stats.xpProgress)) * 100);

  root.innerHTML = `
    <div class="profile-layout">
      <div class="profile-hero-card">
        <div class="profile-buddy-wrap">
          <img class="profile-buddy-img" src="${buddy.src}" alt="${buddy.alt}" />
        </div>
        <div class="profile-buddy-meta">
          <p class="profile-kicker">Your companion</p>
          <h3 class="profile-buddy-name">${buddy.name}</h3>
          <p class="profile-health-note">Make sure to stay on task to keep your companion healthy!</p>
          <p class="profile-health-label">
            Character Health
            <span>${empty ? "—" : `${healthPct}% · ${stats.characterHealthLabel}`}</span>
          </p>
          <div
            class="profile-bar"
            role="progressbar"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow="${healthPct}"
            aria-label="Character health"
          >
            <div class="profile-bar-fill profile-bar-health" style="width: ${healthPct}%"></div>
          </div>
        </div>
      </div>

      <div class="profile-flame-card ${empty ? "is-empty" : ""}">
        <p class="profile-flame-text">${streakText}</p>
        <p class="profile-flame-sub">
          ${
            empty
              ? "Complete at least one session a day to keep your streak going."
              : "Consecutive days with at least one completed session."
          }
        </p>
      </div>

      <div class="profile-level-card">
        <div class="profile-level-head">
          <p class="profile-kicker">Focus Level</p>
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
          <div class="profile-bar-fill profile-bar-xp" style="width: ${empty ? 0 : xpPct}%"></div>
        </div>
        <p class="profile-level-sub">
          ${
            empty
              ? "Earn XP from focused minutes once sessions start syncing."
              : `${stats.xpIntoLevel} / ${stats.xpForNextLevel} XP to Level ${stats.level + 1}`
          }
        </p>
      </div>

      <div class="profile-stat-grid">
        <article class="profile-stat-tile">
          <p class="profile-stat-label">Longest Focus Session</p>
          <p class="profile-stat-value">${empty ? "—" : stats.longestSessionLabel}</p>
          <p class="profile-stat-hint">${
            empty ? "No focus sessions yet" : "Your longest completed session"
          }</p>
        </article>

        <article class="profile-stat-tile">
          <p class="profile-stat-label">Sessions Completed</p>
          <p class="profile-stat-value">${empty ? "0" : String(stats.sessionsCompleted)}</p>
          <p class="profile-stat-hint">${empty ? "No focus sessions yet" : "All-time completed sessions"}</p>
        </article>

        <article class="profile-stat-tile">
          <p class="profile-stat-label">Top Distraction</p>
          <p class="profile-stat-value profile-stat-domain">${
            empty || !stats.topDistraction ? "—" : stats.topDistraction
          }</p>
          <p class="profile-stat-hint">${
            empty || !stats.topDistraction
              ? "No focus sessions yet"
              : "Site that pulled you away most"
          }</p>
        </article>
      </div>
    </div>
  `;
}
