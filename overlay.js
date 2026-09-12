(() => {
  try {
    if (window.top !== window) return;
  } catch {
    return;
  }

  // Bump so re-inject replaces older overlay copies (mood bunny PNGs, etc.).
  const OVERLAY_VERSION = 16;
  if (window.__focusBuddyOverlayVersion === OVERLAY_VERSION) return;
  document.getElementById("focus-buddy-overlay-host")?.remove();
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
   * Cat Buddy health bands. Matches web/profile/characterHealthVisual.js
   * @param {number} health
   * @returns {string} extension-packaged filename
   */
  function catFileForHealth(health) {
    const parsed = Number(health);
    const h = Number.isFinite(parsed)
      ? Math.max(0, Math.min(100, parsed))
      : 100;
    if (h >= 95) return "cat.png";
    if (h >= 80) return "cat2.png";
    if (h >= 65) return "cat3.png";
    if (h >= 50) return "cat4.png";
    if (h >= 35) return "cat5.png";
    if (h >= 20) return "cat6.png";
    return "cat7.png";
  }

  const MOON_STAGE_FILES = [
    "moonbuddysprites/stage1moon/yaybunny.png",
    "moonbuddysprites/stage2moon/sleepbunny.png",
    "moonbuddysprites/stage3moon/stage3.png",
    "moonbuddysprites/stage4moon/stage4bunny.png",
    "moonbuddysprites/stage5moon/gravestone.png",
  ];

  /**
   * Moon Buddy stages 1–5 (even 20-point bands). Matches website.
   * @param {number} health
   * @returns {string}
   */
  function moonFileForHealth(health) {
    const parsed = Number(health);
    const h = Number.isFinite(parsed)
      ? Math.max(0, Math.min(100, parsed))
      : 100;
    if (h >= 80) return MOON_STAGE_FILES[0];
    if (h >= 60) return MOON_STAGE_FILES[1];
    if (h >= 40) return MOON_STAGE_FILES[2];
    if (h >= 20) return MOON_STAGE_FILES[3];
    return MOON_STAGE_FILES[4];
  }

  /**
   * Accept only stage sprites. Legacy sleepbunny/angrybunny must not win over health stages.
   * @param {string|null|undefined} file
   * @param {"cat"|"sleepbunny"} characterId
   * @returns {boolean}
   */
  function isStageBuddyFile(file, characterId) {
    if (typeof file !== "string" || !file) return false;
    const normalized = file.replace(/^\.\.\//, "");
    const name = normalized.split("/").pop() || file;
    if (characterId === "cat") {
      return name === "cat.png" || /^cat[2-7]\.png$/i.test(name);
    }
    return (
      /^moon[1-5]\.png$/i.test(name) ||
      /moonbuddysprites\/stage[1-5]moon\//i.test(normalized)
    );
  }

  function resolveBuddyFile(payload) {
    const characterId =
      payload?.characterId === "cat" ? "cat" : "sleepbunny";
    const health = Number(payload?.characterHealth);
    const safeHealth = Number.isFinite(health) ? health : 100;
    if (isStageBuddyFile(payload?.buddyFile, characterId)) {
      return String(payload.buddyFile).replace(/^\.\.\//, "");
    }
    if (characterId === "cat") return catFileForHealth(safeHealth);
    return moonFileForHealth(safeHealth);
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
          top: auto;
          bottom: 20px;
          width: 125px;
          height: 125px;
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
          top: 0;
          bottom: auto;
          animation: focus-buddy-fall 1.8s cubic-bezier(0.15, 0.05, 0.25, 1) forwards;
        }
        .chat-bubble {
          position: fixed;
          left: 148px;
          bottom: 36px;
          max-width: 240px;
          padding: 10px 12px;
          border-radius: 16px 16px 16px 4px;
          background: #f7efd8;
          color: #2a186b;
          font: 14px/1.35 "Trebuchet MS", sans-serif;
          box-shadow: 0 10px 24px rgba(42, 24, 107, 0.22);
          pointer-events: auto;
          cursor: pointer;
          z-index: 2147483647;
        }
        .chat-bubble[hidden] {
          display: none !important;
        }
        .chat-bubble .from {
          margin: 0 0 4px;
          font-size: 12px;
          color: #646ca6;
        }
        .chat-bubble .text {
          margin: 0;
          word-wrap: break-word;
        }
        @keyframes focus-buddy-fall {
          0% {
            transform: translateY(-156px);
          }
          82% {
            transform: translateY(calc(100vh - 161px));
          }
          91% {
            transform: translateY(calc(100vh - 192px));
          }
          100% {
            transform: translateY(calc(100vh - 151px));
          }
        }
      </style>
      <img alt="Focus Buddy" />
      <div class="chat-bubble" hidden>
        <p class="from"></p>
        <p class="text"></p>
      </div>
    `;
    const mount = document.documentElement || document.body;
    mount.appendChild(host);
    return host;
  }

  function notifyPageHealth(payload) {
    const health = Number(payload?.characterHealth);
    const live = Boolean(payload?.liveSessionActive);
    const safeHealth = Number.isFinite(health) ? health : 100;
    const file = resolveBuddyFile(payload);
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

  function applyBuddyVisual(payload) {
    const img = getImg();
    if (img) {
      const file = resolveBuddyFile(payload);
      img.src = extensionUrl(file);
    }
    // Always notify the page — health sync must not depend on the overlay host.
    notifyPageHealth(payload);
  }

  function showOverlay(animate, payload) {
    const host = ensureHost();
    host.dataset.lockIn = "1";
    const img = host.shadowRoot?.querySelector("img");
    if (!img) return;

    if (payload?.buddyFile || payload?.characterId) {
      applyBuddyVisual(payload);
    } else {
      img.src = extensionUrl(moonFileForHealth(100));
      try {
        chrome.runtime.sendMessage({ type: "GET_BUDDY_VISUAL" }, (response) => {
          if (chrome.runtime.lastError || !response) return;
          applyBuddyVisual(response);
        });
      } catch {
        // Extension context invalidated.
      }
    }

    if (img.classList.contains("fall")) return;
    if (img.classList.contains("rest")) return;

    const shouldFall =
      animate &&
      typeof document !== "undefined" &&
      document.visibilityState === "visible";

    if (!shouldFall) {
      img.classList.add("rest");
      return;
    }

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
  }

  let chatBubbleTimer = null;
  let lastBubbleId = "";

  function dismissChatBubble(removeIfIdle) {
    const host = document.getElementById(HOST_ID);
    const bubble = host?.shadowRoot?.querySelector(".chat-bubble");
    if (bubble) bubble.hidden = true;
    if (host) delete host.dataset.chatBubble;
    if (chatBubbleTimer) {
      clearTimeout(chatBubbleTimer);
      chatBubbleTimer = null;
    }
    if (removeIfIdle && host && host.dataset.lockIn !== "1") {
      host.remove();
    }
  }

  function showChatBubble(payload) {
    const messageId = String(payload?.messageId || "");
    const text = String(payload?.text || "").trim();
    if (!text || (messageId && messageId === lastBubbleId)) return;
    lastBubbleId = messageId;

    const host = ensureHost();
    host.dataset.chatBubble = "1";
    const img = host.shadowRoot?.querySelector("img");
    const bubble = host.shadowRoot?.querySelector(".chat-bubble");
    const fromEl = host.shadowRoot?.querySelector(".chat-bubble .from");
    const textEl = host.shadowRoot?.querySelector(".chat-bubble .text");
    if (img && !img.classList.contains("fall") && !img.classList.contains("rest")) {
      img.classList.add("rest");
    }
    if (img && !img.getAttribute("src")) {
      try {
        chrome.runtime.sendMessage({ type: "GET_BUDDY_VISUAL" }, (response) => {
          if (chrome.runtime.lastError || !response) {
            img.src = extensionUrl(moonFileForHealth(100));
            return;
          }
          applyBuddyVisual(response);
        });
      } catch {
        img.src = extensionUrl(moonFileForHealth(100));
      }
    }
    if (fromEl) fromEl.textContent = `@${payload?.fromUsername || "friend"}`;
    if (textEl) textEl.textContent = text;
    if (bubble) {
      bubble.hidden = false;
      bubble.onclick = () => dismissChatBubble(true);
    }
    if (chatBubbleTimer) clearTimeout(chatBubbleTimer);
    chatBubbleTimer = setTimeout(() => dismissChatBubble(true), 14000);
  }

  function hideOverlay() {
    const host = document.getElementById(HOST_ID);
    if (host?.dataset.chatBubble === "1") {
      host.dataset.lockIn = "0";
      return;
    }
    host?.remove();
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
        } else if (message.type === "CHAT_BUBBLE") {
          showChatBubble(message);
        } else if (
          message.type === "BUDDY_VISUAL" ||
          message.type === "OVERLAY_MOOD" ||
          message.type === "CHARACTER_HEALTH"
        ) {
          applyBuddyVisual(message);
        }
      });

      // Pull current health when the Focus Buddy site loads so stats refresh
      // immediately after a new session starts (even before the next Firebase write).
      try {
        chrome.runtime.sendMessage({ type: "GET_BUDDY_VISUAL" }, (response) => {
          if (chrome.runtime.lastError || !response) return;
          const raw = Number(response.characterHealth);
          const live = Boolean(response.liveSessionActive);
          const health = Number.isFinite(raw) ? raw : 100;
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
