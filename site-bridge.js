/**
 * Always-on bridge between the Focus Buddy website and the extension.
 * - Site → extension: selected character
 * - Extension → site: live character health (does not require the timer overlay)
 */
(() => {
  if (window.__focusBuddySiteBridge) return;
  window.__focusBuddySiteBridge = true;

  const STORAGE_KEY = "focusBuddy.selectedCharacter";

  function normalizeId(id) {
    return id === "cat" ? "cat" : "sleepbunny";
  }

  function pushSelectedCharacter(characterId) {
    const id = normalizeId(characterId);
    try {
      if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) return;
      chrome.runtime.sendMessage(
        { type: "SET_SELECTED_CHARACTER", characterId: id },
        () => {
          void chrome.runtime.lastError;
        }
      );
    } catch {
      // Extension context invalidated.
    }
  }

  function syncFromLocalStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === "cat" || raw === "sleepbunny") {
        pushSelectedCharacter(raw);
      }
    } catch {
      // Private browsing / blocked storage.
    }
  }

  function postHealthToPage(payload) {
    const health = Number(payload?.characterHealth);
    try {
      window.postMessage(
        {
          source: "focus-buddy-extension",
          type: "CHARACTER_HEALTH",
          characterHealth: Number.isFinite(health) ? health : 95,
          liveSessionActive: Boolean(payload?.liveSessionActive),
          characterId:
            payload?.characterId === "cat" ? "cat" : "sleepbunny",
          buddyFile: payload?.buddyFile || null,
        },
        "*"
      );
    } catch {
      // Page may be restricted.
    }
  }

  function pullBuddyVisual() {
    try {
      if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) return;
      chrome.runtime.sendMessage({ type: "GET_BUDDY_VISUAL" }, (response) => {
        if (chrome.runtime.lastError || !response) return;
        postHealthToPage(response);
      });
    } catch {
      // Extension context invalidated.
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "focus-buddy-website") return;
    if (data.type === "SET_SELECTED_CHARACTER") {
      pushSelectedCharacter(data.characterId);
    }
  });

  try {
    if (typeof chrome !== "undefined" && chrome.runtime?.onMessage?.addListener) {
      chrome.runtime.onMessage.addListener((message) => {
        if (!message || typeof message !== "object") return;
        if (
          message.type === "BUDDY_VISUAL" ||
          message.type === "CHARACTER_HEALTH"
        ) {
          postHealthToPage(message);
        }
      });
    }
  } catch {
    // Extension context invalidated.
  }

  syncFromLocalStorage();
  pullBuddyVisual();

  // Only poll on Focus Buddy pages (stats/home) — not every open tab.
  const isFocusBuddyPage = Boolean(
    document.getElementById("profile-stats-root") ||
      document.querySelector(".buddy-option, [data-site-nav]")
  );
  if (isFocusBuddyPage) {
    setInterval(pullBuddyVisual, 1500);
  }
})();
