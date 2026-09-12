const FOCUS_TABS_KEY = "focusTabs";
const FOCUS_LOG_KEY = "focusLog";

let focusTabs = new Set();

async function loadFocusTabs() {
  const result = await chrome.storage.local.get(FOCUS_TABS_KEY);
  focusTabs = new Set(result[FOCUS_TABS_KEY] || []);
}

async function saveFocusTabs() {
  await chrome.storage.local.set({ [FOCUS_TABS_KEY]: [...focusTabs] });
}

async function appendFocusLog(status) {
  const result = await chrome.storage.local.get(FOCUS_LOG_KEY);
  const focusLog = Array.isArray(result[FOCUS_LOG_KEY])
    ? result[FOCUS_LOG_KEY]
    : [];
  focusLog.push({ status, timestamp: Date.now() });
  await chrome.storage.local.set({ [FOCUS_LOG_KEY]: focusLog });
}

loadFocusTabs();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "OPEN_TASK_TABS") {
    const urls = message.links || [];
    (async () => {
      const ids = [];
      for (const url of urls) {
        const tab = await chrome.tabs.create({ url });
        if (tab.id != null) {
          ids.push(tab.id);
        }
      }
      focusTabs = new Set(ids);
      await saveFocusTabs();
    })();
    return;
  }

  if (message.type === "GET_LOG") {
    chrome.storage.local.get(FOCUS_LOG_KEY).then((result) => {
      const focusLog = Array.isArray(result[FOCUS_LOG_KEY])
        ? result[FOCUS_LOG_KEY]
        : [];
      sendResponse(focusLog);
    });
    return true;
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await loadFocusTabs();
  const status = focusTabs.has(activeInfo.tabId) ? "on-task" : "distracted";
  await appendFocusLog(status);
});
