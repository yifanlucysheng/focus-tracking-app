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

let taskKeywords = [];
let lockInActive = false;
let distractedTimerId = null;
let geminiCache = new Map();
let geminiInflight = new Map();

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
 * @param {string} url
 * @param {string} key
 * @returns {boolean}
 */
function hasRealSupabaseCredentials(url, key) {
  if (!url || !key) return false;
  if (url.includes("YOUR_PROJECT_REF")) return false;
  if (key.includes("YOUR_SUPABASE_PUBLISHABLE_KEY")) return false;
  if (key.includes("service_role")) return false;
  return true;
}

const AUTH_READY = (async () => {
  if (!globalThis.FocusBuddyAuth) {
    return { configured: false, signedIn: false, user: null, profile: null };
  }

  const url = readSecretString(globalThis.SUPABASE_URL);
  const publishableKey = readSecretString(globalThis.SUPABASE_PUBLISHABLE_KEY);

  if (!hasRealSupabaseCredentials(url, publishableKey)) {
    return {
      configured: false,
      configMessage:
        "Connect FocusBuddy: open secrets.local.js in the extension root and paste your Supabase API URL into SUPABASE_URL and your publishable key into SUPABASE_PUBLISHABLE_KEY, then reload the extension.",
      signedIn: false,
      user: null,
      profile: null,
    };
  }

  try {
    const state = await globalThis.FocusBuddyAuth.init({
      url,
      publishableKey,
    });
    // Retry any public stats that failed to sync earlier.
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

  await recordFocusSessionFromTimer(finished);

  const handled = { ...finished, completionHandled: true };
  return writeTimer(handled);
}

/**
 * Persist + sync public stats once per timer sessionId.
 * Local save always happens; Supabase sync is best-effort with retry queue.
 *
 * @param {object} timerState
 */
async function recordFocusSessionFromTimer(timerState) {
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

  try {
    const result = await globalThis.FocusBuddyAuth.recordCompletedSession({
      sessionId: timerState.sessionId,
      startedAt: timerState.startedAt,
      endedAt: timerState.endedAt,
      durationMs,
      onTaskRatio,
    });
    if (result?.skippedDuplicate) {
      console.info(
        "[Focus Buddy] Skipped duplicate session completion:",
        timerState.sessionId
      );
    }
  } catch (err) {
    console.error(
      "[Focus Buddy] Failed to record completed focus session (timer still finished):",
      err
    );
  }
}

/**
 * Local-only estimate from focusLog; never uploaded.
 * @param {number} startedAt
 * @param {number} endedAt
 * @returns {Promise<number>}
 */
async function estimateOnTaskRatio(startedAt, endedAt) {
  try {
    const result = await chrome.storage.local.get(FOCUS_LOG_KEY);
    const focusLog = Array.isArray(result[FOCUS_LOG_KEY])
      ? result[FOCUS_LOG_KEY]
      : [];
    const slice = focusLog.filter(
      (entry) =>
        entry &&
        typeof entry.timestamp === "number" &&
        entry.timestamp >= startedAt &&
        entry.timestamp <= endedAt
    );
    if (slice.length === 0) return 1;
    const onTask = slice.filter((entry) => entry.status === "on-task").length;
    return onTask / slice.length;
  } catch {
    return 1;
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

async function appendFocusLog(status) {
  const result = await chrome.storage.local.get(FOCUS_LOG_KEY);
  const focusLog = Array.isArray(result[FOCUS_LOG_KEY])
    ? result[FOCUS_LOG_KEY]
    : [];
  focusLog.push({ status, timestamp: Date.now() });
  await chrome.storage.local.set({ [FOCUS_LOG_KEY]: focusLog });
}

async function setCharacterMood(status) {
  await chrome.storage.local.set({ [MOOD_KEY]: status });
}

function clearDistractedTimer() {
  if (distractedTimerId !== null) {
    clearTimeout(distractedTimerId);
    distractedTimerId = null;
  }
}

async function applyTabStatus(status) {
  await appendFocusLog(status);

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
  const status = await classifyActiveTab();
  if (status) {
    await applyTabStatus(status);
  }
}

async function injectOverlay(tabId, animate) {
  if (tabId == null) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["overlay.js"],
    });
    await chrome.tabs.sendMessage(tabId, {
      type: animate ? "OVERLAY_FALL" : "OVERLAY_SHOW",
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

  let timer = await readTimer();
  if (useTimer) {
    // Reset any prior timer so a new lock-in always uses the duration from the popup.
    await cancelTimer();
    timer = await startTimer(durationSeconds);
  }

  await evaluateActiveTab();
  await showOverlayOnAllTabs(true);
  return { lockInActive: true, timer };
}

async function stopLockIn() {
  lockInActive = false;
  clearDistractedTimer();
  await chrome.storage.local.set({ [LOCK_IN_KEY]: false });
  await setCharacterMood("on-task");
  await hideOverlayOnAllTabs();
  const timer = await cancelTimer();
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
    await applyTabStatus(status);
  }
});
