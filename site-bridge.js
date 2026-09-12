/**
 * Always-on bridge for the Focus Buddy website → extension.
 * Syncs the selected character from the site into chrome.storage so the
 * popup and on-page timer overlay can show the same buddy art.
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

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "focus-buddy-website") return;
    if (data.type === "SET_SELECTED_CHARACTER") {
      pushSelectedCharacter(data.characterId);
    }
  });

  syncFromLocalStorage();
})();
