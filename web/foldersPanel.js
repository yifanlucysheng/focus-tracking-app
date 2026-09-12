function sendMessage(type, extra, callback) {
  if (!globalThis.chrome?.runtime?.sendMessage) {
    callback?.(null);
    return;
  }
  chrome.runtime.sendMessage({ type, ...extra }, (response) => {
    if (chrome.runtime.lastError) {
      callback?.(null);
      return;
    }
    callback?.(response);
  });
}

export function initFoldersPanel() {
  const folderButtons = document.getElementById("folder-buttons");
  const folderChecks = document.getElementById("folder-checks");
  const newFolderName = document.getElementById("new-folder-name");
  const addFolderBtn = document.getElementById("add-folder-btn");
  const siteUrlInput = document.getElementById("folder-site-url");
  const saveSiteBtn = document.getElementById("save-folder-site-btn");
  const status = document.getElementById("folders-status");

  if (!folderButtons || !addFolderBtn) return;

  function setStatus(text) {
    if (status) status.textContent = text || "";
  }

  function renderLibrary(library) {
    if (!library?.labels) {
      setStatus("Open Settings from the Focus Buddy popup so folders sync with the extension.");
      return;
    }
    setStatus("");

    folderButtons.innerHTML = "";
    library.labels.forEach((label) => {
      const count = (library.sites || []).filter((site) => site.labelIds.includes(label.id)).length;
      const chip = document.createElement("div");
      chip.className = "folder-chip";

      const openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.className = "folder-open-btn";
      openBtn.setAttribute("aria-label", `Open ${label.name} folder`);

      const nameEl = document.createElement("span");
      nameEl.className = "folder-name";
      nameEl.textContent = label.name;

      const countEl = document.createElement("span");
      countEl.className = "folder-count";
      countEl.textContent = count === 1 ? "1 site" : `${count} sites`;

      openBtn.append(nameEl, countEl);
      openBtn.addEventListener("click", () => {
        sendMessage("OPEN_LABEL", { labelId: label.id });
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "folder-delete-btn";
      deleteBtn.setAttribute("aria-label", `Delete ${label.name} folder`);
      deleteBtn.textContent = "×";
      deleteBtn.addEventListener("click", () => {
        sendMessage("DELETE_LABEL", { labelId: label.id }, renderLibrary);
      });

      chip.append(openBtn, deleteBtn);
      folderButtons.append(chip);
    });

    if (folderChecks) {
      folderChecks.innerHTML = "";
      library.labels.forEach((label) => {
        const wrap = document.createElement("label");
        wrap.className = "folder-check";
        const box = document.createElement("input");
        box.type = "checkbox";
        box.value = label.id;
        wrap.append(box, document.createTextNode(` ${label.name}`));
        folderChecks.append(wrap);
      });
    }
  }

  function refreshLibrary() {
    sendMessage("GET_LABELS", {}, renderLibrary);
  }

  addFolderBtn.addEventListener("click", () => {
    const name = newFolderName?.value?.trim() || "";
    if (!name) {
      setStatus("Enter a folder name.");
      return;
    }
    sendMessage("CREATE_LABEL", { name }, (library) => {
      if (newFolderName) newFolderName.value = "";
      renderLibrary(library);
    });
  });

  newFolderName?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addFolderBtn.click();
    }
  });

  saveSiteBtn?.addEventListener("click", () => {
    const labelIds = [...(folderChecks?.querySelectorAll("input:checked") || [])].map(
      (box) => box.value
    );
    sendMessage(
      "SAVE_SITE",
      {
        url: siteUrlInput?.value,
        title: "",
        labelIds,
      },
      (library) => {
        renderLibrary(library);
        folderChecks?.querySelectorAll("input").forEach((box) => {
          box.checked = false;
        });
        if (siteUrlInput) siteUrlInput.value = "";
      }
    );
  });

  if (globalThis.chrome?.tabs?.query) {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const tab = tabs[0];
      const url = String(tab?.url || "");
      if (
        siteUrlInput &&
        url &&
        !siteUrlInput.value &&
        !/^chrome(-extension)?:/i.test(url)
      ) {
        siteUrlInput.value = url;
      }
    });
  }

  refreshLibrary();
}
