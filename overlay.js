(() => {
  try {
    if (window.top !== window) return;
  } catch {
    return;
  }

  if (window.__focusBuddyOverlayInit) return;
  window.__focusBuddyOverlayInit = true;

  const HOST_ID = "focus-buddy-overlay-host";

  let guardObserver = null;
  let guardTimer = null;
  let falling = false;

  function bunnyUrl(mood) {
    const file = mood === "distracted" ? "angrybunny.png" : "sleepbunny.png";
    return chrome.runtime.getURL(file);
  }

  function getHost() {
    return document.getElementById(HOST_ID);
  }

  function getImg() {
    return getHost()?.shadowRoot?.querySelector("img") ?? null;
  }

  function attachHost(host) {
    const root = document.documentElement;
    if (!root) return;
    if (host.parentNode !== root) {
      root.appendChild(host);
    }
  }

  function ensureHost() {
    let host = getHost();
    if (host) {
      attachHost(host);
      return host;
    }

    host = document.createElement("div");
    host.id = HOST_ID;
    host.setAttribute("data-focus-buddy", "true");
    host.style.cssText =
      "all:initial;position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:2147483647;pointer-events:none;";
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
          width: 115px;
          height: 115px;
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
            transform: translateY(-140px);
          }
          82% {
            transform: translateY(calc(100vh - 143px));
          }
          91% {
            transform: translateY(calc(100vh - 167px));
          }
          100% {
            transform: translateY(calc(100vh - 135px));
          }
        }
      </style>
      <img class="rest" alt="Focus Buddy" />
    `;
    attachHost(host);
    return host;
  }

  function applyMood(img) {
    chrome.storage.local.get("characterMood").then((result) => {
      if (img.isConnected) img.src = bunnyUrl(result.characterMood);
    });
  }

  function startGuard() {
    if (!guardObserver) {
      guardObserver = new MutationObserver(() => {
        const host = getHost();
        if (host) attachHost(host);
      });
      guardObserver.observe(document.documentElement, { childList: true });
    }

    if (!guardTimer) {
      guardTimer = setInterval(() => {
        chrome.storage.local.get("lockInActive", (result) => {
          if (!result.lockInActive) {
            hideOverlay();
            return;
          }
          if (!getHost()) {
            showOverlay(false);
            return;
          }
          attachHost(getHost());
        });
      }, 800);
    }
  }

  function stopGuard() {
    guardObserver?.disconnect();
    guardObserver = null;
    if (guardTimer) {
      clearInterval(guardTimer);
      guardTimer = null;
    }
  }

  function showOverlay(animate) {
    const alreadyUp = Boolean(getHost());
    if (!animate && alreadyUp && falling) {
      startGuard();
      return;
    }

    const host = ensureHost();
    const img = host.shadowRoot.querySelector("img");
    applyMood(img);
    startGuard();

    if (!animate) {
      if (falling) return;
      img.classList.remove("fall");
      img.classList.add("rest");
      return;
    }

    falling = true;
    img.classList.remove("fall", "rest");
    void img.offsetWidth;
    img.classList.add("fall");
    img.addEventListener(
      "animationend",
      () => {
        falling = false;
        img.classList.remove("fall");
        img.classList.add("rest");
      },
      { once: true }
    );
  }

  function hideOverlay() {
    falling = false;
    stopGuard();
    getHost()?.remove();
  }

  chrome.storage.local.get("lockInActive", (result) => {
    if (result.lockInActive) showOverlay(false);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.lockInActive) {
      if (changes.lockInActive.newValue) {
        if (!getHost()) showOverlay(false);
      } else {
        hideOverlay();
      }
    }
    if (changes.characterMood) {
      const img = getImg();
      if (img) img.src = bunnyUrl(changes.characterMood.newValue);
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "OVERLAY_FALL") showOverlay(true);
    if (message?.type === "OVERLAY_SHOW") showOverlay(false);
    if (message?.type === "OVERLAY_HIDE") hideOverlay();
  });
})();
