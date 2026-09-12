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

  if (state.status === "idle" || state.status === "finished") {
    setDurationInputs(state.durationSeconds || DEFAULT_SECONDS);
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

function setCharacterMood(status) {
  const isOnTask = status !== "distracted";
  characterImg.classList.remove("on-task", "distracted");
  characterImg.classList.add(isOnTask ? "on-task" : "distracted");
  characterImg.setAttribute("aria-label", isOnTask ? "on-task" : "distracted");
  characterImg.alt = isOnTask ? "on-task" : "distracted";
  characterImg.src = isOnTask ? "sleepbunny.png" : "angrybunny.png";
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
  chrome.storage.local.get("characterMood").then((result) => {
    applyStoredMood(result.characterMood);
  });
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
  sendMessage(
    "START_LOCK_IN",
    {
      taskText: taskTextInput?.value?.trim() ?? "",
      useTimer: Boolean(timerDropdown?.open),
      durationSeconds: durationFromInputs(),
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
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.characterMood) {
    applyStoredMood(changes.characterMood.newValue);
  }
  if (changes.lockInActive) {
    setLockInUi(changes.lockInActive.newValue);
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
