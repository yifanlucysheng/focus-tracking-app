const KEYWORDS_KEY = "taskKeywords";
const FOCUS_LOG_KEY = "focusLog";
const MOOD_KEY = "characterMood";
const LOCK_IN_KEY = "lockInActive";
const TASK_TEXT_KEY = "taskText";
const TIMER_KEY = "timerState";
const TIMER_ALARM = "focus-timer-end";
const DEFAULT_SECONDS = 25 * 60;
const GEMINI_KEY = "geminiApiKey";
const GEMINI_MODEL = "gemini-2.5-flash";
const DISTRACTED_DELAY_MS = 10_000;
const LIVE_HEALTH_SYNC_MIN_MS = 1500;
const CHARACTER_HEALTH_KEY = "characterHealth";
const SELECTED_CHARACTER_KEY = "focusBuddy.selectedCharacter";
/** Session starts at stage 0 (95 HP / cat.png). */
const SESSION_START_HEALTH = 95;
const HEALTH_STAGE_VALUES = [95, 80, 65, 50, 35, 20, 0];
/** Stay on the same tab/status this long before on-task / off-task timers start. */
const TAB_DWELL_MS = 10_000;
/** No stage up/down for this long after lock-in starts (blocks stale/race drops to cat7). */
const HEALTH_DROP_GRACE_MS = 20_000;
/** After dwell, 2 minutes on-task → one stage healthier. */
const ON_TASK_STEP_MS = 2 * 60 * 1000;
/** After dwell, 1 minute distracted → one stage lower. */
const OFF_TASK_STEP_MS = 1 * 60 * 1000;

let taskKeywords = [];
let lockInActive = false;
let distractedTimerId = null;
let geminiCache = new Map();
let geminiInflight = new Map();
let lastLiveHealthSynced = null;
let lastLiveHealthSyncAt = 0;
let liveHealthSyncTimer = null;
let liveHealthTickTimer = null;
let healthResetRetryTimer = null;
/** @type {number} 0 = healthiest … 6 = lowest */
let sessionHealthStage = 0;
/** @type {number} */
let lockInStartedAt = 0;
/**
 * Tracks dwell + accrued on-task / off-task time for stage changes.
 * @type {{
 *   status: 'on-task'|'distracted'|null,
 *   tabId: number|null,
 *   since: number,
 *   dwellDone: boolean,
 *   accruedMs: number,
 *   lastTick: number,
 * }|null}
 */
let healthProgress = null;

function healthFromStage(stage) {
  const i = Math.max(0, Math.min(HEALTH_STAGE_VALUES.length - 1, Math.floor(Number(stage) || 0)));
  return HEALTH_STAGE_VALUES[i];
}

function stageFromHealth(health) {
  const h = Math.max(0, Math.min(100, Number(health) || 0));
  let best = 0;
  let bestDist = Math.abs(HEALTH_STAGE_VALUES[0] - h);
  for (let i = 1; i < HEALTH_STAGE_VALUES.length; i += 1) {
    const dist = Math.abs(HEALTH_STAGE_VALUES[i] - h);
    if (dist < bestDist) {
      best = i;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * @param {number} health
 * @returns {string}
 */
function catFileForHealth(health) {
  const stage = stageFromHealth(health);
  if (stage <= 0) return "cat.png";
  return `cat${stage + 1}.png`;
}

/**
 * Resolve the PNG shown in the popup + on-page overlay.
 * @returns {Promise<{ characterId: string, buddyFile: string, characterHealth: number, mood: string, liveSessionActive: boolean }>}
 */
async function resolveBuddyVisual() {
  const result = await chrome.storage.local.get([
    SELECTED_CHARACTER_KEY,
    CHARACTER_HEALTH_KEY,
    MOOD_KEY,
    "liveSessionActive",
  ]);
  const characterId =
    result[SELECTED_CHARACTER_KEY] === "cat" ? "cat" : "sleepbunny";
  const mood =
    result[MOOD_KEY] === "distracted" ? "distracted" : "on-task";
  const liveSessionActive = Boolean(result.liveSessionActive);
  const rawHealth = Number(result[CHARACTER_HEALTH_KEY]);
  let characterHealth = Number.isFinite(rawHealth)
    ? rawHealth
    : SESSION_START_HEALTH;
  if (liveSessionActive && characterHealth <= 0) {
    characterHealth = SESSION_START_HEALTH;
  }

  const buddyFile =
    characterId === "cat"
      ? catFileForHealth(characterHealth)
      : mood === "distracted"
        ? "angrybunny.png"
        : "sleepbunny.png";

  return {
    characterId,
    buddyFile,
    characterHealth,
    mood,
    liveSessionActive,
  };
}

/**
 * Push current buddy art to every tab overlay (and keep storage as source of truth for popup).
 */
async function broadcastBuddyVisual() {
  const visual = await resolveBuddyVisual();
  try {
    const tabs = await chrome.tabs.query({});
    await Promise.all(
      tabs.map((tab) => {
        if (tab.id == null) return Promise.resolve();
        return chrome.tabs
          .sendMessage(tab.id, {
            type: "BUDDY_VISUAL",
            ...visual,
          })
          .catch(() => {});
      })
    );
  } catch {
    // No tabs / no permission.
  }
  return visual;
}

/**
 * @param {string} characterId
 */
async function setSelectedCharacter(characterId) {
  const id = characterId === "cat" ? "cat" : "sleepbunny";
  await chrome.storage.local.set({ [SELECTED_CHARACTER_KEY]: id });
  await broadcastBuddyVisual();
  return id;
}

function resetHealthProgressState() {
  healthProgress = {
    status: null,
    tabId: null,
    since: Date.now(),
    dwellDone: false,
    accruedMs: 0,
    lastTick: Date.now(),
  };
}

/**
 * Tab or focus-status changes restart the 10s dwell before timers run.
 * @param {'on-task'|'distracted'} status
 * @param {number|null|undefined} tabId
 */
function noteFocusStatusForHealth(status, tabId) {
  const now = Date.now();
  const tid = typeof tabId === "number" ? tabId : null;
  if (!healthProgress) resetHealthProgressState();
  const same =
    healthProgress.status === status && healthProgress.tabId === tid;
  if (same) return;
  healthProgress = {
    status,
    tabId: tid,
    since: now,
    dwellDone: false,
    accruedMs: 0,
    lastTick: now,
  };
}

/**
 * Advance on-task / off-task stage timers after the 10s tab dwell.
 */
async function tickSessionHealth() {
  if (!lockInActive) return;
  if (!healthProgress) resetHealthProgressState();

  const now = Date.now();
  // Cap dt so a sleeping service worker can't dump minutes of progress in one tick.
  const dt = Math.min(2000, Math.max(0, now - (healthProgress.lastTick || now)));
  healthProgress.lastTick = now;

  // Hard grace: never change stages right after lock-in (prevents instant cat7).
  if (now - lockInStartedAt < HEALTH_DROP_GRACE_MS) return;

  if (!healthProgress.status) return;

  if (!healthProgress.dwellDone) {
    if (now - healthProgress.since >= TAB_DWELL_MS) {
      healthProgress.dwellDone = true;
      healthProgress.accruedMs = 0;
    }
    return;
  }

  healthProgress.accruedMs += dt;

  if (healthProgress.status === "on-task") {
    if (healthProgress.accruedMs < ON_TASK_STEP_MS) return;
    healthProgress.accruedMs = 0;
    if (sessionHealthStage <= 0) return; // already healthiest
    sessionHealthStage -= 1;
    await pushLiveCharacterHealth(healthFromStage(sessionHealthStage), {
      liveSessionActive: true,
      force: true,
    });
    return;
  }

  if (healthProgress.status === "distracted") {
    if (healthProgress.accruedMs < OFF_TASK_STEP_MS) return;
    healthProgress.accruedMs = 0;
    if (sessionHealthStage >= HEALTH_STAGE_VALUES.length - 1) return;
    sessionHealthStage += 1;
    await pushLiveCharacterHealth(healthFromStage(sessionHealthStage), {
      liveSessionActive: true,
      force: true,
    });
  }
}

function stopLiveHealthTicker() {
  if (liveHealthSyncTimer !== null) {
    clearTimeout(liveHealthSyncTimer);
    liveHealthSyncTimer = null;
  }
  if (liveHealthTickTimer !== null) {
    clearInterval(liveHealthTickTimer);
    liveHealthTickTimer = null;
  }
}

function startLiveHealthTicker() {
  stopLiveHealthTicker();
  liveHealthTickTimer = setInterval(() => {
    void tickSessionHealth();
  }, 1000);
}

try {
  importScripts("secrets.local.js");
} catch (err) {
  console.warn(
    "[Focus Buddy] Could not load secrets.local.js from the extension root:",
    err?.message || err
  );
}

// Auth (FocusBuddyAuth) is inlined into service-worker.js by
// `npm run build:extension`. Do not importScripts the vendor bundle here —
// Chrome MV3 often fails that fetch with "unknown error when fetching the script".
if (!globalThis.FocusBuddyAuth) {
  console.error(
    "[Focus Buddy] Auth bundle missing. Run npm run build:extension and reload the extension."
  );
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function readSecretString(value) {
  return String(value || "").trim();
}

/**
 * Placeholder / empty credentials are treated as unconfigured.
 * @param {Record<string, string>} config
 * @returns {boolean}
 */
function hasRealFirebaseCredentials(config) {
  const apiKey = readSecretString(config?.apiKey);
  const projectId = readSecretString(config?.projectId);
  if (!apiKey || !projectId) return false;
  if (apiKey.includes("YOUR_FIREBASE")) return false;
  if (projectId.includes("YOUR_PROJECT")) return false;
  return true;
}

function readFirebaseConfigFromSecrets() {
  if (globalThis.FIREBASE_CONFIG && typeof globalThis.FIREBASE_CONFIG === "object") {
    return globalThis.FIREBASE_CONFIG;
  }
  return {
    apiKey: readSecretString(globalThis.FIREBASE_API_KEY),
    authDomain: readSecretString(globalThis.FIREBASE_AUTH_DOMAIN),
    projectId: readSecretString(globalThis.FIREBASE_PROJECT_ID),
    storageBucket: readSecretString(globalThis.FIREBASE_STORAGE_BUCKET),
    messagingSenderId: readSecretString(globalThis.FIREBASE_MESSAGING_SENDER_ID),
    appId: readSecretString(globalThis.FIREBASE_APP_ID),
  };
}

const AUTH_READY = (async () => {
  if (!globalThis.FocusBuddyAuth) {
    return { configured: false, signedIn: false, user: null, profile: null };
  }

  const firebaseConfig = readFirebaseConfigFromSecrets();

  if (!hasRealFirebaseCredentials(firebaseConfig)) {
    return {
      configured: false,
      configMessage:
        "Connect FocusBuddy: open secrets.local.js and paste the same Firebase web keys as web/firebase-config.js, then reload the extension.",
      signedIn: false,
      user: null,
      profile: null,
    };
  }

  try {
    const state = await globalThis.FocusBuddyAuth.init(firebaseConfig);
    if (globalThis.FocusBuddyAuth.flushPendingPublicSync) {
      void globalThis.FocusBuddyAuth.flushPendingPublicSync();
    }
    return state;
  } catch (err) {
    console.warn("[Focus Buddy] Auth init:", err?.message || err);
    return {
      configured: false,
      configMessage: err?.message || "Auth is not configured.",
      signedIn: false,
      user: null,
      profile: null,
    };
  }
})();

/**
 * @returns {Promise<import('./chrome-auth/authService.js').ExtensionAuthState>}
 */
async function getExtensionAuthState() {
  await AUTH_READY;
  if (!globalThis.FocusBuddyAuth) {
    return {
      configured: false,
      configMessage: "Auth bundle missing. Run npm run build:extension-auth.",
      signedIn: false,
      user: null,
      profile: null,
    };
  }
  return globalThis.FocusBuddyAuth.getAuthState();
}

function defaultTimerState() {
  return {
    durationSeconds: DEFAULT_SECONDS,
    remainingSeconds: DEFAULT_SECONDS,
    endsAt: null,
    status: "idle",
  };
}

async function readTimer() {
  const result = await chrome.storage.local.get(TIMER_KEY);
  const state = { ...defaultTimerState(), ...(result[TIMER_KEY] || {}) };

  if (state.status === "running" && state.endsAt) {
    const remaining = Math.max(0, Math.ceil((state.endsAt - Date.now()) / 1000));
    if (remaining <= 0) {
      return finishTimer(state);
    }
    state.remainingSeconds = remaining;
  }

  return state;
}

async function writeTimer(state) {
  await chrome.storage.local.set({ [TIMER_KEY]: state });
  await updateBadge(state);
  return state;
}

async function finishTimer(state) {
  // Already finished + accounted — avoid double XP / streak.
  if (state.status === "finished" && state.completionHandled) {
    return state;
  }

  const endedAt = Date.now();
  const startedAt =
    typeof state.startedAt === "number"
      ? state.startedAt
      : endedAt - Math.max(0, Number(state.durationSeconds) || 0) * 1000;
  const sessionId =
    state.sessionId ||
    `session-${startedAt}-${Math.floor(Number(state.durationSeconds) || 0)}`;

  const finished = {
    ...state,
    status: "finished",
    remainingSeconds: 0,
    endsAt: null,
    startedAt,
    endedAt,
    sessionId,
    completionHandled: false,
  };
  await chrome.alarms.clear(TIMER_ALARM);
  await writeTimer(finished);

  stopLiveHealthTicker();
  const finalHealth = healthFromStage(sessionHealthStage);
  await pushLiveCharacterHealth(finalHealth, {
    liveSessionActive: false,
    force: true,
  });
  await recordFocusSessionFromTimer(finished, finalHealth);

  const handled = { ...finished, completionHandled: true };
  return writeTimer(handled);
}

/**
 * Persist + sync public stats once per timer sessionId.
 * Local save always happens; Supabase sync is best-effort with retry queue.
 *
 * @param {object} timerState
 * @param {number} [characterHealth]
 */
async function recordFocusSessionFromTimer(timerState, characterHealth) {
  await AUTH_READY;
  if (!globalThis.FocusBuddyAuth?.recordCompletedSession) {
    console.warn(
      "[Focus Buddy] Stats module unavailable — completed timer not recorded to FocusBuddy stats."
    );
    return;
  }

  const durationMs = Math.max(0, Number(timerState.durationSeconds) || 0) * 1000;
  const onTaskRatio = await estimateOnTaskRatio(
    timerState.startedAt,
    timerState.endedAt
  );
  const domainMaps = await buildDomainMapsForSession(
    timerState.startedAt,
    timerState.endedAt
  );
  const health =
    typeof characterHealth === "number"
      ? characterHealth
      : healthFromStage(sessionHealthStage);

  try {
    const result = await globalThis.FocusBuddyAuth.recordCompletedSession({
      sessionId: timerState.sessionId,
      startedAt: timerState.startedAt,
      endedAt: timerState.endedAt,
      durationMs,
      onTaskRatio,
      characterHealth: health,
      distractionDomains: domainMaps.distractionDomains,
      productiveDomains: domainMaps.productiveDomains,
    });
    if (result?.skippedDuplicate) {
      console.info(
        "[Focus Buddy] Skipped duplicate session completion:",
        timerState.sessionId
      );
    }
    await pushLiveCharacterHealth(health, {
      liveSessionActive: false,
      force: true,
    });
  } catch (err) {
    console.error(
      "[Focus Buddy] Failed to record completed focus session (timer still finished):",
      err
    );
  }
}

/**
 * Time-weighted on-task ratio from focusLog ("spent" time, not sample counts).
 * Assumes on-task from session start until the first classification.
 * @param {number} startedAt
 * @param {number} endedAt
 * @returns {Promise<number>}
 */
async function estimateOnTaskRatio(startedAt, endedAt) {
  try {
    const start = Number(startedAt) || 0;
    const end = Math.max(start, Number(endedAt) || Date.now());
    if (end <= start) return 1;

    const result = await chrome.storage.local.get(FOCUS_LOG_KEY);
    const focusLog = Array.isArray(result[FOCUS_LOG_KEY])
      ? result[FOCUS_LOG_KEY]
      : [];
    const slice = focusLog
      .filter(
        (entry) =>
          entry &&
          typeof entry.timestamp === "number" &&
          entry.timestamp >= start &&
          entry.timestamp <= end
      )
      .sort((a, b) => a.timestamp - b.timestamp);

    let cursor = start;
    let status = "on-task";
    let onTaskMs = 0;

    for (const entry of slice) {
      const at = Math.min(end, Math.max(start, entry.timestamp));
      if (at > cursor) {
        if (status === "on-task") onTaskMs += at - cursor;
        cursor = at;
      }
      status = entry.status === "on-task" ? "on-task" : "distracted";
    }
    if (end > cursor && status === "on-task") {
      onTaskMs += end - cursor;
    }

    return Math.min(1, Math.max(0, onTaskMs / (end - start)));
  } catch {
    return 1;
  }
}

/**
 * Current staged character health for the active session.
 * @returns {number}
 */
function currentSessionCharacterHealth() {
  return healthFromStage(sessionHealthStage);
}

/**
 * Sync live health to Firebase (website mirrors this mid-session).
 * @param {number} health
 * @param {{ liveSessionActive?: boolean, force?: boolean }} [options]
 * @returns {Promise<boolean>} whether the cloud write succeeded
 */
async function pushLiveCharacterHealth(health, options = {}) {
  const parsed = Number(health);
  const value = Math.max(
    0,
    Math.min(100, Math.floor(Number.isFinite(parsed) ? parsed : 0))
  );
  const liveSessionActive = Boolean(options.liveSessionActive);
  const force = Boolean(options.force);
  const now = Date.now();

  if (
    !force &&
    lastLiveHealthSynced === value &&
    now - lastLiveHealthSyncAt < LIVE_HEALTH_SYNC_MIN_MS
  ) {
    return true;
  }

  try {
    await chrome.storage.local.set({
      [CHARACTER_HEALTH_KEY]: value,
      liveSessionActive,
    });
  } catch {
    // Local cache is best-effort.
  }

  // Push to open website tabs immediately (Firebase can lag or require sign-in).
  await broadcastCharacterHealthToTabs(value, liveSessionActive);

  try {
    await AUTH_READY;
    if (!globalThis.FocusBuddyAuth?.syncLiveCharacterHealth) return false;
    const result = await globalThis.FocusBuddyAuth.syncLiveCharacterHealth(
      value,
      { liveSessionActive }
    );
    if (!result) return false;
    lastLiveHealthSynced = value;
    lastLiveHealthSyncAt = Date.now();
    return true;
  } catch (err) {
    console.warn("[Focus Buddy] Live health sync skipped:", err?.message || err);
    return false;
  }
}

/**
 * Tell content scripts on open tabs to refresh the website health UI.
 * @param {number} health
 * @param {boolean} liveSessionActive
 */
async function broadcastCharacterHealthToTabs(health, liveSessionActive) {
  const visual = await resolveBuddyVisual();
  // Prefer the just-written health over possibly-stale storage read.
  const characterHealth =
    typeof health === "number" && Number.isFinite(health)
      ? health
      : visual.characterHealth;
  const buddyFile =
    visual.characterId === "cat"
      ? catFileForHealth(
          liveSessionActive && characterHealth <= 0
            ? SESSION_START_HEALTH
            : characterHealth
        )
      : visual.buddyFile;

  try {
    const tabs = await chrome.tabs.query({});
    await Promise.all(
      tabs.map((tab) => {
        if (tab.id == null) return Promise.resolve();
        return chrome.tabs
          .sendMessage(tab.id, {
            type: "BUDDY_VISUAL",
            characterId: visual.characterId,
            buddyFile,
            characterHealth:
              liveSessionActive && characterHealth <= 0
                ? SESSION_START_HEALTH
                : characterHealth,
            mood: visual.mood,
            liveSessionActive: Boolean(liveSessionActive),
          })
          .catch(() => {});
      })
    );
  } catch {
    // No tabs / no permission.
  }
}

/**
 * Every new focus session starts at 95 health (cat.png) and refreshes the website.
 * Retries cloud sync briefly if auth is still warming up.
 */
async function resetCharacterHealthForNewSession() {
  if (healthResetRetryTimer !== null) {
    clearTimeout(healthResetRetryTimer);
    healthResetRetryTimer = null;
  }

  stopLiveHealthTicker();
  lastLiveHealthSynced = null;
  lastLiveHealthSyncAt = 0;
  lockInStartedAt = Date.now();
  sessionHealthStage = stageFromHealth(SESSION_START_HEALTH);
  resetHealthProgressState();

  await chrome.storage.local.set({
    [CHARACTER_HEALTH_KEY]: SESSION_START_HEALTH,
    liveSessionActive: true,
  });

  const trySync = async (attempt) => {
    const ok = await pushLiveCharacterHealth(SESSION_START_HEALTH, {
      liveSessionActive: true,
      force: true,
    });
    if (ok || !lockInActive || attempt >= 6) return;
    healthResetRetryTimer = setTimeout(() => {
      healthResetRetryTimer = null;
      void trySync(attempt + 1);
    }, 750 * attempt);
  };

  await trySync(1);
}

/**
 * Aggregate per-domain counts from the focus log for one session window.
 * @param {number} startedAt
 * @param {number} endedAt
 */
async function buildDomainMapsForSession(startedAt, endedAt) {
  try {
    const result = await chrome.storage.local.get(FOCUS_LOG_KEY);
    const focusLog = Array.isArray(result[FOCUS_LOG_KEY])
      ? result[FOCUS_LOG_KEY]
      : [];
    /** @type {Record<string, number>} */
    const distractionDomains = {};
    /** @type {Record<string, number>} */
    const productiveDomains = {};
    for (const entry of focusLog) {
      if (!entry || typeof entry.timestamp !== "number") continue;
      if (entry.timestamp < startedAt || entry.timestamp > endedAt) continue;
      let domain = typeof entry.domain === "string" ? entry.domain : null;
      if (!domain && entry.url) {
        try {
          domain = new URL(entry.url).hostname
            .toLowerCase()
            .replace(/^www\./, "");
        } catch {
          domain = null;
        }
      }
      if (!domain) continue;
      if (entry.status === "distracted") {
        distractionDomains[domain] = (distractionDomains[domain] || 0) + 1;
      } else if (entry.status === "on-task") {
        productiveDomains[domain] = (productiveDomains[domain] || 0) + 1;
      }
    }
    return { distractionDomains, productiveDomains };
  } catch {
    return { distractionDomains: {}, productiveDomains: {} };
  }
}

async function scheduleEnd(endsAt) {
  await chrome.alarms.clear(TIMER_ALARM);
  await chrome.alarms.create(TIMER_ALARM, { when: endsAt });
}

async function updateBadge(state) {
  if (state.status === "running") {
    const mins = Math.max(1, Math.ceil(state.remainingSeconds / 60));
    await chrome.action.setBadgeText({ text: String(mins) });
    return;
  }
  if (state.status === "paused") {
    await chrome.action.setBadgeText({ text: "P" });
    return;
  }
  if (state.status === "finished") {
    await chrome.action.setBadgeText({ text: "0" });
    return;
  }
  await chrome.action.setBadgeText({ text: "" });
}

function normalizeDuration(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value)) return DEFAULT_SECONDS;
  return Math.max(1, Math.min(Math.floor(value), 24 * 60 * 60));
}

async function startTimer(durationSeconds) {
  const current = await readTimer();
  // Only reuse an already-running timer if it still has a valid future end time.
  // Stale status:"running" with a missing/past endsAt used to block all restarts.
  if (
    current.status === "running" &&
    typeof current.endsAt === "number" &&
    current.endsAt > Date.now()
  ) {
    return current;
  }

  const duration = normalizeDuration(durationSeconds ?? current.durationSeconds);
  const startedAt = Date.now();
  const endsAt = startedAt + duration * 1000;
  const sessionId =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `session-${startedAt}`;

  await chrome.alarms.clear(TIMER_ALARM);
  await scheduleEnd(endsAt);
  return writeTimer({
    durationSeconds: duration,
    remainingSeconds: duration,
    endsAt,
    startedAt,
    sessionId,
    status: "running",
    completionHandled: false,
  });
}

async function pauseTimer() {
  const current = await readTimer();
  if (current.status !== "running") return current;

  await chrome.alarms.clear(TIMER_ALARM);
  return writeTimer({
    ...current,
    status: "paused",
    remainingSeconds: current.remainingSeconds,
    endsAt: null,
  });
}

async function resumeTimer() {
  const current = await readTimer();
  if (current.status !== "paused") return current;

  const remaining = Math.max(1, current.remainingSeconds);
  const endsAt = Date.now() + remaining * 1000;
  await scheduleEnd(endsAt);
  return writeTimer({
    ...current,
    status: "running",
    remainingSeconds: remaining,
    endsAt,
  });
}

async function cancelTimer() {
  const current = await readTimer();
  await chrome.alarms.clear(TIMER_ALARM);
  return writeTimer({
    durationSeconds: current.durationSeconds,
    remainingSeconds: current.durationSeconds,
    endsAt: null,
    status: "idle",
  });
}

function extractKeywords(taskText) {
  return [...new Set(
    String(taskText)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 2)
  )];
}

async function loadKeywords() {
  const result = await chrome.storage.local.get([KEYWORDS_KEY, LOCK_IN_KEY]);
  taskKeywords = Array.isArray(result[KEYWORDS_KEY])
    ? result[KEYWORDS_KEY]
    : [];
  lockInActive = Boolean(result[LOCK_IN_KEY]);
}

async function saveKeywords(keywords) {
  taskKeywords = keywords;
  await chrome.storage.local.set({ [KEYWORDS_KEY]: keywords });
}

async function appendFocusLog(status, tab) {
  const result = await chrome.storage.local.get(FOCUS_LOG_KEY);
  const focusLog = Array.isArray(result[FOCUS_LOG_KEY])
    ? result[FOCUS_LOG_KEY]
    : [];
  let domain = null;
  try {
    const rawUrl = tab?.url || "";
    if (rawUrl) {
      domain = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, "");
    }
  } catch {
    domain = null;
  }
  focusLog.push({
    status,
    timestamp: Date.now(),
    domain,
    url: tab?.url || null,
  });
  await chrome.storage.local.set({ [FOCUS_LOG_KEY]: focusLog });
}

async function setCharacterMood(status) {
  await chrome.storage.local.set({ [MOOD_KEY]: status });
  await broadcastBuddyVisual();
}

function clearDistractedTimer() {
  if (distractedTimerId !== null) {
    clearTimeout(distractedTimerId);
    distractedTimerId = null;
  }
}

async function applyTabStatus(status, tab) {
  await appendFocusLog(status, tab);
  if (lockInActive) {
    noteFocusStatusForHealth(status, tab?.id);
  }

  if (status === "on-task") {
    clearDistractedTimer();
    await setCharacterMood("on-task");
    return;
  }

  if (distractedTimerId !== null) return;

  distractedTimerId = setTimeout(async () => {
    distractedTimerId = null;
    const current = await classifyActiveTab();
    if (current === "distracted") {
      await setCharacterMood("distracted");
    }
  }, DISTRACTED_DELAY_MS);
}

async function scanTabDetails(tab) {
  const url = tab.url || "";
  const title = tab.title || "";
  let excerpt = "";
  if (tab.id != null) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => document.body?.innerText?.slice(0, 1_500) ?? "",
      });
      excerpt = results?.[0]?.result ?? "";
    } catch {
      // Restricted pages (chrome://, Web Store, etc.) cannot be scanned.
    }
  }
  const haystack = `${url} ${title} ${excerpt}`.toLowerCase();
  return { url, title, excerpt, haystack };
}

function classifyByKeywords(haystack) {
  if (taskKeywords.length === 0) return null;
  return taskKeywords.some((keyword) => haystack.includes(keyword))
    ? "on-task"
    : null;
}

function parseGeminiRelated(payload) {
  try {
    const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const parsed = JSON.parse(text);
    if (typeof parsed.related === "boolean") {
      return parsed.related ? "on-task" : "distracted";
    }
  } catch {
    return null;
  }
  return null;
}

async function getGeminiApiKey() {
  const bundled = String(globalThis.GEMINI_API_KEY || "").trim();
  if (bundled) return bundled;
  const stored = await chrome.storage.local.get(GEMINI_KEY);
  return String(stored[GEMINI_KEY] || "").trim();
}

async function askGeminiIfRelated(task, details) {
  const apiKey = await getGeminiApiKey();
  if (!apiKey || !task) return null;

  const cacheKey = `${task.toLowerCase()}||${details.url}`;
  if (geminiCache.has(cacheKey)) {
    return geminiCache.get(cacheKey);
  }
  if (geminiInflight.has(cacheKey)) {
    return geminiInflight.get(cacheKey);
  }

  const request = (async () => {
    const prompt = `Decide if this browser tab is on-task for a student.

Task: ${task}

Tab URL: ${details.url}
Tab title: ${details.title}
Page excerpt: ${details.excerpt || "(none)"}

Count the tab as related if it would reasonably help with or is about the task, including closely related topics. Examples of related: task "math" and a Wikipedia article on calculus; task "math" and a YouTube video on vector addition.
Not related: social media, shopping, games, or unrelated entertainment/news unless it clearly teaches the task.

Reply with JSON only: {"related": true} or {"related": false}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
          },
        }),
      }
    );
    if (!response.ok) return null;
    const status = parseGeminiRelated(await response.json());
    if (status) {
      geminiCache.set(cacheKey, status);
    }
    return status;
  })();

  geminiInflight.set(cacheKey, request);
  try {
    return await request;
  } catch {
    return null;
  } finally {
    geminiInflight.delete(cacheKey);
  }
}

async function classifyTab(tab) {
  await loadKeywords();
  if (!lockInActive || !tab) return null;

  const details = await scanTabDetails(tab);
  const keywordHit = classifyByKeywords(details.haystack);
  if (keywordHit) return keywordHit;

  const storedTask = await chrome.storage.local.get(TASK_TEXT_KEY);
  const task = String(storedTask[TASK_TEXT_KEY] || "").trim();
  const geminiStatus = await askGeminiIfRelated(task, details);
  if (geminiStatus) return geminiStatus;

  return "distracted";
}

async function classifyActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return classifyTab(tabs[0]);
}

async function evaluateActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = tabs[0];
  const status = await classifyTab(tab);
  if (status) {
    await applyTabStatus(status, tab);
  }
}

async function injectOverlay(tabId, animate) {
  if (tabId == null) return;
  try {
    const visual = await resolveBuddyVisual();
    // Clear any older overlay copy (including ones that crashed on chrome.storage)
    // so the latest storage-free overlay.js always installs.
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        try {
          window.__focusBuddyOverlayVersion = 0;
          window.__focusBuddyOverlayInit = false;
          document.getElementById("focus-buddy-overlay-host")?.remove();
        } catch {
          // Page may deny access in rare cases.
        }
      },
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["overlay.js"],
    });
    await chrome.tabs.sendMessage(tabId, {
      type: animate ? "OVERLAY_FALL" : "OVERLAY_SHOW",
      mood: visual.mood,
      buddyFile: visual.buddyFile,
      characterId: visual.characterId,
      characterHealth: visual.characterHealth,
      liveSessionActive: visual.liveSessionActive,
    });
  } catch {
    // Cannot inject into chrome://, the Web Store, or discarded tabs.
  }
}

async function showOverlayOnAllTabs(animate) {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((tab) => injectOverlay(tab.id, animate)));
}

async function hideOverlayOnAllTabs() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id == null) return;
      try {
        await chrome.tabs.sendMessage(tab.id, { type: "OVERLAY_HIDE" });
      } catch {
        // Tab has no overlay listener.
      }
    })
  );
}

async function startLockIn({ taskText, useTimer, durationSeconds }) {
  const text = String(taskText || "").trim();
  await chrome.storage.local.set({
    [LOCK_IN_KEY]: true,
    [TASK_TEXT_KEY]: text,
    [FOCUS_LOG_KEY]: [],
  });
  lockInActive = true;
  geminiCache = new Map();
  await saveKeywords(extractKeywords(text));
  await setCharacterMood("on-task");
  clearDistractedTimer();

  // Reset to 95 health (cat.png) before classifying tabs so the website refreshes immediately.
  await resetCharacterHealthForNewSession();

  let timer = await readTimer();
  if (useTimer) {
    // Reset any prior timer so a new lock-in always uses the duration from the popup.
    await cancelTimer();
    timer = await startTimer(durationSeconds);
  }

  await evaluateActiveTab();
  await showOverlayOnAllTabs(true);
  await pushLiveCharacterHealth(SESSION_START_HEALTH, {
    liveSessionActive: true,
    force: true,
  });
  startLiveHealthTicker();
  return { lockInActive: true, timer };
}

async function stopLockIn() {
  lockInActive = false;
  clearDistractedTimer();
  stopLiveHealthTicker();
  if (healthResetRetryTimer !== null) {
    clearTimeout(healthResetRetryTimer);
    healthResetRetryTimer = null;
  }
  healthProgress = null;
  await chrome.storage.local.set({ [LOCK_IN_KEY]: false });
  await setCharacterMood("on-task");
  await hideOverlayOnAllTabs();
  const timer = await cancelTimer();
  await pushLiveCharacterHealth(healthFromStage(sessionHealthStage), {
    liveSessionActive: false,
    force: true,
  });
  return { lockInActive: false, timer };
}

loadKeywords();
readTimer();

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== TIMER_ALARM) return;
  const current = await readTimer();
  if (current.status === "running") {
    await finishTimer(current);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "GET_AUTH_STATE") {
    getExtensionAuthState().then(sendResponse);
    return true;
  }

  if (message.type === "AUTH_SIGN_IN") {
    (async () => {
      await AUTH_READY;
      if (!globalThis.FocusBuddyAuth) {
        sendResponse({
          ok: false,
          error: "Auth is not available in this extension build.",
        });
        return;
      }
      try {
        const state = await globalThis.FocusBuddyAuth.signIn({
          email: message.email,
          password: message.password,
        });
        sendResponse({ ok: true, state });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || "Sign in failed." });
      }
    })();
    return true;
  }

  if (message.type === "AUTH_SIGN_OUT") {
    (async () => {
      await AUTH_READY;
      if (!globalThis.FocusBuddyAuth) {
        sendResponse({ ok: false, error: "Auth is not available." });
        return;
      }
      try {
        const state = await globalThis.FocusBuddyAuth.signOut();
        sendResponse({ ok: true, state });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || "Sign out failed." });
      }
    })();
    return true;
  }

  if (message.type === "START_LOCK_IN") {
    startLockIn(message).then(sendResponse);
    return true;
  }

  if (message.type === "GET_CHARACTER_HEALTH") {
    chrome.storage.local
      .get([CHARACTER_HEALTH_KEY, "liveSessionActive"])
      .then((result) => {
        const raw = Number(result[CHARACTER_HEALTH_KEY]);
        sendResponse({
          characterHealth: Number.isFinite(raw) ? raw : SESSION_START_HEALTH,
          liveSessionActive: Boolean(result.liveSessionActive),
        });
      });
    return true;
  }

  if (message.type === "GET_BUDDY_VISUAL") {
    resolveBuddyVisual().then(sendResponse);
    return true;
  }

  if (message.type === "SET_SELECTED_CHARACTER") {
    setSelectedCharacter(message.characterId).then((characterId) => {
      sendResponse({ ok: true, characterId });
    });
    return true;
  }

  if (message.type === "STOP_LOCK_IN") {
    stopLockIn().then(sendResponse);
    return true;
  }

  if (message.type === "UPDATE_TASK") {
    (async () => {
      const text = String(message.taskText || "").trim();
      geminiCache = new Map();
      await chrome.storage.local.set({ [TASK_TEXT_KEY]: text });
      await saveKeywords(extractKeywords(text));
      await evaluateActiveTab();
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message.type === "GET_LOG") {
    chrome.storage.local.get(FOCUS_LOG_KEY).then((result) => {
      const focusLog = Array.isArray(result[FOCUS_LOG_KEY])
        ? result[FOCUS_LOG_KEY]
        : [];
      sendResponse({ focusLog });
    });
    return true;
  }

  if (message.type === "GET_TIMER") {
    readTimer().then(sendResponse);
    return true;
  }

  if (message.type === "START_TIMER") {
    startTimer(message.durationSeconds).then(sendResponse);
    return true;
  }

  if (message.type === "PAUSE_TIMER") {
    pauseTimer().then(sendResponse);
    return true;
  }

  if (message.type === "RESUME_TIMER") {
    resumeTimer().then(sendResponse);
    return true;
  }

  if (message.type === "CANCEL_TIMER") {
    cancelTimer().then(sendResponse);
    return true;
  }
});

chrome.tabs.onActivated.addListener(async () => {
  await evaluateActiveTab();
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    await loadKeywords();
    if (lockInActive) {
      await injectOverlay(tabId, false);
    }
  }
  if (changeInfo.status !== "complete" && !changeInfo.url && !changeInfo.title) {
    return;
  }
  if (!tab.active) return;
  const status = await classifyTab(tab);
  if (status) {
    await applyTabStatus(status, tab);
  }
});
