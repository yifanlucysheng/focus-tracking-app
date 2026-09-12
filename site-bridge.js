/**
 * Always-on bridge between the Focus Buddy website and the extension.
 * - Site → extension: selected character + allow/block site lists
 * - Extension → site: live character health (does not require the timer overlay)
 */
(() => {
  if (window.__focusBuddySiteBridge) return;
  window.__focusBuddySiteBridge = true;

  const CHARACTER_KEY = "focusBuddy.selectedCharacter";
  const BLOCK_SITES_KEY = "focusBuddy.blockSites";
  const ALLOW_SITES_KEY = "focusBuddy.alwaysAllowSites";
  const LEGACY_SITES_KEY = "focusBuddy.allowedSites";

  function normalizeId(id) {
    return id === "cat" ? "cat" : "sleepbunny";
  }

  function readJsonList(key) {
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
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

  function syncCharacterFromLocalStorage() {
    try {
      const raw = localStorage.getItem(CHARACTER_KEY);
      if (raw === "cat" || raw === "sleepbunny") {
        pushSelectedCharacter(raw);
      }
    } catch {
      // Private browsing / blocked storage.
    }
  }

  function syncSiteListsFromLocalStorage() {
    try {
      if (typeof chrome === "undefined" || !chrome.storage?.local) return;
      let block = readJsonList(BLOCK_SITES_KEY);
      if (block.length === 0) block = readJsonList(LEGACY_SITES_KEY);
      const allow = readJsonList(ALLOW_SITES_KEY);
      chrome.storage.local.set({
        alwaysBlockSites: block,
        alwaysAllowSites: allow,
      });
    } catch {
      // Extension context invalidated.
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

  function pushAuthToExtension(type, extra = {}) {
    try {
      if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) return;
      chrome.runtime.sendMessage({ type, ...extra }, () => {
        void chrome.runtime.lastError;
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
    if (data.type === "SYNC_SITE_LISTS") {
      syncSiteListsFromLocalStorage();
    }
    if (data.type === "AUTH_SIGN_IN") {
      pushAuthToExtension("AUTH_SIGN_IN", {
        email: data.email,
        password: data.password,
      });
    }
    if (data.type === "AUTH_SIGN_OUT") {
      pushAuthToExtension("AUTH_SIGN_OUT");
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

  syncCharacterFromLocalStorage();
  syncSiteListsFromLocalStorage();
  pullBuddyVisual();

  // Only poll health on Focus Buddy pages (stats/home) — not every open tab.
  const isFocusBuddyPage = Boolean(
    document.getElementById("profile-stats-root") ||
      document.querySelector(".buddy-option, [data-site-nav]")
  );
  if (isFocusBuddyPage) {
    setInterval(pullBuddyVisual, 1500);
  }
})();
