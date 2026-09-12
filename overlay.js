(() => {
  if (window.__focusBuddyOverlayInit) return;
  window.__focusBuddyOverlayInit = true;

  const HOST_ID = "focus-buddy-overlay-host";

  function bunnyUrl(mood) {
    const file = mood === "distracted" ? "angrybunny.png" : "sleepbunny.png";
    return chrome.runtime.getURL(file);
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

  function showOverlay(animate) {
    const host = ensureHost();
    const img = host.shadowRoot.querySelector("img");
    chrome.storage.local.get("characterMood").then((result) => {
      img.src = bunnyUrl(result.characterMood);
    });

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

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.lockInActive && changes.lockInActive.newValue === false) {
      hideOverlay();
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
