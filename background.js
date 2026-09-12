const KEYWORDS_KEY = "taskKeywords";
const LABELS_KEY = "labelLibrary";
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
const BLOCK_SITES_KEY = "alwaysBlockSites";
const ALLOW_SITES_KEY = "alwaysAllowSites";

let taskKeywords = [];
let lockInActive = false;
let distractedTimerId = null;
let geminiCache = new Map();
let geminiInflight = new Map();

try {
  importScripts("secrets.local.js");
} catch {
  // Optional developer key file; matching still uses storage or keywords.
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
  await chrome.alarms.clear(TIMER_ALARM);
  const timer = await writeTimer({
    durationSeconds: state.durationSeconds || DEFAULT_SECONDS,
    remainingSeconds: state.durationSeconds || DEFAULT_SECONDS,
    endsAt: null,
    status: "idle",
  });
  if (lockInActive) {
    await stopLockIn();
  }
  return timer;
}

async function endTimer() {
  const current = await readTimer();
  if (current.status !== "running" && current.status !== "paused") {
    return { timer: current, lockInActive };
  }
  const timer = await finishTimer(current);
  return { timer, lockInActive: false };
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
  if (current.status === "running") return current;

  const duration = normalizeDuration(durationSeconds ?? current.durationSeconds);
  const endsAt = Date.now() + duration * 1000;
  await scheduleEnd(endsAt);
  return writeTimer({
    durationSeconds: duration,
    remainingSeconds: duration,
    endsAt,
    status: "running",
  });
}

async function startTimerWithLockIn(durationSeconds, taskText) {
  await loadKeywords();
  if (!lockInActive) {
    await startLockIn({ taskText: taskText ?? "" });
  }
  return startTimer(durationSeconds);
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

const STARTER_LIBRARY = {
  seeded: true,
  labels: [
    { id: "math", name: "Math" },
    { id: "chemistry", name: "Chemistry" },
    { id: "history", name: "History" },
  ],
  sites: [
    { url: "https://www.khanacademy.org/math", title: "Khan Academy Math", labelIds: ["math"] },
    { url: "https://www.desmos.com/calculator", title: "Desmos", labelIds: ["math"] },
    { url: "https://www.wolframalpha.com/", title: "Wolfram Alpha", labelIds: ["math"] },
    { url: "https://www.chemguide.co.uk/", title: "Chemguide", labelIds: ["chemistry"] },
    { url: "https://ptable.com/", title: "Periodic Table", labelIds: ["chemistry"] },
    { url: "https://www.khanacademy.org/science/chemistry", title: "Khan Academy Chemistry", labelIds: ["chemistry"] },
    { url: "https://www.khanacademy.org/humanities/world-history", title: "Khan Academy World History", labelIds: ["history"] },
    { url: "https://www.britannica.com/", title: "Britannica", labelIds: ["history"] },
    { url: "https://www.sparknotes.com/history/", title: "SparkNotes History", labelIds: ["history"] },
  ],
};

function normalizeSiteUrl(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function labelIdFromName(name, existingIds) {
  const base = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "label";
  let id = base;
  let n = 2;
  while (existingIds.includes(id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  return id;
}

async function loadLibrary() {
  const result = await chrome.storage.local.get(LABELS_KEY);
  const stored = result[LABELS_KEY];
  if (stored && Array.isArray(stored.labels) && Array.isArray(stored.sites)) {
    return stored;
  }
  await chrome.storage.local.set({ [LABELS_KEY]: STARTER_LIBRARY });
  return STARTER_LIBRARY;
}

async function saveLibrary(library) {
  await chrome.storage.local.set({ [LABELS_KEY]: library });
  return library;
}

function urlsForLabel(library, labelId) {
  return [...new Set(
    library.sites
      .filter((site) => site.labelIds.includes(labelId))
      .map((site) => site.url)
  )];
}

function labelsMatchingTask(library, taskText) {
  const hay = String(taskText || "").toLowerCase();
  if (!hay) return [];
  return library.labels.filter((label) => {
    const name = label.name.toLowerCase();
    return hay === name || hay.includes(name);
  });
}

async function openUrls(urls) {
  for (const url of urls) {
    await chrome.tabs.create({ url, active: false });
  }
}

async function openLabelTabs(labelId) {
  const library = await loadLibrary();
  const urls = urlsForLabel(library, labelId);
  await openUrls(urls);
  return { ok: true, count: urls.length, urls };
}

async function openTabsForTask(taskText) {
  const library = await loadLibrary();
  const matches = labelsMatchingTask(library, taskText);
  const urls = [...new Set(matches.flatMap((label) => urlsForLabel(library, label.id)))];
  await openUrls(urls);
  return urls.length;
}

async function createLabel(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return loadLibrary();
  const library = await loadLibrary();
  if (library.labels.some((label) => label.name.toLowerCase() === trimmed.toLowerCase())) {
    return library;
  }
  const id = labelIdFromName(trimmed, library.labels.map((label) => label.id));
  library.labels.push({ id, name: trimmed });
  return saveLibrary(library);
}

async function deleteLabel(labelId) {
  const library = await loadLibrary();
  library.labels = library.labels.filter((label) => label.id !== labelId);
  library.sites = library.sites
    .map((site) => ({
      ...site,
      labelIds: site.labelIds.filter((id) => id !== labelId),
    }))
    .filter((site) => site.labelIds.length > 0);
  return saveLibrary(library);
}

async function saveSite({ url, title, labelIds }) {
  const normalized = normalizeSiteUrl(url);
  const ids = Array.isArray(labelIds) ? [...new Set(labelIds.filter(Boolean))] : [];
  if (!normalized || ids.length === 0) return loadLibrary();

  const library = await loadLibrary();
  const validIds = ids.filter((id) => library.labels.some((label) => label.id === id));
  if (validIds.length === 0) return library;

  const existing = library.sites.find((site) => site.url === normalized);
  if (existing) {
    existing.labelIds = [...new Set([...existing.labelIds, ...validIds])];
    if (title) existing.title = title;
  } else {
    library.sites.push({
      url: normalized,
      title: String(title || normalized),
      labelIds: validIds,
    });
  }
  return saveLibrary(library);
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

function hostnameOf(value) {
  try {
    const href = String(value).includes("://") ? String(value) : `https://${value}`;
    return new URL(href).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function urlMatchesSiteList(url, entries) {
  const host = hostnameOf(url);
  if (!host || !Array.isArray(entries)) return false;
  return entries.some((entry) => {
    const other = hostnameOf(entry);
    return other && (host === other || host.endsWith(`.${other}`));
  });
}

function isFolderSavedSite(url, library) {
  const normalized = normalizeSiteUrl(url);
  if (!normalized || !library?.sites) return false;
  return library.sites.some((site) => {
    const saved = site.url;
    if (!saved) return false;
    if (normalized === saved || normalized.startsWith(saved) || saved.startsWith(normalized)) {
      return true;
    }
    return hostnameOf(normalized) === hostnameOf(saved);
  });
}

async function loadSiteRules() {
  let fromSync = {};
  try {
    fromSync = await chrome.storage.sync.get([BLOCK_SITES_KEY, ALLOW_SITES_KEY]);
  } catch {
    fromSync = {};
  }
  const fromLocal = await chrome.storage.local.get([BLOCK_SITES_KEY, ALLOW_SITES_KEY]);
  const blockSites = Array.isArray(fromSync[BLOCK_SITES_KEY])
    ? fromSync[BLOCK_SITES_KEY]
    : Array.isArray(fromLocal[BLOCK_SITES_KEY])
      ? fromLocal[BLOCK_SITES_KEY]
      : [];
  const allowSites = Array.isArray(fromSync[ALLOW_SITES_KEY])
    ? fromSync[ALLOW_SITES_KEY]
    : Array.isArray(fromLocal[ALLOW_SITES_KEY])
      ? fromLocal[ALLOW_SITES_KEY]
      : [];
  return { blockSites, allowSites };
}

async function classifyTab(tab) {
  await loadKeywords();
  if (!lockInActive || !tab) return null;

  const details = await scanTabDetails(tab);
  const { blockSites, allowSites } = await loadSiteRules();

  if (urlMatchesSiteList(details.url, blockSites)) {
    return "distracted";
  }
  if (urlMatchesSiteList(details.url, allowSites)) {
    return "on-task";
  }

  const library = await loadLibrary();
  if (isFolderSavedSite(details.url, library)) {
    return "on-task";
  }

  const storedTask = await chrome.storage.local.get(TASK_TEXT_KEY);
  const task = String(storedTask[TASK_TEXT_KEY] || "").trim();

  if (!task) {
    return "on-task";
  }

  const keywordHit = classifyByKeywords(details.haystack);
  if (keywordHit) return keywordHit;

  const geminiStatus = await askGeminiIfRelated(task, details);
  if (geminiStatus) return geminiStatus;

  return "on-task";
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

async function startLockIn({ taskText }) {
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
  await openTabsForTask(text);

  await evaluateActiveTab();
  await showOverlayOnAllTabs(true);
  const timer = await readTimer();
  return { lockInActive: true, timer };
}

async function stopLockIn() {
  lockInActive = false;
  clearDistractedTimer();
  await chrome.storage.local.set({ [LOCK_IN_KEY]: false });
  await setCharacterMood("on-task");
  await hideOverlayOnAllTabs();
  const timer = await readTimer();
  return { lockInActive: false, timer };
}

loadKeywords();
loadLibrary();
readTimer();

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== TIMER_ALARM) return;
  const current = await readTimer();
  if (current.status === "running") {
    await finishTimer(current);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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

  if (message.type === "GET_LABELS") {
    loadLibrary().then(sendResponse);
    return true;
  }

  if (message.type === "CREATE_LABEL") {
    createLabel(message.name).then(sendResponse);
    return true;
  }

  if (message.type === "DELETE_LABEL") {
    deleteLabel(message.labelId).then(sendResponse);
    return true;
  }

  if (message.type === "SAVE_SITE") {
    saveSite(message).then(sendResponse);
    return true;
  }

  if (message.type === "OPEN_LABEL") {
    openLabelTabs(message.labelId).then(sendResponse);
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
    startTimerWithLockIn(message.durationSeconds, message.taskText).then((timer) => {
      sendResponse({ timer, lockInActive: true });
    });
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

  if (message.type === "END_TIMER") {
    endTimer().then(sendResponse);
    return true;
  }
});

chrome.tabs.onActivated.addListener(async () => {
  await evaluateActiveTab();
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" && !changeInfo.url && !changeInfo.title) {
    return;
  }
  if (!tab.active) return;
  const status = await classifyTab(tab);
  if (status) {
    await applyTabStatus(status);
  }
});
