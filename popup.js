const LOG_POLL_MS = 10_000;
const DEFAULT_SECONDS = 25 * 60;
const TIMER_OPEN_KEY = "timerDropdownOpen";

const timerDropdown = document.getElementById("timer-dropdown");
const timerDisplay = document.getElementById("timer-display");
const hoursInput = document.getElementById("duration-hours");
const minutesInput = document.getElementById("duration-minutes");
const secondsInput = document.getElementById("duration-seconds");
const characterImg = document.getElementById("character-img");
const lockInBtn = document.getElementById("lock-in-btn");
const lockInHint = document.getElementById("lock-in-hint");
const summarySection = document.getElementById("summary-section");
const summaryText = document.getElementById("summary-text");
const taskTextInput = document.getElementById("task-text");
const changeTaskBtn = document.getElementById("change-task-btn");

let snapshot = null;
let displayId = null;
let logPollId = null;
let summaryShown = false;
let lockInActive = false;
let taskEditing = false;

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

function clampInt(value, min, max, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function durationFromInputs() {
  const hours = clampInt(hoursInput?.value, 0, 23, 0);
  const minutes = clampInt(minutesInput?.value, 0, 59, 0);
  const seconds = clampInt(secondsInput?.value, 0, 59, 0);
  const total = hours * 3600 + minutes * 60 + seconds;
  return Math.max(1, total);
}

function setDurationInputs(totalSeconds) {
  const safe = Math.max(1, totalSeconds);
  if (hoursInput) hoursInput.value = String(Math.floor(safe / 3600));
  if (minutesInput) minutesInput.value = String(Math.floor((safe % 3600) / 60));
  if (secondsInput) secondsInput.value = String(safe % 60);
}

function isEditingDuration() {
  const active = document.activeElement;
  return active === hoursInput || active === minutesInput || active === secondsInput;
}

function syncDisplayFromInputsIfIdle() {
  if (snapshot?.status === "running" || snapshot?.status === "paused") return;
  timerDisplay.textContent = formatTime(durationFromInputs());
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
  const timerBusy = state.status === "running" || state.status === "paused";
  setDurationLock(timerBusy);

  // Always reflect the session duration in the picker (including while running).
  // Skipping this when busy left the HTML defaults (25 min) after reopening the popup.
  if (!isEditingDuration()) {
    setDurationInputs(state.durationSeconds || DEFAULT_SECONDS);
  }

  if (timerBusy) {
    timerDisplay.textContent = formatTime(remainingFromSnapshot());
  } else if (!isEditingDuration()) {
    timerDisplay.textContent = formatTime(
      state.durationSeconds || durationFromInputs() || DEFAULT_SECONDS
    );
  }

  if (state.status === "finished" && !summaryShown) {
    summaryShown = true;
    showSummary();
  }
  if (state.status !== "finished") {
    summaryShown = false;
    if (state.status !== "running" && state.status !== "paused") {
      summarySection.hidden = true;
    }
  }
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

function applyBuddyVisual(visual) {
  if (!characterImg || !visual) return;
  const mood = visual.mood === "distracted" ? "distracted" : "on-task";
  const isOnTask = mood !== "distracted";
  characterImg.classList.remove("on-task", "distracted");
  characterImg.classList.add(isOnTask ? "on-task" : "distracted");
  characterImg.setAttribute("aria-label", isOnTask ? "on-task" : "distracted");
  characterImg.alt = isOnTask ? "on-task" : "distracted";
  if (visual.buddyFile) {
    characterImg.src = visual.buddyFile;
  }
}

function refreshBuddyVisual() {
  sendMessage("GET_BUDDY_VISUAL", {}, (visual) => {
    if (visual) applyBuddyVisual(visual);
  });
}

function setCharacterMood(status) {
  // Mood-only fallback while waiting for the full visual resolve.
  applyBuddyVisual({
    mood: status === "distracted" ? "distracted" : "on-task",
    buddyFile:
      status === "distracted" ? "angrybunny.png" : "sleepbunny.png",
  });
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

function setLockInUi(active) {
  lockInActive = Boolean(active);
  lockInBtn.setAttribute("aria-pressed", String(lockInActive));
  lockInHint.textContent = lockInActive
    ? "click to unactivate lock-in mode"
    : "click to activate lock-in mode";
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
  // Duration inputs keep their values even when the <details> panel is collapsed.
  // Previously useTimer required the dropdown to stay open, so lock-in often
  // started with no timer after setting a duration and closing the panel.
  const durationSeconds = durationFromInputs();
  if (timerDropdown) timerDropdown.open = true;
  sendMessage(
    "START_LOCK_IN",
    {
      taskText: taskTextInput?.value?.trim() ?? "",
      useTimer: true,
      durationSeconds,
    },
    (response) => {
      if (!response) {
        // Message may time out while overlays inject; storage still has the timer.
        refreshTimer();
        return;
      }
      setLockInUi(true);
      if (response.timer) applySnapshot(response.timer);
      else refreshTimer();
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
  });
}

function toggleLockIn() {
  if (lockInActive) {
    deactivateLockIn();
    return;
  }
  activateLockIn();
}

chrome.storage.local.get(["characterMood", "lockInActive", TIMER_OPEN_KEY, "taskText"]).then((result) => {
  applyStoredMood(result.characterMood);
  setLockInUi(result.lockInActive);
  if (typeof result.taskText === "string" && taskTextInput) {
    taskTextInput.value = result.taskText;
  }
  if (timerDropdown) {
    timerDropdown.open = Boolean(result[TIMER_OPEN_KEY]);
  }
  refreshBuddyVisual();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (
    changes.characterMood ||
    changes.characterHealth ||
    changes["focusBuddy.selectedCharacter"] ||
    changes.liveSessionActive
  ) {
    refreshBuddyVisual();
  }
  if (changes.lockInActive) {
    setLockInUi(changes.lockInActive.newValue);
  }
  if (changes.timerState) {
    applySnapshot(changes.timerState.newValue);
  }
});

timerDropdown?.addEventListener("toggle", () => {
  chrome.storage.local.set({ [TIMER_OPEN_KEY]: Boolean(timerDropdown.open) });
});

for (const input of [hoursInput, minutesInput, secondsInput]) {
  input?.addEventListener("input", () => {
    syncDisplayFromInputsIfIdle();
  });
  input?.addEventListener("change", () => {
    // Normalize out-of-range / empty values, then reflect on the big display.
    if (input === hoursInput) input.value = String(clampInt(input.value, 0, 23, 0));
    if (input === minutesInput) input.value = String(clampInt(input.value, 0, 59, 0));
    if (input === secondsInput) input.value = String(clampInt(input.value, 0, 59, 0));
    if (!isEditingDuration() || document.activeElement === input) {
      syncDisplayFromInputsIfIdle();
    }
  });
}

lockInBtn?.addEventListener("click", toggleLockIn);
changeTaskBtn?.addEventListener("click", (event) => {
  event.preventDefault();
  if (taskEditing) {
    commitTaskChange();
    return;
  }
  beginChangeTask();
});

refreshTimer();
pollLatestFocusStatus();
displayId = setInterval(() => {
  if (snapshot?.status === "running") {
    const remaining = remainingFromSnapshot();
    timerDisplay.textContent = formatTime(remaining);
    if (remaining <= 0) refreshTimer();
  }
}, 250);
logPollId = setInterval(pollLatestFocusStatus, LOG_POLL_MS);
