// Popup script — timer & character sections

const DEFAULT_SECONDS = 25 * 60;
const LOG_POLL_MS = 10_000;

let remainingSeconds = DEFAULT_SECONDS;
let countdownId = null;
let logPollId = null;
let isPaused = false;

const timerDisplay = document.getElementById("timer-display");
const startBtn = document.getElementById("start-task-btn");
const pauseBtn = document.getElementById("pause-timer-btn");
const cancelBtn = document.getElementById("cancel-timer-btn");
const characterImg = document.getElementById("character-img");
const summarySection = document.getElementById("summary-section");
const summaryText = document.getElementById("summary-text");

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function updateTimerDisplay() {
  timerDisplay.textContent = formatTime(remainingSeconds);
}

function setControls({ running, paused }) {
  startBtn.disabled = running || paused;
  pauseBtn.disabled = !running && !paused;
  cancelBtn.disabled = !running && !paused;
  pauseBtn.textContent = paused ? "Resume" : "Pause";
}

function clearIntervals() {
  if (countdownId !== null) {
    clearInterval(countdownId);
    countdownId = null;
  }
  if (logPollId !== null) {
    clearInterval(logPollId);
    logPollId = null;
  }
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

  // Prefer image assets when available; otherwise keep colored placeholder div.
  if (characterImg.tagName === "IMG") {
    characterImg.src = isOnTask ? "happy.png" : "sad.png";
  }
}

function requestFocusLog(callback) {
  try {
    chrome.runtime.sendMessage({ type: "GET_LOG" }, (response) => {
      if (chrome.runtime.lastError) {
        callback(null);
        return;
      }
      callback(response?.focusLog ?? null);
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

function beginIntervals() {
  countdownId = setInterval(tick, 1000);
  logPollId = setInterval(pollLatestFocusStatus, LOG_POLL_MS);
}

function tick() {
  remainingSeconds -= 1;
  updateTimerDisplay();

  if (remainingSeconds <= 0) {
    remainingSeconds = 0;
    updateTimerDisplay();
    clearIntervals();
    isPaused = false;
    setControls({ running: false, paused: false });
    showSummary();
  }
}

function startTimer() {
  if (countdownId !== null || isPaused) return;

  remainingSeconds = DEFAULT_SECONDS;
  updateTimerDisplay();
  summarySection.hidden = true;
  isPaused = false;
  setControls({ running: true, paused: false });

  pollLatestFocusStatus();
  beginIntervals();
}

function pauseOrResumeTimer() {
  if (!isPaused && countdownId === null) return;

  if (isPaused) {
    isPaused = false;
    setControls({ running: true, paused: false });
    pollLatestFocusStatus();
    beginIntervals();
    return;
  }

  isPaused = true;
  clearIntervals();
  setControls({ running: false, paused: true });
}

function cancelTimer() {
  clearIntervals();
  isPaused = false;
  remainingSeconds = DEFAULT_SECONDS;
  updateTimerDisplay();
  summarySection.hidden = true;
  setControls({ running: false, paused: false });
}

startBtn?.addEventListener("click", startTimer);
pauseBtn?.addEventListener("click", pauseOrResumeTimer);
cancelBtn?.addEventListener("click", cancelTimer);
updateTimerDisplay();
setControls({ running: false, paused: false });
