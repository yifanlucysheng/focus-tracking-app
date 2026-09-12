const FOCUS_TABS_KEY = "focusTabs";
const FOCUS_LOG_KEY = "focusLog";

let focusTabIds = new Set();

async function loadFocusTabs() {
  const { [FOCUS_TABS_KEY]: stored = [] } = await chrome.storage.local.get({
    [FOCUS_TABS_KEY]: [],
  });
  focusTabIds = new Set(stored);
}

async function saveFocusTabs(ids) {
  focusTabIds = new Set(ids);
  await chrome.storage.local.set({ [FOCUS_TABS_KEY]: [...focusTabIds] });
}

async function appendFocusLog(entry) {
  const { [FOCUS_LOG_KEY]: log = [] } = await chrome.storage.local.get({
    [FOCUS_LOG_KEY]: [],
  });
  log.push(entry);
  await chrome.storage.local.set({ [FOCUS_LOG_KEY]: log });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "OPEN_TASK_TABS") {
    const urls = Array.isArray(message.links)
      ? message.links
      : Array.isArray(message.urls)
        ? message.urls
        : [];

    Promise.all(
      urls.map((url) => chrome.tabs.create({ url, active: false }))
    )
      .then(async (tabs) => {
        const ids = tabs.map((tab) => tab.id).filter((id) => id != null);
        await saveFocusTabs(ids);
        sendResponse({ ok: true, tabIds: ids });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: String(error) });
      });

    return true;
  }

  if (message?.type === "GET_LOG") {
    chrome.storage.local
      .get({ [FOCUS_LOG_KEY]: [] })
      .then((result) => {
        sendResponse(result[FOCUS_LOG_KEY] ?? []);
      })
      .catch(() => {
        sendResponse([]);
      });

    return true;
  }

  return false;
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await loadFocusTabs();

  const status = focusTabIds.has(tabId) ? "on-task" : "distracted";
  await appendFocusLog({ status, timestamp: Date.now() });
});

loadFocusTabs();
