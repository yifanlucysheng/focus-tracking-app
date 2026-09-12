import { bootCloudSync, formatSessionClock } from "./web/session-sync.js";
import { isCloudConfigured, listenAuth, loadFriendsActivity } from "./web/cloud.js";
import { buddySrcForProfile } from "./web/profile/characterHealthVisual.js";

const LOG_POLL_MS = 10_000;
const DEFAULT_SECONDS = 25 * 60;
const TIMER_OPEN_KEY = "timerDropdownOpen";
const POPUP_TAB_KEY = "popupActiveTab";

const timerDropdown = document.getElementById("timer-dropdown");
const timerDisplay = document.getElementById("timer-display");
const hoursInput = document.getElementById("duration-hours");
const minutesInput = document.getElementById("duration-minutes");
const secondsInput = document.getElementById("duration-seconds");
const endTimerBtn = document.getElementById("end-timer-btn");
const startTimerBtn = document.getElementById("start-timer-btn");
const endTimerModal = document.getElementById("end-timer-modal");
const endTimerModalImg = document.getElementById("end-timer-modal-img");
const endTimerModalCopy = document.getElementById("end-timer-modal-copy");
const killBunnyBtn = document.getElementById("kill-bunny-btn");
const loveBunnyBtn = document.getElementById("love-bunny-btn");
const sessionStatsModal = document.getElementById("session-stats-modal");
const sessionStatsTask = document.getElementById("session-stats-task");
const sessionStatsList = document.getElementById("session-stats-list");
const sessionStatsNote = document.getElementById("session-stats-note");
const sessionStatsCloseBtn = document.getElementById("session-stats-close-btn");
const popupActivity = document.getElementById("popup-activity");
const homePanel = document.getElementById("home-panel");
const activityPanel = document.getElementById("activity-panel");
const popupTabButtons = document.querySelectorAll(".popup-tab");
const characterImg = document.getElementById("character-img");
const lockInBtn = document.getElementById("lock-in-btn");
const lockInHint = document.getElementById("lock-in-hint");
const summarySection = document.getElementById("summary-section");
const summaryText = document.getElementById("summary-text");
const taskTextInput = document.getElementById("task-text");
const changeTaskBtn = document.getElementById("change-task-btn");
const labelChips = document.getElementById("folder-buttons");
const labelChecks = document.getElementById("folder-checks");
const newLabelName = document.getElementById("new-folder-name");
const addLabelBtn = document.getElementById("add-folder-btn");
const siteUrlInput = document.getElementById("site-url");
const saveSiteBtn = document.getElementById("save-site-btn");

let snapshot = null;
let displayId = null;
let logPollId = null;
let summaryShown = false;
let lockInActive = false;
let taskEditing = false;
let selectedCharacterId = "sleepbunny";

function formatTime(totalSeconds) {
  const safe = Math.max(0, totalSeconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function durationFromInputs() {
  const hours = Number(hoursInput?.value ?? 0);
  const minutes = Number(minutesInput?.value ?? 0);
  const seconds = Number(secondsInput?.value ?? 0);
  const total = Math.floor(hours) * 3600 + Math.floor(minutes) * 60 + Math.floor(seconds);
  return Math.max(1, total);
}

function setDurationInputs(totalSeconds) {
  const safe = Math.max(1, totalSeconds);
  if (hoursInput) hoursInput.value = String(Math.floor(safe / 3600));
  if (minutesInput) minutesInput.value = String(Math.floor((safe % 3600) / 60));
  if (secondsInput) secondsInput.value = String(safe % 60);
}

function remainingFromSnapshot() {
  if (!snapshot) return DEFAULT_SECONDS;
  if (snapshot.status === "running" && snapshot.endsAt) {
    return Math.max(0, Math.ceil((snapshot.endsAt - Date.now()) / 1000));
  }
  return snapshot.remainingSeconds ?? snapshot.durationSeconds ?? DEFAULT_SECONDS;
}

function setDurationLock(locked) {
  if (hoursInput) hoursInput.disabled = locked;
  if (minutesInput) minutesInput.disabled = locked;
  if (secondsInput) secondsInput.disabled = locked;
}

function sendMessage(type, extra, callback) {
  chrome.runtime.sendMessage({ type, ...extra }, (response) => {
    if (chrome.runtime.lastError) {
      callback?.(null);
      return;
    }
    callback?.(response);
  });
}

function applySnapshot(state) {
  if (!state) return;
  snapshot = state;
  timerDisplay.textContent = formatTime(remainingFromSnapshot());
  const timerBusy = state.status === "running" || state.status === "paused";
  setDurationLock(timerBusy);
  if (endTimerBtn) endTimerBtn.hidden = !timerBusy;
  if (startTimerBtn) startTimerBtn.hidden = timerBusy;

  if (state.status === "idle" || state.status === "finished") {
    setDurationInputs(state.durationSeconds || DEFAULT_SECONDS);
  }
  summarySection.hidden = true;
  summaryShown = false;
}

function refreshTimer() {
  sendMessage("GET_TIMER", {}, applySnapshot);
}

function getEntryStatus(entry) {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object") {
    return entry.status ?? entry.state ?? entry.focus ?? null;
  }
  return null;
}

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

function applyBuddyVisual(visual) {
  if (!characterImg || !visual) return;
  const mood = visual.mood === "distracted" ? "distracted" : "on-task";
  const isOnTask = mood !== "distracted";
  const characterId = visual.characterId === "cat" ? "cat" : "sleepbunny";
  selectedCharacterId = characterId;
  setLockInUi(lockInActive);
  characterImg.classList.remove("on-task", "distracted");
  characterImg.classList.toggle("on-task", isOnTask);
  characterImg.classList.toggle("distracted", !isOnTask);
  characterImg.setAttribute("aria-label", isOnTask ? "on-task" : "distracted");
  characterImg.alt = isOnTask ? "on-task" : "distracted";
  if (isStageBuddyFile(visual.buddyFile, characterId)) {
    characterImg.src = String(visual.buddyFile).replace(/^\.\.\//, "");
  }
}

function refreshBuddyVisual() {
  sendMessage("GET_BUDDY_VISUAL", {}, (visual) => {
    if (visual) applyBuddyVisual(visual);
  });
}

function setCharacterMood(status) {
  // Mood class only — sprite always comes from health stages via GET_BUDDY_VISUAL.
  if (characterImg) {
    const isOnTask = status !== "distracted";
    characterImg.classList.toggle("on-task", isOnTask);
    characterImg.classList.toggle("distracted", !isOnTask);
  }
  refreshBuddyVisual();
}

function requestFocusLog(callback) {
  try {
    chrome.runtime.sendMessage({ type: "GET_LOG" }, (response) => {
      if (chrome.runtime.lastError) {
        callback(null);
        return;
      }
      const focusLog = Array.isArray(response)
        ? response
        : (response?.focusLog ?? null);
      callback(focusLog);
    });
  } catch {
    callback(null);
  }
}

function applyStoredMood(status) {
  if (status === "on-task" || status === "distracted") {
    setCharacterMood(status);
  }
}

function pollLatestFocusStatus() {
  refreshBuddyVisual();
}

function showSummary() {
  requestFocusLog((focusLog) => {
    const log = Array.isArray(focusLog) ? focusLog : [];
    const onTaskCount = log.filter((entry) => getEntryStatus(entry) === "on-task").length;
    const percent = log.length === 0 ? 0 : Math.round((onTaskCount / log.length) * 100);

    summaryText.textContent = `You stayed on-task ${percent}% of the time.`;
    summarySection.hidden = false;
  });
}

function buddyClickName() {
  return selectedCharacterId === "cat" ? "cat" : "bunny";
}

function setLockInUi(active) {
  lockInActive = Boolean(active);
  lockInBtn.setAttribute("aria-pressed", String(lockInActive));
  const who = buddyClickName();
  lockInHint.textContent = lockInActive
    ? `click ${who} to unactivate lock in session`
    : `click ${who} to activate lock in session`;
  lockInBtn?.setAttribute(
    "aria-label",
    lockInActive
      ? `Click ${who} to unactivate lock in session`
      : `Click ${who} to activate lock in session`
  );
  setTaskLocked(lockInActive && !taskEditing);
}

function setTaskLocked(locked) {
  if (!taskTextInput) return;
  taskTextInput.disabled = Boolean(locked);
  if (changeTaskBtn) {
    changeTaskBtn.hidden = !lockInActive;
    changeTaskBtn.classList.toggle("editing", Boolean(lockInActive && taskEditing));
  }
}

function beginChangeTask() {
  if (!lockInActive) return;
  taskEditing = true;
  setTaskLocked(false);
  taskTextInput?.focus();
  taskTextInput?.select();
}

function commitTaskChange() {
  if (!lockInActive || !taskEditing) {
    setTaskLocked(lockInActive);
    return;
  }
  taskEditing = false;
  const taskText = taskTextInput?.value?.trim() ?? "";
  sendMessage("UPDATE_TASK", { taskText }, () => {
    setTaskLocked(true);
    pollLatestFocusStatus();
  });
}

function activateLockIn() {
  summarySection.hidden = true;
  summaryShown = false;
  taskEditing = false;
  sendMessage(
    "START_LOCK_IN",
    {
      taskText: taskTextInput?.value?.trim() ?? "",
    },
    (response) => {
      if (!response) return;
      setLockInUi(true);
      if (response.timer) applySnapshot(response.timer);
      pollLatestFocusStatus();
    }
  );
}

function deactivateLockIn() {
  summarySection.hidden = true;
  summaryShown = false;
  taskEditing = false;
  sendMessage("STOP_LOCK_IN", {}, (response) => {
    setLockInUi(false);
    setCharacterMood("on-task");
    if (response?.timer) applySnapshot(response.timer);
    maybeShowSession(response?.session);
  });
}

function toggleLockIn() {
  if (lockInActive) {
    deactivateLockIn();
    return;
  }
  activateLockIn();
}

function setPopupTab(tab) {
  const next = tab === "activity" ? "activity" : "home";
  popupTabButtons.forEach((button) => {
    const active = button.dataset.tab === next;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  if (homePanel) homePanel.hidden = next !== "home";
  if (activityPanel) activityPanel.hidden = next !== "activity";
  if (next === "activity") {
    void refreshPopupActivity();
  }
}

popupTabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const tab = button.dataset.tab === "activity" ? "activity" : "home";
    setPopupTab(tab);
    chrome.storage.local.set({ [POPUP_TAB_KEY]: tab });
  });
});

chrome.storage.local.get(["characterMood", "lockInActive", TIMER_OPEN_KEY, "taskText", POPUP_TAB_KEY, "focusBuddy.selectedCharacter"]).then((result) => {
  applyStoredMood(result.characterMood);
  selectedCharacterId =
    result["focusBuddy.selectedCharacter"] === "cat" ? "cat" : "sleepbunny";
  setLockInUi(result.lockInActive);
  if (typeof result.taskText === "string" && taskTextInput) {
    taskTextInput.value = result.taskText;
  }
  if (timerDropdown) {
    timerDropdown.open = Boolean(result[TIMER_OPEN_KEY]);
  }
  setPopupTab(result[POPUP_TAB_KEY]);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.characterMood) {
    applyStoredMood(changes.characterMood.newValue);
  }
  if (changes.lockInActive) {
    setLockInUi(changes.lockInActive.newValue);
  }
  if (changes["focusBuddy.selectedCharacter"]) {
    selectedCharacterId =
      changes["focusBuddy.selectedCharacter"].newValue === "cat"
        ? "cat"
        : "sleepbunny";
    setLockInUi(lockInActive);
  }
});

timerDropdown?.addEventListener("toggle", () => {
  chrome.storage.local.set({ [TIMER_OPEN_KEY]: Boolean(timerDropdown.open) });
});

lockInBtn?.addEventListener("click", toggleLockIn);
changeTaskBtn?.addEventListener("click", (event) => {
  event.preventDefault();
  if (taskEditing) {
    commitTaskChange();
    return;
  }
  beginChangeTask();
});

function renderLibrary(library) {
  if (!library) return;
  if (labelChips) {
    labelChips.innerHTML = "";
    library.labels.forEach((label) => {
      const count = library.sites.filter((site) => site.labelIds.includes(label.id)).length;
      const chip = document.createElement("div");
      chip.className = "folder-chip";

      const openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.className = "folder-open-btn";
      openBtn.textContent = `${label.name} (${count})`;
      openBtn.addEventListener("click", () => {
        if (taskTextInput && !taskTextInput.disabled) {
          taskTextInput.value = label.name;
        }
        sendMessage("OPEN_LABEL", { labelId: label.id });
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "folder-delete-btn";
      deleteBtn.setAttribute("aria-label", `Delete ${label.name} folder`);
      deleteBtn.textContent = "×";
      deleteBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        sendMessage("DELETE_LABEL", { labelId: label.id }, renderLibrary);
      });

      chip.append(openBtn, deleteBtn);
      labelChips.append(chip);
    });
  }

  if (labelChecks) {
    labelChecks.innerHTML = "";
    library.labels.forEach((label) => {
      const wrap = document.createElement("label");
      wrap.className = "folder-check";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.value = label.id;
      wrap.append(box, document.createTextNode(label.name));
      labelChecks.append(wrap);
    });
  }
}

function refreshLibrary() {
  sendMessage("GET_LABELS", {}, renderLibrary);
}

function prefillsiteUrl() {
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (siteUrlInput && tab?.url && !siteUrlInput.value) {
      siteUrlInput.value = tab.url;
      siteUrlInput.dataset.title = tab.title || "";
    }
  });
}

addLabelBtn?.addEventListener("click", () => {
  sendMessage("CREATE_LABEL", { name: newLabelName?.value }, (library) => {
    if (newLabelName) newLabelName.value = "";
    renderLibrary(library);
  });
});

newLabelName?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    addLabelBtn?.click();
  }
});

saveSiteBtn?.addEventListener("click", () => {
  const labelIds = [...(labelChecks?.querySelectorAll("input:checked") || [])].map(
    (box) => box.value
  );
  sendMessage(
    "SAVE_SITE",
    {
      url: siteUrlInput?.value,
      title: siteUrlInput?.dataset.title || "",
      labelIds,
    },
    (library) => {
      renderLibrary(library);
      labelChecks?.querySelectorAll("input").forEach((box) => {
        box.checked = false;
      });
    }
  );
});

document.getElementById("open-dashboard-btn")?.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("web/index.html") });
});

function showSessionStats(session) {
  if (!session || !sessionStatsModal) return;
  if (sessionStatsTask) {
    sessionStatsTask.textContent = session.task
      ? `Task: ${session.task}`
      : "No task name was set.";
  }
  if (sessionStatsList) {
    sessionStatsList.innerHTML = `
      <li>Duration: ${formatSessionClock(session.durationSeconds)}</li>
      <li>On-task: ${session.onTaskPercent}%</li>
      <li>Distraction switches: ${session.distractionSwitches}</li>
    `;
  }
  if (sessionStatsNote) {
    sessionStatsNote.textContent = isCloudConfigured()
      ? "Saved to your account when you are signed in."
      : "Saved on this device. Add Firebase keys to keep history on your account.";
  }
  sessionStatsModal.hidden = false;
}

function hideSessionStats() {
  if (sessionStatsModal) sessionStatsModal.hidden = true;
  sendMessage("CLEAR_LAST_SESSION");
}

sessionStatsCloseBtn?.addEventListener("click", hideSessionStats);

function maybeShowSession(session) {
  if (session) showSessionStats(session);
}

sendMessage("GET_LAST_SESSION", {}, (response) => {
  maybeShowSession(response?.session);
});

function applyEndTimerModalCharacter(characterId) {
  const isCat = characterId === "cat";
  const animal = isCat ? "cat" : "bunny";
  if (endTimerModalImg) {
    endTimerModalImg.src = isCat ? "cat.png" : "moon3.png";
  }
  if (endTimerModalCopy) {
    endTimerModalCopy.textContent = `Ending early will make the ${animal} sad. (It does not actually die.)`;
  }
  if (killBunnyBtn) {
    killBunnyBtn.textContent = `Yes - KILL THE ${animal.toUpperCase()}`;
  }
  if (loveBunnyBtn) {
    loveBunnyBtn.textContent = `return back to locked-in mode bc i love my ${animal}`;
  }
}

function showEndTimerModal() {
  sendMessage("GET_BUDDY_VISUAL", {}, (visual) => {
    applyEndTimerModalCharacter(visual?.characterId);
    if (endTimerModal) endTimerModal.hidden = false;
  });
}

function hideEndTimerModal() {
  if (endTimerModal) endTimerModal.hidden = true;
}

startTimerBtn?.addEventListener("click", () => {
  sendMessage(
    "START_TIMER",
    {
      durationSeconds: durationFromInputs(),
      taskText: taskTextInput?.value?.trim() ?? "",
    },
    (response) => {
      const timer = response?.timer ?? response;
      if (timer) applySnapshot(timer);
      setLockInUi(true);
      pollLatestFocusStatus();
    }
  );
});

endTimerBtn?.addEventListener("click", () => {
  showEndTimerModal();
});

killBunnyBtn?.addEventListener("click", () => {
  hideEndTimerModal();
  const duration = snapshot?.durationSeconds || DEFAULT_SECONDS;
  applySnapshot({
    durationSeconds: duration,
    remainingSeconds: duration,
    endsAt: null,
    status: "idle",
  });
  setLockInUi(false);
  setCharacterMood("on-task");
  sendMessage("END_TIMER", {}, (response) => {
    const timer = response?.timer ?? response;
    if (timer) applySnapshot(timer);
    setLockInUi(false);
    setCharacterMood("on-task");
    maybeShowSession(response?.session);
  });
});

loveBunnyBtn?.addEventListener("click", () => {
  hideEndTimerModal();
});

refreshTimer();
pollLatestFocusStatus();
refreshLibrary();
prefillsiteUrl();
displayId = setInterval(() => {
  if (snapshot?.status === "running") {
    const remaining = remainingFromSnapshot();
    timerDisplay.textContent = formatTime(remaining);
    if (remaining <= 0) {
      refreshTimer();
      sendMessage("GET_LAST_SESSION", {}, (response) => {
        maybeShowSession(response?.session);
      });
    }
  }
}, 250);
logPollId = setInterval(pollLatestFocusStatus, LOG_POLL_MS);

async function refreshPopupActivity() {
  if (!popupActivity) return;
  if (!isCloudConfigured()) {
    popupActivity.textContent = "Add Firebase keys to see friends here.";
    return;
  }
  try {
    await listenAuth(async (user) => {
      if (!user) {
        popupActivity.textContent =
          "Sign in on the dashboard Settings page (open it from this popup), then reopen the extension.";
        return;
      }
      const friends = await loadFriendsActivity();
      if (!friends.length) {
        popupActivity.textContent = "No friends yet. Add someone from the Friends page.";
        return;
      }
      popupActivity.innerHTML = `<ol class="popup-activity-list" aria-label="Friend activity">${friends
        .map((friend) => {
          const stats = friend.shareStats && friend.stats
            ? `${friend.stats.todayFocusPercent ?? 0}% today · ${friend.stats.streakDays ?? 0} day streak`
            : "Stats hidden";
          const track =
            friend.shareListening && friend.listening?.isPlaying
              ? `Listening to ${friend.listening.trackName}`
              : friend.shareListening
                ? "Not playing anything right now"
                : "Listening hidden";
          const status = friend.customStatus
            ? `<p class="popup-activity-meta">${friend.customStatus}</p>`
            : "";
          return `<li class="popup-activity-row">
            <img class="popup-activity-avatar" src="${buddySrcForProfile(friend).replace(/^\//, "")}" alt="" />
            <div class="popup-activity-main">
              <p class="popup-activity-name">${friend.username}</p>
              ${status}
              <p class="popup-activity-meta">${stats}</p>
              <p class="popup-activity-meta">${track}</p>
            </div>
          </li>`;
        })
        .join("")}</ol>`;
    });
  } catch {
    popupActivity.textContent = "Could not load friend activity.";
  }
}

bootCloudSync();
refreshPopupActivity();
