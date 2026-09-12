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
const ALLOW_SITES_KEY = "alwaysAllowSites";
const BLOCK_SITES_KEY = "alwaysBlockSites";
/**
 * Domains treated as on-task during lock-in unless on the block list.
 * Host match is suffix-based (e.g. docs.google.com matches itself).
 */
const WORK_TOOL_HOST_SUFFIXES = [
  "docs.google.com",
  "sheets.google.com",
  "slides.google.com",
  "classroom.google.com",
  "drive.google.com",
  "notion.so",
  "notion.site",
  "github.com",
  "gist.github.com",
  "instructure.com",
  "canvaslms.com",
  "overleaf.com",
  "office.com",
  "officeapps.live.com",
  "sharepoint.com",
  "onedrive.live.com",
  "dropbox.com",
  "figma.com",
  "miro.com",
  "quizlet.com",
  "khanacademy.org",
  "coursera.org",
  "edx.org",
  "brilliant.org",
  "desmos.com",
  "wolframalpha.com",
  "stackoverflow.com",
  "stackexchange.com",
  "wikipedia.org",
  "scholar.google.com",
  "pubmed.ncbi.nlm.nih.gov",
];
/** Rich editors where body text scrape is useless / misleading. */
const SKIP_EXCERPT_HOST_SUFFIXES = [
  "docs.google.com",
  "sheets.google.com",
  "slides.google.com",
  "notion.so",
  "notion.site",
  "figma.com",
  "officeapps.live.com",
  "overleaf.com",
];
const DISTRACTED_DELAY_MS = 10_000;
const LIVE_HEALTH_SYNC_MIN_MS = 1500;
const CHARACTER_HEALTH_KEY = "characterHealth";
const SELECTED_CHARACTER_KEY = "focusBuddy.selectedCharacter";
const HEALTH_PROGRESS_KEY = "healthProgressState";
const HEALTH_ALARM = "focus-health-tick";
/** Session starts at 95 HP (cat.png). */
const SESSION_START_HEALTH = 95;
const HEALTH_STAGE_VALUES = [95, 80, 65, 50, 35, 20, 0];
/** 1 second distracted → −1 health. */
const OFF_TASK_STEP_MS = 1_000;
/** 2 seconds on-task → +1 health. */
const ON_TASK_STEP_MS = 2_000;

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
/** @type {number} live companion HP 0–95 */
let sessionCharacterHealth = SESSION_START_HEALTH;
/** @type {number} 0 = healthiest … 6 = lowest (derived from HP for stage art) */
let sessionHealthStage = 0;
/** @type {number} */
let lockInStartedAt = 0;
/**
 * Tracks accrued on-task / off-task time for HP changes.
 * @type {{
 *   status: 'on-task'|'distracted'|null,
 *   tabId: number|null,
 *   since: number,
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
  // Threshold bands so continuous HP maps cleanly onto cat art.
  if (h >= 95) return 0;
  if (h >= 80) return 1;
  if (h >= 65) return 2;
  if (h >= 50) return 3;
  if (h >= 35) return 4;
  if (h >= 20) return 5;
  return 6;
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

function clampSessionHealth(health) {
  const n = Number(health);
  const value = Number.isFinite(n) ? n : SESSION_START_HEALTH;
  return Math.max(0, Math.min(SESSION_START_HEALTH, Math.floor(value)));
}

function setSessionHealth(health) {
  sessionCharacterHealth = clampSessionHealth(health);
  sessionHealthStage = stageFromHealth(sessionCharacterHealth);
  return sessionCharacterHealth;
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
  // Only ignore a stale 0 right as lock-in starts (race with last session).
  if (
    liveSessionActive &&
    characterHealth <= 0 &&
    lockInActive &&
    Date.now() - lockInStartedAt < 2_000
  ) {
    characterHealth = SESSION_START_HEALTH;
  } else if (lockInActive) {
    characterHealth = sessionCharacterHealth;
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

function resetHealthProgressState(seedStatus = null) {
  healthProgress = {
    status: seedStatus === "on-task" || seedStatus === "distracted" ? seedStatus : null,
    tabId: null,
    since: Date.now(),
    accruedMs: 0,
    lastTick: Date.now(),
  };
  void persistHealthProgress();
}

async function persistHealthProgress() {
  if (!healthProgress) return;
  try {
    await chrome.storage.local.set({
      [HEALTH_PROGRESS_KEY]: {
        status: healthProgress.status,
        accruedMs: healthProgress.accruedMs,
        lastTick: healthProgress.lastTick,
        since: healthProgress.since,
      },
    });
  } catch {
    // Best-effort; ticks still work in-memory while SW is awake.
  }
}

async function restoreHealthProgress() {
  try {
    const result = await chrome.storage.local.get(HEALTH_PROGRESS_KEY);
    const saved = result[HEALTH_PROGRESS_KEY];
    if (!saved || typeof saved !== "object") {
      resetHealthProgressState();
      return;
    }
    const status =
      saved.status === "on-task" || saved.status === "distracted"
        ? saved.status
        : null;
    healthProgress = {
      status,
      tabId: null,
      since: Number(saved.since) || Date.now(),
      accruedMs: Math.max(0, Number(saved.accruedMs) || 0),
      // Keep lastTick from storage so wall-clock catch-up applies after SW sleep.
      lastTick: Number(saved.lastTick) || Date.now(),
    };
  } catch {
    resetHealthProgressState();
  }
}

/**
 * Tab changes do NOT reset accrual when focus status is unchanged
 * (YouTube → Twitter both distracted should keep counting down).
 * @param {'on-task'|'distracted'} status
 * @param {number|null|undefined} tabId
 */
function noteFocusStatusForHealth(status, tabId) {
  const now = Date.now();
  const tid = typeof tabId === "number" ? tabId : null;
  if (!healthProgress) resetHealthProgressState();
  if (healthProgress.status === status) {
    healthProgress.tabId = tid;
    void persistHealthProgress();
    return;
  }
  healthProgress = {
    status,
    tabId: tid,
    since: now,
    accruedMs: 0,
    lastTick: now,
  };
  void persistHealthProgress();
}

/**
 * Advance HP: −1 per 1s distracted, +1 per 2s on-task.
 * Uses wall-clock so a sleeping service worker still applies missed time on wake.
 */
async function tickSessionHealth() {
  if (!lockInActive) return;
  if (!healthProgress) await restoreHealthProgress();
  if (!healthProgress) resetHealthProgressState();

  const now = Date.now();
  const dt = Math.max(0, now - (healthProgress.lastTick || now));
  healthProgress.lastTick = now;

  if (!healthProgress.status) {
    void persistHealthProgress();
    return;
  }

  healthProgress.accruedMs += dt;

  let next = sessionCharacterHealth;
  if (healthProgress.status === "on-task") {
    const steps = Math.floor(healthProgress.accruedMs / ON_TASK_STEP_MS);
    if (steps < 1) {
      void persistHealthProgress();
      return;
    }
    healthProgress.accruedMs -= steps * ON_TASK_STEP_MS;
    next = Math.min(SESSION_START_HEALTH, sessionCharacterHealth + steps);
  } else if (healthProgress.status === "distracted") {
    const steps = Math.floor(healthProgress.accruedMs / OFF_TASK_STEP_MS);
    if (steps < 1) {
      void persistHealthProgress();
      return;
    }
    healthProgress.accruedMs -= steps * OFF_TASK_STEP_MS;
    next = Math.max(0, sessionCharacterHealth - steps);
  } else {
    void persistHealthProgress();
    return;
  }

  void persistHealthProgress();
  if (next === sessionCharacterHealth) return;
  setSessionHealth(next);
  await pushLiveCharacterHealth(sessionCharacterHealth, {
    liveSessionActive: true,
    force: true,
  });
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
  void chrome.alarms.clear(HEALTH_ALARM);
}

async function scheduleHealthAlarm() {
  if (!lockInActive) return;
  try {
    await chrome.alarms.clear(HEALTH_ALARM);
    await chrome.alarms.create(HEALTH_ALARM, { when: Date.now() + 1000 });
  } catch {
    // Alarms unavailable in rare contexts.
  }
}

function startLiveHealthTicker() {
  stopLiveHealthTicker();
  liveHealthTickTimer = setInterval(() => {
    void tickSessionHealth();
  }, 1000);
  void scheduleHealthAlarm();
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
  const finalHealth = sessionCharacterHealth;
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
      : sessionCharacterHealth;

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
  return sessionCharacterHealth;
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

  // Cloud sync must not block HP ticks — unsigned auth used to stall 5s per tick.
  void (async () => {
    try {
      await AUTH_READY;
      if (!globalThis.FocusBuddyAuth?.syncLiveCharacterHealth) return;
      const result = await globalThis.FocusBuddyAuth.syncLiveCharacterHealth(
        value,
        { liveSessionActive }
      );
      if (!result) return;
      lastLiveHealthSynced = value;
      lastLiveHealthSyncAt = Date.now();
    } catch (err) {
      console.warn("[Focus Buddy] Live health sync skipped:", err?.message || err);
    }
  })();
  return true;
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
      ? clampSessionHealth(health)
      : visual.characterHealth;
  const buddyFile =
    visual.characterId === "cat"
      ? catFileForHealth(characterHealth)
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
            characterHealth,
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
  setSessionHealth(SESSION_START_HEALTH);
  // Seed on-task so HP ticks immediately; evaluateActiveTab will correct status.
  resetHealthProgressState("on-task");

  await chrome.storage.local.set({
    [CHARACTER_HEALTH_KEY]: SESSION_START_HEALTH,
    liveSessionActive: true,
    [HEALTH_PROGRESS_KEY]: {
      status: "on-task",
      accruedMs: 0,
      lastTick: Date.now(),
      since: Date.now(),
    },
  });

  // Broadcast locally right away; cloud sync retries in the background so
  // lock-in / timer start is never blocked on Firebase.
  await broadcastCharacterHealthToTabs(SESSION_START_HEALTH, true);

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

  void trySync(1);
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
  const result = await chrome.storage.local.get([
    KEYWORDS_KEY,
    LOCK_IN_KEY,
    CHARACTER_HEALTH_KEY,
  ]);
  taskKeywords = Array.isArray(result[KEYWORDS_KEY])
    ? result[KEYWORDS_KEY]
    : [];
  lockInActive = Boolean(result[LOCK_IN_KEY]);
  const rawHealth = Number(result[CHARACTER_HEALTH_KEY]);
  if (Number.isFinite(rawHealth)) {
    setSessionHealth(rawHealth);
  }
  if (lockInActive) {
    await restoreHealthProgress();
    // If status was lost, reclassify the active tab so ticks can resume.
    if (!healthProgress?.status) {
      void evaluateActiveTab();
    }
    startLiveHealthTicker();
  }
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
  void broadcastBuddyVisual();
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
    void tickSessionHealth();
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
  const hostname = hostnameFromUrl(url);
  let excerpt = "";
  const skipExcerpt = Boolean(
    hostname && hostMatchesAnySuffix(hostname, SKIP_EXCERPT_HOST_SUFFIXES)
  );
  if (!skipExcerpt && tab.id != null) {
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
  return { url, title, excerpt, haystack, hostname };
}

/**
 * @param {string} url
 * @returns {string}
 */
function hostnameFromUrl(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * @param {string} value URL or bare host from the allow/block UI
 * @returns {string}
 */
function hostnameFromSiteEntry(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    return new URL(withProtocol).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return raw.toLowerCase().replace(/^www\./, "").split("/")[0];
  }
}

/**
 * @param {string} hostname
 * @param {string} suffix
 */
function hostMatchesSuffix(hostname, suffix) {
  const host = String(hostname || "").toLowerCase().replace(/^www\./, "");
  const s = String(suffix || "").toLowerCase().replace(/^www\./, "");
  if (!host || !s) return false;
  return host === s || host.endsWith(`.${s}`);
}

/**
 * @param {string} hostname
 * @param {string[]} suffixes
 */
function hostMatchesAnySuffix(hostname, suffixes) {
  return suffixes.some((suffix) => hostMatchesSuffix(hostname, suffix));
}

/**
 * @param {string} hostname
 * @param {string[]} siteEntries
 */
function hostMatchesSiteList(hostname, siteEntries) {
  if (!hostname || !Array.isArray(siteEntries) || siteEntries.length === 0) {
    return false;
  }
  return siteEntries.some((entry) => {
    const entryHost = hostnameFromSiteEntry(entry);
    return entryHost && hostMatchesSuffix(hostname, entryHost);
  });
}

async function loadSiteLists() {
  const result = await chrome.storage.local.get([ALLOW_SITES_KEY, BLOCK_SITES_KEY]);
  return {
    allow: Array.isArray(result[ALLOW_SITES_KEY]) ? result[ALLOW_SITES_KEY] : [],
    block: Array.isArray(result[BLOCK_SITES_KEY]) ? result[BLOCK_SITES_KEY] : [],
  };
}

/** Seed docs.google.com into Always Allow once if the key was never set. */
async function ensureDefaultAllowSites() {
  const result = await chrome.storage.local.get(ALLOW_SITES_KEY);
  if (Object.prototype.hasOwnProperty.call(result, ALLOW_SITES_KEY)) return;
  await chrome.storage.local.set({
    [ALLOW_SITES_KEY]: ["https://docs.google.com"],
  });
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
    const excerptNote = details.excerpt
      ? details.excerpt
      : "(unavailable — judge from URL and title only; do not assume distraction just because excerpt is missing)";
    const prompt = `Decide if this browser tab is on-task for a student.

Task: ${task}

Tab URL: ${details.url}
Tab title: ${details.title}
Page excerpt: ${excerptNote}

Count the tab as related if it would reasonably help with or is about the task, including closely related topics.
Examples of related: task "math" and a Wikipedia article on calculus; task "math" and a YouTube video on vector addition.
Google Docs / Sheets / Slides, Notion, Overleaf, Office Online, and similar editors are usually ON-TASK for homework, essays, studying, or writing tasks — even when page text is unavailable.
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

/**
 * Classification order:
 * 1) always-block → distracted
 * 2) always-allow → on-task
 * 3) known work-tool domains → on-task
 * 4) task keywords in URL/title/excerpt → on-task
 * 5) Gemini (unknown domains only)
 * 6) default distracted
 */
async function classifyTab(tab) {
  await loadKeywords();
  if (!lockInActive || !tab) return null;

  const details = await scanTabDetails(tab);
  const hostname = details.hostname || hostnameFromUrl(details.url);
  const lists = await loadSiteLists();

  if (hostMatchesSiteList(hostname, lists.block)) {
    return "distracted";
  }
  if (hostMatchesSiteList(hostname, lists.allow)) {
    return "on-task";
  }
  if (hostMatchesAnySuffix(hostname, WORK_TOOL_HOST_SUFFIXES)) {
    return "on-task";
  }

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

  // Start the countdown before cloud/overlay work so the popup timer never stalls.
  let timer = await readTimer();
  if (useTimer) {
    await cancelTimer();
    timer = await startTimer(durationSeconds);
  }

  // Reset to 95 health (cat.png); cloud sync is non-blocking (see reset helper).
  await resetCharacterHealthForNewSession();
  startLiveHealthTicker();

  // Classify ASAP so off-task accrual starts; overlays can lag.
  void evaluateActiveTab().then(() => {
    void tickSessionHealth();
  });
  void showOverlayOnAllTabs(true);
  void pushLiveCharacterHealth(SESSION_START_HEALTH, {
    liveSessionActive: true,
    force: true,
  });
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
  await chrome.storage.local.set({
    [LOCK_IN_KEY]: false,
    [HEALTH_PROGRESS_KEY]: null,
  });
  await setCharacterMood("on-task");
  await hideOverlayOnAllTabs();
  const timer = await cancelTimer();
  await pushLiveCharacterHealth(sessionCharacterHealth, {
    liveSessionActive: false,
    force: true,
  });
  return { lockInActive: false, timer };
}

loadKeywords();
readTimer();
void ensureDefaultAllowSites();

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === HEALTH_ALARM) {
    await tickSessionHealth();
    await scheduleHealthAlarm();
    return;
  }
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
    startLockIn(message)
      .then(sendResponse)
      .catch((err) => {
        console.error("[Focus Buddy] START_LOCK_IN failed:", err);
        sendResponse({ ok: false, error: err?.message || "Lock-in failed." });
      });
    return true;
  }

  if (message.type === "GET_CHARACTER_HEALTH") {
    chrome.storage.local
      .get([CHARACTER_HEALTH_KEY, "liveSessionActive"])
      .then((result) => {
        const raw = Number(result[CHARACTER_HEALTH_KEY]);
        const stored = Number.isFinite(raw) ? raw : SESSION_START_HEALTH;
        sendResponse({
          characterHealth: lockInActive ? sessionCharacterHealth : stored,
          liveSessionActive: Boolean(result.liveSessionActive) || lockInActive,
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
