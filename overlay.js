(() => {
  // Bump so re-inject replaces older overlay copies that crashed on chrome.storage.
  const OVERLAY_VERSION = 8;
  if (window.__focusBuddyOverlayVersion === OVERLAY_VERSION) return;
  window.__focusBuddyOverlayVersion = OVERLAY_VERSION;
  window.__focusBuddyOverlayInit = true;

  const HOST_ID = "focus-buddy-overlay-host";

  function extensionUrl(file) {
    try {
      if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
        return chrome.runtime.getURL(file);
      }
    } catch {
      // Extension context invalidated.
    }
    return file;
  }

  /**
   * Cat Buddy health stages (7 levels). Matches web/profile/characterHealthVisual.js
   * 95/80/65/50/35/20/0 → cat.png … cat7.png
   * @param {number} health
   * @returns {string} extension-packaged filename
   */
  function catFileForHealth(health) {
    const values = [95, 80, 65, 50, 35, 20, 0];
    const parsed = Number(health);
    const h = Number.isFinite(parsed)
      ? Math.max(0, Math.min(100, parsed))
      : 95;
    let best = 0;
    let bestDist = Math.abs(values[0] - h);
    for (let i = 1; i < values.length; i += 1) {
      const dist = Math.abs(values[i] - h);
      if (dist < bestDist) {
        best = i;
        bestDist = dist;
      }
    }
    if (best <= 0) return "cat.png";
    return `cat${best + 1}.png`;
  }

  function bunnyFileForMood(mood) {
    return mood === "distracted" ? "angrybunny.png" : "sleepbunny.png";
  }

  function resolveBuddyFile(payload) {
    if (payload?.buddyFile && typeof payload.buddyFile === "string") {
      return payload.buddyFile;
    }
    const characterId =
      payload?.characterId === "cat" ? "cat" : "sleepbunny";
    const mood =
      payload?.mood === "distracted" ? "distracted" : "on-task";
    const health = Number(payload?.characterHealth);
    const safeHealth = Number.isFinite(health) ? health : 95;
    if (characterId === "cat") return catFileForHealth(safeHealth);
    return bunnyFileForMood(mood);
  }

  function getImg() {
    const host = document.getElementById(HOST_ID);
    return host?.shadowRoot?.querySelector("img") ?? null;
  }

  function ensureHost() {
    let host = document.getElementById(HOST_ID);
    if (host) return host;

    host = document.createElement("div");
    host.id = HOST_ID;
    host.setAttribute("data-focus-buddy", "true");
    host.style.cssText =
      "all:initial;position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none;";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host {
          all: initial;
        }
        img {
          position: fixed;
          left: 20px;
          top: 0;
          width: 96px;
          height: 96px;
          object-fit: contain;
          z-index: 2147483647;
          pointer-events: none;
          user-select: none;
        }
        img.rest {
          top: auto;
          bottom: 20px;
          transform: none;
          animation: none;
        }
        img.fall {
          animation: focus-buddy-fall 1.8s cubic-bezier(0.15, 0.05, 0.25, 1) forwards;
        }
        @keyframes focus-buddy-fall {
          0% {
            transform: translateY(-120px);
          }
          82% {
            transform: translateY(calc(100vh - 124px));
          }
          91% {
            transform: translateY(calc(100vh - 148px));
          }
          100% {
            transform: translateY(calc(100vh - 116px));
          }
        }
      </style>
      <img alt="Focus Buddy" />
    `;
    const mount = document.documentElement || document.body;
    mount.appendChild(host);
    return host;
  }

  function applyBuddyVisual(payload) {
    const img = getImg();
    if (!img) return;
    const file = resolveBuddyFile(payload);
    img.src = extensionUrl(file);

    const health = Number(payload?.characterHealth);
    const live = Boolean(payload?.liveSessionActive);
    const safeHealth = Number.isFinite(health)
      ? live && health <= 0
        ? 95
        : health
      : 95;
    try {
      window.postMessage(
        {
          source: "focus-buddy-extension",
          type: "CHARACTER_HEALTH",
          characterHealth: safeHealth,
          liveSessionActive: live,
          characterId:
            payload?.characterId === "cat" ? "cat" : "sleepbunny",
          buddyFile: file,
        },
        "*"
      );
    } catch {
      // Page may be restricted.
    }
  }

  function showOverlay(animate, payload) {
    const host = ensureHost();
    const img = host.shadowRoot?.querySelector("img");
    if (!img) return;

    if (payload?.buddyFile || payload?.characterId) {
      applyBuddyVisual(payload);
    } else {
      img.src = extensionUrl(bunnyFileForMood(payload?.mood));
      try {
        chrome.runtime.sendMessage({ type: "GET_BUDDY_VISUAL" }, (response) => {
          if (chrome.runtime.lastError || !response) return;
          applyBuddyVisual(response);
        });
      } catch {
        // Extension context invalidated.
      }
    }

    img.classList.remove("fall", "rest");
    if (animate) {
      void img.offsetWidth;
      img.classList.add("fall");
      img.addEventListener(
        "animationend",
        () => {
          img.classList.remove("fall");
          img.classList.add("rest");
        },
        { once: true }
      );
      return;
    }
    img.classList.add("rest");
  }

  function hideOverlay() {
    document.getElementById(HOST_ID)?.remove();
  }

  function syncSelectedCharacterFromPage(characterId) {
    try {
      chrome.runtime.sendMessage(
        { type: "SET_SELECTED_CHARACTER", characterId },
        () => {
          void chrome.runtime.lastError;
        }
      );
    } catch {
      // Extension context invalidated.
    }
  }

  // Website → extension character pick (also handled by site-bridge.js).
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "focus-buddy-website") return;
    if (data.type === "SET_SELECTED_CHARACTER") {
      syncSelectedCharacterFromPage(data.characterId);
    }
  });

  // Never touch chrome.storage here — it is undefined in some page worlds and
  // crashed with "Cannot read properties of undefined (reading 'onChanged')".
  try {
    if (typeof chrome !== "undefined" && chrome.runtime?.onMessage?.addListener) {
      chrome.runtime.onMessage.addListener((message) => {
        if (!message || typeof message !== "object") return;
        if (message.type === "OVERLAY_FALL") {
          showOverlay(true, message);
        } else if (message.type === "OVERLAY_SHOW") {
          showOverlay(false, message);
        } else if (message.type === "OVERLAY_HIDE") {
          hideOverlay();
        } else if (
          message.type === "BUDDY_VISUAL" ||
          message.type === "OVERLAY_MOOD" ||
          message.type === "CHARACTER_HEALTH"
        ) {
          if (getImg()) applyBuddyVisual(message);
        }
      });

      // Pull current health when the Focus Buddy site loads so stats refresh
      // immediately after a new session starts (even before the next Firebase write).
      try {
        chrome.runtime.sendMessage({ type: "GET_BUDDY_VISUAL" }, (response) => {
          if (chrome.runtime.lastError || !response) return;
          const raw = Number(response.characterHealth);
          const live = Boolean(response.liveSessionActive);
          const health = Number.isFinite(raw)
            ? live && raw <= 0
              ? 95
              : raw
            : 95;
          window.postMessage(
            {
              source: "focus-buddy-extension",
              type: "CHARACTER_HEALTH",
              characterHealth: health,
              liveSessionActive: live,
              characterId: response.characterId,
              buddyFile: response.buddyFile,
            },
            "*"
          );
        });
      } catch {
        // Extension context invalidated.
      }
    }
  } catch {
    // Extension context invalidated after reload.
  }
})();
