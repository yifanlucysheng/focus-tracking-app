const LOG_POLL_MS = 10_000;
const DEFAULT_SECONDS = 25 * 60;

const timerDisplay = document.getElementById("timer-display");
const startBtn = document.getElementById("start-task-btn");
const pauseBtn = document.getElementById("pause-timer-btn");
const cancelBtn = document.getElementById("cancel-timer-btn");
const minutesInput = document.getElementById("duration-minutes");
const secondsInput = document.getElementById("duration-seconds");
const characterImg = document.getElementById("character-img");
const summarySection = document.getElementById("summary-section");
const summaryText = document.getElementById("summary-text");

let snapshot = null;
let displayId = null;
let logPollId = null;
let summaryShown = false;

function getLinksForTask(taskText) {
  const text = taskText.toLowerCase();

  const keywordLinks = {
    chemistry: [
      "https://www.chemguide.co.uk/",
      "https://ptable.com/",
      "https://www.khanacademy.org/science/chemistry",
    ],
    essay: [
      "https://www.citationmachine.net/",
      "https://docs.google.com/document/create",
    ],
  };

  for (const keyword of Object.keys(keywordLinks)) {
    if (text.includes(keyword)) {
      return keywordLinks[keyword];
    }
  }

  return [
    "https://www.google.com/search?q=" + encodeURIComponent(taskText),
  ];
}

function openTaskTabs() {
  const taskText = document.getElementById("task-text")?.value?.trim() ?? "";
  if (!taskText) return;

  chrome.runtime.sendMessage({
    type: "OPEN_TASK_TABS",
    links: getLinksForTask(taskText),
  });
}

function formatTime(totalSeconds) {
  const safe = Math.max(0, totalSeconds);
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function durationFromInputs() {
  const minutes = Number(minutesInput?.value ?? 0);
  const seconds = Number(secondsInput?.value ?? 0);
  const total = Math.floor(minutes) * 60 + Math.floor(seconds);
  return Math.max(1, total);
}

function setDurationInputs(totalSeconds) {
  const safe = Math.max(1, totalSeconds);
  if (minutesInput) minutesInput.value = String(Math.floor(safe / 60));
  if (secondsInput) secondsInput.value = String(safe % 60);
}

function remainingFromSnapshot() {
  if (!snapshot) return DEFAULT_SECONDS;
  if (snapshot.status === "running" && snapshot.endsAt) {
    return Math.max(0, Math.ceil((snapshot.endsAt - Date.now()) / 1000));
  }
  return snapshot.remainingSeconds ?? snapshot.durationSeconds ?? DEFAULT_SECONDS;
}

function setControls(state) {
  const running = state.status === "running";
  const paused = state.status === "paused";
  startBtn.disabled = running || paused;
  pauseBtn.disabled = !running && !paused;
  cancelBtn.disabled = !running && !paused && state.status !== "finished";
  pauseBtn.textContent = paused ? "Resume" : "Pause";
  const lockDuration = running || paused;
  if (minutesInput) minutesInput.disabled = lockDuration;
  if (secondsInput) secondsInput.disabled = lockDuration;
}

function sendTimer(type, extra, callback) {
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
  setControls(state);
  timerDisplay.textContent = formatTime(remainingFromSnapshot());

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
  sendTimer("GET_TIMER", {}, applySnapshot);
}

function getEntryStatus(entry) {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object") {
    return entry.status ?? entry.state ?? entry.focus ?? null;
  }
  return null;
}

function setCharacterMood(status) {
  const isOnTask = status === "on-task";
  characterImg.classList.remove("on-task", "distracted");
  characterImg.classList.add(isOnTask ? "on-task" : "distracted");
  characterImg.setAttribute("aria-label", isOnTask ? "on-task" : "distracted");
  characterImg.alt = isOnTask ? "on-task" : "distracted";

  if (characterImg.tagName === "IMG") {
    characterImg.src = isOnTask ? "sleepbunny.png" : "angrybunny.png";
  }
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

function pollLatestFocusStatus() {
  requestFocusLog((focusLog) => {
    if (!Array.isArray(focusLog) || focusLog.length === 0) return;
    const latest = focusLog[focusLog.length - 1];
    const status = getEntryStatus(latest);
    if (status === "on-task" || status === "distracted") {
      setCharacterMood(status);
    }
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

function startFocusSession() {
  openTaskTabs();
  summarySection.hidden = true;
  summaryShown = false;
  sendTimer("START_TIMER", { durationSeconds: durationFromInputs() }, (state) => {
    applySnapshot(state);
    pollLatestFocusStatus();
  });
}

function pauseOrResumeTimer() {
  const type = snapshot?.status === "paused" ? "RESUME_TIMER" : "PAUSE_TIMER";
  sendTimer(type, {}, applySnapshot);
}

function cancelFocusSession() {
  summarySection.hidden = true;
  summaryShown = false;
  sendTimer("CANCEL_TIMER", {}, applySnapshot);
}

startBtn?.addEventListener("click", startFocusSession);
pauseBtn?.addEventListener("click", pauseOrResumeTimer);
cancelBtn?.addEventListener("click", cancelFocusSession);

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
