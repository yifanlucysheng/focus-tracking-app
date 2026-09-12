/**
 * Helpers for session summary stats synced to Supabase profiles
 * (longest session, session count, top domains, character health).
 * Aggregates only — not full browsing history.
 */

/**
 * @param {string} [url]
 * @returns {string|null}
 */
export function hostnameFromUrl(url) {
  try {
    const host = new URL(String(url || "")).hostname.toLowerCase();
    if (!host) return null;
    return host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Build distraction / productive domain maps from focus-log entries in a time window.
 *
 * @param {Array<{ status?: string, timestamp?: number, domain?: string|null, url?: string }>} focusLog
 * @param {number} startedAt
 * @param {number} endedAt
 * @returns {{ distractionDomains: Record<string, number>, productiveDomains: Record<string, number> }}
 */
export function aggregateDomainsFromFocusLog(focusLog, startedAt, endedAt) {
  /** @type {Record<string, number>} */
  const distractionDomains = {};
  /** @type {Record<string, number>} */
  const productiveDomains = {};

  const start = Number(startedAt) || 0;
  const end = Number(endedAt) || Date.now();
  const list = Array.isArray(focusLog) ? focusLog : [];

  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const ts = Number(entry.timestamp);
    if (!Number.isFinite(ts) || ts < start || ts > end) continue;

    const domain =
      (typeof entry.domain === "string" && entry.domain) ||
      hostnameFromUrl(entry.url);
    if (!domain) continue;

    if (entry.status === "distracted") {
      distractionDomains[domain] = (distractionDomains[domain] || 0) + 1;
    } else if (entry.status === "on-task") {
      productiveDomains[domain] = (productiveDomains[domain] || 0) + 1;
    }
  }

  return { distractionDomains, productiveDomains };
}

/**
 * @param {import('./profileTypes.js').ProfileStatsView} stats
 * @returns {{
 *   longest_session_ms: number,
 *   sessions_completed: number,
 *   top_distraction: string|null,
 *   top_productive_site: string|null,
 *   character_health: number,
 * }}
 */
export function publicSessionSummaryFromStats(stats) {
  return {
    longest_session_ms: Math.max(
      0,
      Math.floor(Number(stats.longestSessionMs) || 0)
    ),
    sessions_completed: Math.max(
      0,
      Math.floor(Number(stats.sessionsCompleted) || 0)
    ),
    top_distraction: stats.topDistraction ? String(stats.topDistraction) : null,
    top_productive_site: stats.topProductiveSite
      ? String(stats.topProductiveSite)
      : null,
    character_health: Math.max(
      0,
      Math.min(100, Math.floor(Number(stats.characterHealth) || 0))
    ),
  };
}
