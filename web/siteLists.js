const BLOCK_SITES_KEY = "focusBuddy.blockSites";
const ALLOW_SITES_KEY = "focusBuddy.alwaysAllowSites";
const LEGACY_SITES_KEY = "focusBuddy.allowedSites";

export function initSiteLists() {
  const blockSiteInput = document.getElementById("block-site-input");
  const addBlockSiteBtn = document.getElementById("add-block-site-btn");
  const blockSiteList = document.getElementById("block-site-list");
  const allowSiteInput = document.getElementById("allow-site-input");
  const addAllowSiteBtn = document.getElementById("add-allow-site-btn");
  const allowSiteList = document.getElementById("allow-site-list");
  const sitesStatus = document.getElementById("sites-status");

  if (!blockSiteList && !allowSiteList) return;

  let blockSites = [];
  let allowSites = [];

  function readStoredList(key) {
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function applySiteLists() {
    renderSiteList(blockSiteList, blockSites, "block");
    renderSiteList(allowSiteList, allowSites, "allow");
  }

  function writeChromeSiteLists(block, allow) {
    const payload = {
      alwaysBlockSites: block,
      alwaysAllowSites: allow,
    };
    if (globalThis.chrome?.storage?.local) {
      chrome.storage.local.set(payload);
    }
    if (globalThis.chrome?.storage?.sync) {
      chrome.storage.sync.set(payload).catch(() => {});
    }
  }

  function readChromeSiteLists() {
    if (!globalThis.chrome?.storage) return Promise.resolve(null);

    const localGet = chrome.storage.local
      ? chrome.storage.local.get(["alwaysBlockSites", "alwaysAllowSites"])
      : Promise.resolve({});
    const syncGet = chrome.storage.sync
      ? chrome.storage.sync.get(["alwaysBlockSites", "alwaysAllowSites"]).catch(() => ({}))
      : Promise.resolve({});

    return Promise.all([syncGet, localGet]).then(([fromSync, fromLocal]) => {
      const block = Array.isArray(fromSync.alwaysBlockSites)
        ? fromSync.alwaysBlockSites
        : Array.isArray(fromLocal.alwaysBlockSites)
          ? fromLocal.alwaysBlockSites
          : [];
      const allow = Array.isArray(fromSync.alwaysAllowSites)
        ? fromSync.alwaysAllowSites
        : Array.isArray(fromLocal.alwaysAllowSites)
          ? fromLocal.alwaysAllowSites
          : [];
      return { block, allow };
    });
  }

  function saveSiteLists() {
    try {
      localStorage.setItem(BLOCK_SITES_KEY, JSON.stringify(blockSites));
      localStorage.setItem(ALLOW_SITES_KEY, JSON.stringify(allowSites));
    } catch {
      // Ignore.
    }
    writeChromeSiteLists(blockSites, allowSites);
  }

  function normalizeSite(value) {
    const trimmed = value.trim();
    if (!trimmed) return null;

    try {
      const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
      const url = new URL(withProtocol);
      if (!url.hostname) return null;
      return url.href.replace(/\/$/, "");
    } catch {
      return null;
    }
  }

  function renderSiteList(listEl, sites, kind) {
    if (!listEl) return;
    listEl.innerHTML = "";

    sites.forEach((site, index) => {
      const li = document.createElement("li");
      li.className = "site-chip";

      const label = document.createElement("span");
      label.textContent = site;

      const remove = document.createElement("button");
      remove.type = "button";
      remove.setAttribute("aria-label", `Remove ${site}`);
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        sites.splice(index, 1);
        saveSiteLists();
        renderSiteList(listEl, sites, kind);
      });

      li.append(label, remove);
      listEl.appendChild(li);
    });
  }

  function addSiteToList({ input, sites, otherSites, listEl, kind }) {
    const site = normalizeSite(input?.value ?? "");
    if (!site) {
      if (sitesStatus) sitesStatus.textContent = "Enter a valid website URL.";
      return;
    }

    if (sites.includes(site)) {
      if (sitesStatus) sitesStatus.textContent = "That site is already on this list.";
      return;
    }

    if (otherSites.includes(site)) {
      if (sitesStatus) {
        sitesStatus.textContent =
          kind === "block"
            ? "That site is already in Always Allow."
            : "That site is already in your block list.";
      }
      return;
    }

    sites.push(site);
    saveSiteLists();
    renderSiteList(listEl, sites, kind);
    if (input) input.value = "";
    if (sitesStatus) sitesStatus.textContent = "";
  }

  function addBlockSite() {
    addSiteToList({
      input: blockSiteInput,
      sites: blockSites,
      otherSites: allowSites,
      listEl: blockSiteList,
      kind: "block",
    });
  }

  function addAllowSite() {
    addSiteToList({
      input: allowSiteInput,
      sites: allowSites,
      otherSites: blockSites,
      listEl: allowSiteList,
      kind: "allow",
    });
  }

  blockSites = readStoredList(BLOCK_SITES_KEY);
  if (blockSites.length === 0) {
    blockSites = readStoredList(LEGACY_SITES_KEY);
  }
  allowSites = readStoredList(ALLOW_SITES_KEY);
  applySiteLists();

  readChromeSiteLists().then((stored) => {
    if (!stored) {
      if (sitesStatus) {
        sitesStatus.textContent =
          "Open this dashboard from the Focus Buddy popup so block/allow lists sync with the extension.";
      }
      return;
    }
    if (stored.block.length || stored.allow.length) {
      blockSites = stored.block;
      allowSites = stored.allow;
      applySiteLists();
      try {
        localStorage.setItem(BLOCK_SITES_KEY, JSON.stringify(blockSites));
        localStorage.setItem(ALLOW_SITES_KEY, JSON.stringify(allowSites));
      } catch {
        // Ignore.
      }
      return;
    }
    if (blockSites.length || allowSites.length) {
      saveSiteLists();
    }
  });

  addBlockSiteBtn?.addEventListener("click", addBlockSite);
  addAllowSiteBtn?.addEventListener("click", addAllowSite);
  blockSiteInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addBlockSite();
    }
  });
  allowSiteInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addAllowSite();
    }
  });

  if (globalThis.chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync" && area !== "local") return;
      if (changes.alwaysBlockSites) {
        blockSites = Array.isArray(changes.alwaysBlockSites.newValue)
          ? changes.alwaysBlockSites.newValue
          : [];
      }
      if (changes.alwaysAllowSites) {
        allowSites = Array.isArray(changes.alwaysAllowSites.newValue)
          ? changes.alwaysAllowSites.newValue
          : [];
      }
      if (changes.alwaysBlockSites || changes.alwaysAllowSites) {
        applySiteLists();
      }
    });
  }
}
